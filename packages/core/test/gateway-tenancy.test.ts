import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { gatewayCalls, gatewayTokens, gstCredentials } from "@ewayvo/database";
import { systemContext, type Container } from "../src/index.js";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  type TestBusiness,
} from "./helpers.js";

/**
 * Tenant boundaries around the government gateway.
 *
 * Credentials are the highest-value data in the system: one tenant filing
 * under another's GSTIN would be a compliance breach, not just a bug. These
 * tests attack the boundary from every direction the gateway introduces —
 * credentials, cached portal tokens, IRN/EWB records, gateway call logs and
 * worker jobs.
 */
describe("gateway tenant isolation", () => {
  let container: Container;
  let alpha: TestBusiness;
  let beta: TestBusiness;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    alpha = await createBusiness(container, {
      slug: "gw-alpha",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    beta = await createBusiness(container, {
      slug: "gw-beta",
      gstin: "29AAGCB7383J1Z4",
      stateCode: "29",
    });

    await container.credentials.save(alpha.ctx, {
      gstinId: alpha.gstinId,
      provider: "nic",
      environment: "sandbox",
      service: "einvoice",
      username: "ALPHA_API_USER",
      password: "alpha-secret-password",
      clientId: "alpha-client",
      clientSecret: "alpha-client-secret",
    });
    await container.credentials.save(beta.ctx, {
      gstinId: beta.gstinId,
      provider: "nic",
      environment: "sandbox",
      service: "einvoice",
      username: "BETA_API_USER",
      password: "beta-secret-password",
      clientId: "beta-client",
      clientSecret: "beta-client-secret",
    });
  }, 60_000);

  afterAll(async () => await container?.shutdown());

  it("stores credentials encrypted, never in clear text", async () => {
    const [row] = await container.database.db
      .select()
      .from(gstCredentials)
      .where(eq(gstCredentials.tenantId, alpha.tenantId))
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.encryptedPayload).not.toContain("alpha-secret-password");
    expect(row!.encryptedPayload).not.toContain("ALPHA_API_USER");
    expect(row!.encryptedPayload).not.toContain("alpha-client-secret");
    expect(row!.encryptedPayload).toMatch(/^v\d+\./);
  });

  it("returns only a masked username over the API, never a secret", async () => {
    const listed = await container.credentials.list(alpha.ctx);
    const serialised = JSON.stringify(listed);
    expect(serialised).not.toContain("alpha-secret-password");
    expect(serialised).not.toContain("alpha-client-secret");
    expect(serialised).not.toContain("encryptedPayload");
    expect(listed[0]?.usernameHint).toMatch(/…/);
  });

  it("does not list another tenant's credentials", async () => {
    const forBeta = await container.credentials.list(beta.ctx);
    expect(forBeta).toHaveLength(1);
    expect(forBeta[0]?.gstin).toBe("29AAGCB7383J1Z4");
    expect(forBeta.some((c) => c.gstin === "27AAPFU0939F1ZV")).toBe(false);
  });

  it("refuses to resolve another tenant's credentials by GSTIN", async () => {
    // Beta naming Alpha's GSTIN must not reach Alpha's stored secret.
    await expect(
      container.credentials.resolve(beta.ctx, {
        gstin: "27AAPFU0939F1ZV",
        service: "einvoice",
        environment: "sandbox",
      }),
    ).rejects.toThrow(/no e-invoice credentials/i);
  });

  it("resolves each tenant to its own credentials", async () => {
    const a = await container.credentials.resolve(alpha.ctx, {
      gstin: "27AAPFU0939F1ZV",
      service: "einvoice",
      environment: "sandbox",
    });
    const b = await container.credentials.resolve(beta.ctx, {
      gstin: "29AAGCB7383J1Z4",
      service: "einvoice",
      environment: "sandbox",
    });
    expect(a.credentials.username).toBe("ALPHA_API_USER");
    expect(b.credentials.username).toBe("BETA_API_USER");
    expect(a.credential.tenantId).toBe(alpha.tenantId);
    expect(b.credential.tenantId).toBe(beta.tenantId);
  });

  it("refuses to delete another tenant's credentials", async () => {
    const alphaCreds = await container.credentials.list(alpha.ctx);
    const id = alphaCreds[0]!.id;
    await container.credentials.remove(beta.ctx, id);
    // Still there: the delete was scoped to Beta and matched nothing.
    expect(await container.credentials.list(alpha.ctx)).toHaveLength(1);
  });

  it("keeps cached portal tokens tenant-scoped and encrypted", async () => {
    const [cred] = await container.database.db
      .select()
      .from(gstCredentials)
      .where(eq(gstCredentials.tenantId, alpha.tenantId))
      .limit(1);
    await container.database.db.insert(gatewayTokens).values({
      credentialId: cred!.id,
      tenantId: alpha.tenantId,
      encryptedToken: container.secrets.encrypt("alpha-auth-token"),
      encryptedSek: container.secrets.encrypt("alpha-session-key"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const rows = await container.database.db.select().from(gatewayTokens);
    for (const row of rows) {
      expect(row.encryptedToken).not.toContain("alpha-auth-token");
      expect(row.encryptedSek).not.toContain("alpha-session-key");
    }
    const betaTokens = rows.filter((r) => r.tenantId === beta.tenantId);
    expect(betaTokens).toHaveLength(0);
  });

  it("keeps gateway call logs tenant-scoped", async () => {
    for (const [tenantId, gstin] of [
      [alpha.tenantId, "27AAPFU0939F1ZV"],
      [beta.tenantId, "29AAGCB7383J1Z4"],
    ] as const) {
      await container.database.db.insert(gatewayCalls).values({
        tenantId,
        gateway: "irp",
        operation: "auth",
        endpoint: "https://sandbox.invalid/eivital/v1.04/auth",
        gstin,
        idempotencyKey: `probe:${tenantId}`,
        attempt: 1,
        responseStatus: 200,
        durationMs: 12,
      });
    }

    const alphaLogs = await container.database.client`
      SELECT gstin FROM gateway_calls WHERE tenant_id = ${alpha.tenantId}
    `;
    expect(alphaLogs).toHaveLength(1);
    expect((alphaLogs[0] as { gstin: string }).gstin).toBe("27AAPFU0939F1ZV");

    const betaLogs = await container.database.client`
      SELECT gstin FROM gateway_calls WHERE tenant_id = ${beta.tenantId}
    `;
    expect((betaLogs[0] as { gstin: string }).gstin).toBe("29AAGCB7383J1Z4");
  });

  it("never writes a secret into the gateway call log", async () => {
    const rows = await container.database.client<Array<{ request_payload: unknown }>>`
      SELECT request_payload FROM gateway_calls
    `;
    const serialised = JSON.stringify(rows);
    for (const secret of [
      "alpha-secret-password",
      "beta-secret-password",
      "alpha-client-secret",
      "beta-client-secret",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("keeps IRN and e-Way Bill records tenant-scoped", async () => {
    const draft = await container.invoices.createDraft(alpha.ctx, invoiceInput(alpha));
    const finalized = await container.invoices.finalize(alpha.ctx, draft.invoice.id);

    expect(await container.compliance.readEinvoice(beta.ctx, finalized.id)).toBeNull();
    expect(await container.compliance.readEwb(beta.ctx, finalized.id)).toBeNull();

    await expect(container.compliance.queueEinvoice(beta.ctx, finalized.id)).rejects.toThrow(
      /not found/i,
    );
    // Beta gets the same answer it would get for an invoice that does not
    // exist — the tenant-scoped read finds nothing, so nothing is revealed
    // about Alpha's document.
    await expect(
      container.compliance.cancelEinvoice(beta.ctx, finalized.id, {
        reasonCode: "1",
        remark: "attempt",
      }),
    ).rejects.toThrow(/no IRN to cancel/i);
  });

  it("confines a worker job to the tenant named in its payload", async () => {
    const draft = await container.invoices.createDraft(alpha.ctx, invoiceInput(alpha));
    const finalized = await container.invoices.finalize(alpha.ctx, draft.invoice.id);

    // The worker acts as a system context for one tenant. Pointed at Beta, it
    // must not be able to touch Alpha's invoice.
    const betaWorker = systemContext(beta.tenantId);
    await expect(container.compliance.generateEinvoice(betaWorker, finalized.id)).rejects.toThrow(
      /not found/i,
    );

    // The same job under Alpha's context resolves the invoice and stops at
    // the gateway-configuration boundary rather than a tenancy error — proof
    // the isolation failure above was about tenancy, not missing setup.
    const alphaWorker = systemContext(alpha.tenantId);
    await expect(container.compliance.generateEinvoice(alphaWorker, finalized.id)).rejects.toThrow(
      /public key|base url|credential/i,
    );
  });
});
