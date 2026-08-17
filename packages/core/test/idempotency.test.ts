import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { einvoices, ewayBills } from "@traxac/database";
import type {
  EinvoiceProvider,
  EwbProvider,
  GatewayRegistry,
  GatewayResult,
  IrnDetails,
  IrnResult,
} from "@traxac/gst-gateway";
import type { Container } from "../src/index.js";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  type TestBusiness,
} from "./helpers.js";

/**
 * Duplicate protection.
 *
 * The failure this guards against: a generation request reaches the portal,
 * the portal issues a document, and the response is lost to a timeout. A naive
 * retry files a *second* IRN or e-Way Bill for the same invoice — which is a
 * tax filing problem, not a transient glitch.
 *
 * The rule implemented is: any attempt after the first asks the portal what it
 * already holds before sending anything. These tests drive that with a fake
 * provider that records every call, so we can assert exactly what was and was
 * not sent.
 */

interface CallLog {
  generateIrn: number;
  getIrnByDocument: number;
  generateEwb: number;
  getEwb: number;
}

function fakeRegistry(behaviour: {
  irnGenerate?: () => Promise<GatewayResult<IrnResult>>;
  irnLookup?: () => Promise<GatewayResult<IrnDetails>>;
  ewbGenerate?: () => Promise<GatewayResult<never>>;
  ewbLookup?: () => Promise<GatewayResult<never>>;
}): { registry: GatewayRegistry; calls: CallLog } {
  const calls: CallLog = { generateIrn: 0, getIrnByDocument: 0, generateEwb: 0, getEwb: 0 };

  const timeout = () => ({
    ok: false as const,
    error: { code: "TIMEOUT", message: "The portal did not respond", retryable: true },
  });

  const einvoice: EinvoiceProvider = {
    id: "irp",
    verify: async () => ({ ok: true, data: { verifiedAt: new Date() } }),
    generateIrn: async () => {
      calls.generateIrn += 1;
      return behaviour.irnGenerate ? behaviour.irnGenerate() : timeout();
    },
    cancelIrn: async () => ({ ok: true, data: { irn: "x", cancelDate: new Date() } }),
    getIrn: async () => ({ ok: false, error: { code: "NF", message: "nf", retryable: false } }),
    getIrnByDocument: async () => {
      calls.getIrnByDocument += 1;
      return behaviour.irnLookup
        ? behaviour.irnLookup()
        : { ok: false as const, error: { code: "NF", message: "not found", retryable: false } };
    },
  };

  const ewb: EwbProvider = {
    id: "ewb",
    verify: async () => ({ ok: true, data: { verifiedAt: new Date() } }),
    generate: async () => {
      calls.generateEwb += 1;
      return behaviour.ewbGenerate ? behaviour.ewbGenerate() : timeout();
    },
    updatePartB: async () => ({ ok: false, error: { code: "x", message: "x", retryable: false } }),
    updateTransporter: async () => ({
      ok: false,
      error: { code: "x", message: "x", retryable: false },
    }),
    extend: async () => ({ ok: false, error: { code: "x", message: "x", retryable: false } }),
    cancel: async () => ({ ok: false, error: { code: "x", message: "x", retryable: false } }),
    getEwb: async () => {
      calls.getEwb += 1;
      return behaviour.ewbLookup
        ? behaviour.ewbLookup()
        : { ok: false as const, error: { code: "NF", message: "not found", retryable: false } };
    },
  };

  return { registry: { einvoice: () => einvoice, ewb: () => ewb }, calls };
}

const IRN = "a".repeat(64);
const IRN_ALT = "c".repeat(64);

async function withCredentials(container: Container, business: TestBusiness): Promise<void> {
  await container.credentials.save(business.ctx, {
    gstinId: business.gstinId,
    provider: "nic",
    environment: "sandbox",
    service: "einvoice",
    username: "SANDBOX_USER",
    password: "sandbox-password",
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    baseUrl: "https://sandbox.invalid",
  });
  await container.credentials.save(business.ctx, {
    gstinId: business.gstinId,
    provider: "nic",
    environment: "sandbox",
    service: "ewb",
    username: "SANDBOX_USER",
    password: "sandbox-password",
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    baseUrl: "https://sandbox.invalid",
  });
}

async function issuedInvoice(container: Container, business: TestBusiness): Promise<string> {
  const draft = await container.invoices.createDraft(business.ctx, invoiceInput(business));
  const finalized = await container.invoices.finalize(business.ctx, draft.invoice.id);
  return finalized.id;
}

describe("IRN generation is idempotent across a timeout", () => {
  let container: Container;
  let business: TestBusiness;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "idem",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    await withCredentials(container, business);
  }, 60_000);

  afterAll(async () => await container?.shutdown());

  it("does not ask the portal anything on the very first attempt", async () => {
    const { registry, calls } = fakeRegistry({});
    const scoped = await testContainer({}, registry);
    try {
      const invoiceId = await issuedInvoice(scoped, business);
      await expect(scoped.compliance.generateEinvoice(business.ctx, invoiceId)).rejects.toThrow();
      // A first attempt has nothing to reconcile; the extra round trip would
      // slow down every single invoice.
      expect(calls.getIrnByDocument).toBe(0);
      expect(calls.generateIrn).toBe(1);
    } finally {
      await scoped.shutdown();
    }
  });

  it("asks the portal before resending, and does not resend when it already has the IRN", async () => {
    const { registry, calls } = fakeRegistry({
      irnLookup: async () => ({
        ok: true,
        data: {
          irn: IRN,
          ackNumber: "112000000001",
          ackDate: new Date("2026-08-17T06:00:00Z"),
          status: "ACT",
          signedInvoice: "signed.jws",
          signedQrCode: "qr.jws",
          ewbNumber: null,
        },
      }),
    });
    const scoped = await testContainer({}, registry);
    try {
      const invoiceId = await issuedInvoice(scoped, business);

      // First attempt times out; the tracking row records the attempt.
      await expect(scoped.compliance.generateEinvoice(business.ctx, invoiceId)).rejects.toThrow();
      expect(calls.generateIrn).toBe(1);

      // Retry: it must look up first, find the IRN, and send nothing.
      const recovered = await scoped.compliance.generateEinvoice(business.ctx, invoiceId);
      expect(calls.getIrnByDocument).toBe(1);
      expect(calls.generateIrn, "must NOT have resent the generate request").toBe(1);
      expect(recovered.irn).toBe(IRN);
      expect(recovered.status).toBe("generated");
    } finally {
      await scoped.shutdown();
    }
  });

  it("persists the recovered document exactly like a freshly issued one", async () => {
    const { registry } = fakeRegistry({
      irnLookup: async () => ({
        ok: true,
        data: {
          irn: IRN_ALT,
          ackNumber: "112000000002",
          ackDate: new Date("2026-08-17T07:30:00Z"),
          status: "ACT",
          signedInvoice: "signed.jws",
          signedQrCode: "qr.jws",
          ewbNumber: null,
        },
      }),
    });
    const scoped = await testContainer({}, registry);
    try {
      const invoiceId = await issuedInvoice(scoped, business);
      await expect(scoped.compliance.generateEinvoice(business.ctx, invoiceId)).rejects.toThrow();
      await scoped.compliance.generateEinvoice(business.ctx, invoiceId);

      const [row] = await scoped.database.db
        .select()
        .from(einvoices)
        .where(eq(einvoices.invoiceId, invoiceId))
        .limit(1);
      expect(row?.irn).toBe(IRN_ALT);
      expect(row?.ackNumber).toBe("112000000002");
      expect(row?.ackDate).toBeInstanceOf(Date);
      expect(row?.signedQrCode).toBe("qr.jws");
      expect(row?.status).toBe("generated");

      const detail = await scoped.invoices.get(business.ctx, invoiceId);
      expect(detail.invoice.einvoiceStatus).toBe("generated");

      // The audit trail must say where it came from.
      const { readTimeline } = await import("../src/infra/audit.js");
      const timeline = await readTimeline(scoped.database, business.ctx, "invoice", invoiceId);
      const generated = timeline.find((e) => e.action === "einvoice.generated");
      expect(generated?.metadata).toMatchObject({ source: "reconciliation" });
    } finally {
      await scoped.shutdown();
    }
  });

  it("resends only when the portal confirms it has nothing", async () => {
    const { registry, calls } = fakeRegistry({
      irnLookup: async () => ({
        ok: false,
        error: { code: "NF", message: "nf", retryable: false },
      }),
    });
    const scoped = await testContainer({}, registry);
    try {
      const invoiceId = await issuedInvoice(scoped, business);
      await expect(scoped.compliance.generateEinvoice(business.ctx, invoiceId)).rejects.toThrow();
      await expect(scoped.compliance.generateEinvoice(business.ctx, invoiceId)).rejects.toThrow();
      expect(calls.getIrnByDocument).toBe(1);
      expect(calls.generateIrn, "portal had nothing, so resending is correct").toBe(2);
    } finally {
      await scoped.shutdown();
    }
  });

  it("never generates twice for an invoice that already succeeded", async () => {
    const { registry, calls } = fakeRegistry({
      irnGenerate: async () => ({
        ok: true,
        data: {
          irn: "b".repeat(64),
          ackNumber: "112000000003",
          ackDate: new Date(),
          signedInvoice: "s",
          signedQrCode: "q",
          status: "ACT",
        },
      }),
    });
    const scoped = await testContainer({}, registry);
    try {
      const invoiceId = await issuedInvoice(scoped, business);
      const first = await scoped.compliance.generateEinvoice(business.ctx, invoiceId);
      const second = await scoped.compliance.generateEinvoice(business.ctx, invoiceId);
      expect(second.irn).toBe(first.irn);
      expect(calls.generateIrn, "a completed IRN short-circuits before any call").toBe(1);
    } finally {
      await scoped.shutdown();
    }
  });

  it("collapses duplicate queue entries onto one job", async () => {
    const invoiceId = await issuedInvoice(container, business);
    // A double click must not enqueue a second generation: the idempotency
    // key makes the second enqueue return the job the first one created.
    const first = await container.compliance.queueEinvoice(business.ctx, invoiceId);
    const second = await container.compliance.queueEinvoice(business.ctx, invoiceId);
    expect(second.id).toBe(first.id);

    const rows = await container.database.client`
      SELECT count(*)::int AS n FROM jobs
      WHERE idempotency_key = ${`einvoice.generate:${invoiceId}`}
    `;
    expect((rows[0] as { n: number }).n).toBe(1);
  });
});

describe("e-Way Bill generation is idempotent across a timeout", () => {
  let container: Container;
  let business: TestBusiness;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "idem-ewb",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    await withCredentials(container, business);
  }, 60_000);

  afterAll(async () => await container?.shutdown());

  it("confirms an existing bill instead of generating a second one", async () => {
    const { registry, calls } = fakeRegistry({
      ewbLookup: async () =>
        ({
          ok: true,
          data: {
            ewbNumber: "391000123456",
            status: "ACT",
            generatedAt: new Date("2026-08-17T06:00:00Z"),
            validUntil: new Date("2026-08-20T18:30:00Z"),
          },
        }) as never,
    });
    const scoped = await testContainer({}, registry);
    try {
      const invoiceId = await issuedInvoice(scoped, business);
      // First attempt times out.
      await expect(
        scoped.compliance.generateEwb(business.ctx, invoiceId, { distanceKm: 100 }),
      ).rejects.toThrow();
      expect(calls.generateEwb).toBe(1);

      // Record the number we learned about out of band, then retry.
      await scoped.database.db
        .update(ewayBills)
        .set({ ewbNumber: "391000123456" })
        .where(eq(ewayBills.invoiceId, invoiceId));

      const recovered = await scoped.compliance.generateEwb(business.ctx, invoiceId, {
        distanceKm: 100,
      });
      expect(calls.getEwb).toBe(1);
      expect(calls.generateEwb, "must NOT have resent the generate request").toBe(1);
      expect(recovered.ewbNumber).toBe("391000123456");
      expect(recovered.status).toBe("generated");
      expect(recovered.validUntil).toBeInstanceOf(Date);
    } finally {
      await scoped.shutdown();
    }
  });

  it("short-circuits when the bill is already recorded as generated", async () => {
    const { registry, calls } = fakeRegistry({
      ewbGenerate: async () =>
        ({
          ok: true,
          data: {
            ewbNumber: "391000999888",
            generatedAt: new Date(),
            validUntil: new Date(Date.now() + 86_400_000),
          },
        }) as never,
    });
    const scoped = await testContainer({}, registry);
    try {
      const invoiceId = await issuedInvoice(scoped, business);
      await scoped.compliance.generateEwb(business.ctx, invoiceId, { distanceKm: 100 });
      await scoped.compliance.generateEwb(business.ctx, invoiceId, { distanceKm: 100 });
      expect(calls.generateEwb).toBe(1);
    } finally {
      await scoped.shutdown();
    }
  });
});
