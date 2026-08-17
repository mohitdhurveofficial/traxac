import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { Container } from "../src/index.js";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  TEST_DATABASE_URL,
  type TestBusiness,
} from "./helpers.js";

/**
 * Row-level security.
 *
 * The application already scopes every query, and the tenant-isolation suite
 * attacks that boundary directly. RLS is the second, independent barrier: if
 * a query is ever written without the tenant predicate, Postgres refuses the
 * rows instead of returning them.
 *
 * These tests connect as a **non-superuser** on purpose. A superuser — and
 * the role a local developer usually has — bypasses RLS entirely, so testing
 * as one would prove nothing at all.
 */
describe("row-level security", () => {
  let container: Container;
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let app: postgres.Sql;
  let admin: postgres.Sql;
  let available = true;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    alpha = await createBusiness(container, {
      slug: "rls-alpha",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    beta = await createBusiness(container, {
      slug: "rls-beta",
      gstin: "29AAGCB7383J1Z4",
      stateCode: "29",
    });
    await container.invoices.createDraft(alpha.ctx, invoiceInput(alpha));
    await container.invoices.createDraft(beta.ctx, invoiceInput(beta));

    admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await admin.unsafe(`
        DROP ROLE IF EXISTS traxac_rls_test;
        CREATE ROLE traxac_rls_test LOGIN PASSWORD 'rls_test';
        GRANT USAGE ON SCHEMA public TO traxac_rls_test;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO traxac_rls_test;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO traxac_rls_test;
      `);
      const url = new URL(TEST_DATABASE_URL);
      url.username = "traxac_rls_test";
      url.password = "rls_test";
      if (!url.hostname) url.hostname = "localhost";
      app = postgres(url.toString(), { max: 2, prepare: false, onnotice: () => {} });
      await app`SELECT 1`;
    } catch {
      // Creating a role needs privileges the CI database may not grant.
      available = false;
    }
  }, 90_000);

  afterAll(async () => {
    await app?.end({ timeout: 5 });
    await admin?.unsafe("DROP ROLE IF EXISTS traxac_rls_test").catch(() => undefined);
    await admin?.end({ timeout: 5 });
    await container?.shutdown();
  });

  it("is enabled and forced on every tenant-owned table", async () => {
    const rows = await admin<Array<{ relname: string; relforcerowsecurity: boolean }>>`
      SELECT relname, relforcerowsecurity FROM pg_class
      WHERE relname IN ('invoices', 'parties', 'products', 'documents', 'gst_credentials')
    `;
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      // Without FORCE, the table owner bypasses the policy and it is decorative.
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
  });

  it("shows nothing when no tenant is set on the connection", async () => {
    if (!available) return;
    const rows = await app`SELECT count(*)::int AS n FROM invoices`;
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it("shows only the current tenant's rows", async () => {
    if (!available) return;
    await app`SELECT set_config('traxac.tenant_id', ${alpha.tenantId}, false)`;
    const mine = await app`SELECT count(*)::int AS n FROM invoices`;
    expect((mine[0] as { n: number }).n).toBeGreaterThan(0);

    const foreign = await app`
      SELECT count(*)::int AS n FROM invoices WHERE tenant_id = ${beta.tenantId}
    `;
    // The row exists, but this connection cannot see it.
    expect((foreign[0] as { n: number }).n).toBe(0);
  });

  it("blocks a cross-tenant write even when the id is known", async () => {
    if (!available) return;
    await app`SELECT set_config('traxac.tenant_id', ${beta.tenantId}, false)`;
    const result = await app`
      UPDATE invoices SET notes = 'rls breach' WHERE tenant_id = ${alpha.tenantId}
    `;
    expect(result.count).toBe(0);

    const check = await admin`SELECT count(*)::int AS n FROM invoices WHERE notes = 'rls breach'`;
    expect((check[0] as { n: number }).n).toBe(0);
  });

  it("refuses an insert that claims another tenant", async () => {
    if (!available) return;
    await app`SELECT set_config('traxac.tenant_id', ${beta.tenantId}, false)`;
    await expect(
      app`
        INSERT INTO parties (tenant_id, name, party_type, registration_type, country)
        VALUES (${alpha.tenantId}, 'Injected', 'customer', 'unregistered', 'IN')
      `,
    ).rejects.toThrow(/row-level security/i);
  });

  it("protects credentials and documents, not just invoices", async () => {
    if (!available) return;
    await app`SELECT set_config('traxac.tenant_id', ${beta.tenantId}, false)`;
    for (const table of ["gst_credentials", "documents", "audit_logs", "einvoices"]) {
      const rows = await app.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = '${alpha.tenantId}'`,
      );
      expect((rows[0] as { n: number }).n, table).toBe(0);
    }
  });

  it("lets an explicit bypass through for migrations and the worker", async () => {
    if (!available) return;
    await app`SELECT set_config('traxac.tenant_id', ${beta.tenantId}, false)`;
    await app`SELECT set_config('traxac.bypass', 'on', false)`;
    const rows = await app`SELECT count(*)::int AS n FROM invoices`;
    // The escape hatch is deliberate and auditable, not implicit.
    expect((rows[0] as { n: number }).n).toBeGreaterThan(1);
    await app`SELECT set_config('traxac.bypass', 'off', false)`;
  });
});
