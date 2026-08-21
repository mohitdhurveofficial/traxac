import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDatabase, invoices, parties } from "@ewayvo/database";
import type { Database } from "@ewayvo/database";
import type { Container } from "../src/index.js";
import { and, eq } from "drizzle-orm";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  TEST_DATABASE_URL,
  type TestBusiness,
} from "./helpers.js";

/**
 * Row-level security, enforced.
 *
 * The earlier RLS suite proved the *policies* are correct using raw SQL. This
 * one proves the *application* can run under them: a non-superuser
 * connection, tenant context established per unit of work, and the context
 * torn down so a pooled connection cannot leak it to the next borrower.
 *
 * Every test here connects as `traxac_app`, which is deliberately not a
 * superuser — a superuser bypasses RLS entirely and would make all of this
 * pass while proving nothing.
 */
const APP_ROLE_URL = (() => {
  const url = new URL(TEST_DATABASE_URL);
  url.username = "traxac_app";
  url.password = "app_role_pw";
  if (!url.hostname) url.hostname = "localhost";
  return url.toString();
})();

describe("row-level security enforced through the application", () => {
  let container: Container;
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let scoped: Database;
  let available = true;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    alpha = await createBusiness(container, {
      slug: "rls-app-alpha",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    beta = await createBusiness(container, {
      slug: "rls-app-beta",
      gstin: "29AAGCB7383J1Z4",
      stateCode: "29",
    });
    await container.invoices.createDraft(alpha.ctx, invoiceInput(alpha));
    await container.invoices.createDraft(beta.ctx, invoiceInput(beta));

    try {
      const probe = postgres(APP_ROLE_URL, { max: 1, prepare: false, onnotice: () => {} });
      await probe`SELECT 1`;
      await probe.end({ timeout: 5 });
      scoped = createDatabase(APP_ROLE_URL, { max: 4 });
    } catch (error) {
      // Silently skipping here would let the suite report green while proving
      // nothing, so CI sets REQUIRE_RLS_ROLE=1 and this becomes a hard
      // failure. Run `node scripts/create-app-role.mjs` to provision it.
      if (process.env["REQUIRE_RLS_ROLE"] === "1") {
        throw new Error(
          `The non-superuser role is required but unreachable at ${APP_ROLE_URL}. ` +
            `Run: node scripts/create-app-role.mjs — original error: ${String(error)}`,
        );
      }
      available = false;
    }
  }, 90_000);

  afterAll(async () => {
    await scoped?.close();
    await container?.shutdown();
  });

  it("returns nothing when no tenant context is established", async () => {
    if (!available) return;
    // Failing closed is the whole point: a query that forgets the context
    // must return zero rows, never everything.
    const rows = await scoped.db.select({ id: invoices.id }).from(invoices);
    expect(rows).toHaveLength(0);
  });

  it("SELECT is confined to the tenant in context", async () => {
    if (!available) return;
    const mine = await scoped.withTenant(alpha.tenantId, (db) =>
      db.select({ id: invoices.id }).from(invoices),
    );
    expect(mine.length).toBeGreaterThan(0);

    const theirs = await scoped.withTenant(alpha.tenantId, (db) =>
      db.select({ id: invoices.id }).from(invoices).where(eq(invoices.tenantId, beta.tenantId)),
    );
    expect(theirs, "tenant A must not see tenant B even when naming them").toHaveLength(0);
  });

  it("INSERT for another tenant is refused", async () => {
    if (!available) return;
    // Drizzle >= 0.45 wraps driver errors ("Failed query: ...") and keeps the
    // original Postgres error on `.cause`, so the whole cause chain must be
    // searched for the RLS violation — the refusal still has to come from
    // row-level security, not from any other failure.
    const messages: string[] = [];
    await scoped
      .withTenant(beta.tenantId, (db) =>
        db.insert(parties).values({
          tenantId: alpha.tenantId,
          name: "Injected by beta",
          partyType: "customer",
          registrationType: "unregistered",
          country: "IN",
        }),
      )
      .then(
        () => messages.push("resolved"),
        (error: unknown) => {
          let current: unknown = error;
          for (let depth = 0; current && depth < 5; depth++) {
            messages.push(String((current as Error).message ?? current));
            current = (current as { cause?: unknown }).cause;
          }
        },
      );
    expect(messages.join("\n")).toMatch(/row-level security/i);
  });

  it("UPDATE against another tenant affects nothing", async () => {
    if (!available) return;
    await scoped.withTenant(beta.tenantId, (db) =>
      db.update(invoices).set({ notes: "rls breach" }).where(eq(invoices.tenantId, alpha.tenantId)),
    );
    const leaked = await container.database.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.notes, "rls breach"));
    expect(leaked).toHaveLength(0);
  });

  it("DELETE against another tenant affects nothing", async () => {
    if (!available) return;
    const before = await container.database.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.tenantId, alpha.tenantId));

    await scoped.withTenant(beta.tenantId, (db) =>
      db.delete(invoices).where(eq(invoices.tenantId, alpha.tenantId)),
    );

    const after = await container.database.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.tenantId, alpha.tenantId));
    expect(after.length).toBe(before.length);
  });

  it("does not leak tenant context to the next user of a pooled connection", async () => {
    if (!available) return;
    // Establish, use, release — then a plain query must see nothing again.
    await scoped.withTenant(alpha.tenantId, (db) => db.select({ id: invoices.id }).from(invoices));
    const afterRelease = await scoped.db.select({ id: invoices.id }).from(invoices);
    expect(afterRelease, "a released connection must carry no tenant").toHaveLength(0);
  });

  it("keeps concurrent tenants apart on a shared pool", async () => {
    if (!available) return;
    // Interleave deliberately: if the setting were connection-global rather
    // than reserved per unit of work, these would contaminate each other.
    const [a, b, a2, b2] = await Promise.all([
      scoped.withTenant(alpha.tenantId, (db) => db.select({ id: invoices.id }).from(invoices)),
      scoped.withTenant(beta.tenantId, (db) => db.select({ id: invoices.id }).from(invoices)),
      scoped.withTenant(alpha.tenantId, (db) => db.select({ id: invoices.id }).from(invoices)),
      scoped.withTenant(beta.tenantId, (db) => db.select({ id: invoices.id }).from(invoices)),
    ]);
    expect(a.length).toBe(a2.length);
    expect(b.length).toBe(b2.length);
    // Both tenants have exactly one invoice each, so a leak would show up as
    // a count of two.
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  it("lets background work span tenants only through the explicit bypass", async () => {
    if (!available) return;
    const all = await scoped.withoutTenantScope((db) =>
      db.select({ id: invoices.id }).from(invoices),
    );
    expect(all.length).toBeGreaterThan(1);

    // And the bypass does not survive the call.
    const after = await scoped.db.select({ id: invoices.id }).from(invoices);
    expect(after).toHaveLength(0);
  });

  it("still allows a tenant its own writes", async () => {
    if (!available) return;
    const created = await scoped.withTenant(alpha.tenantId, (db) =>
      db
        .insert(parties)
        .values({
          tenantId: alpha.tenantId,
          name: "Legitimate customer",
          partyType: "customer",
          registrationType: "unregistered",
          country: "IN",
        })
        .returning({ id: parties.id }),
    );
    expect(created[0]?.id).toBeTruthy();

    const readBack = await scoped.withTenant(alpha.tenantId, (db) =>
      db
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.id, created[0]!.id), eq(parties.tenantId, alpha.tenantId))),
    );
    expect(readBack).toHaveLength(1);
  });

  it("confirms the application role is not a superuser", async () => {
    if (!available) return;
    const rows = await scoped.client<Array<{ usesuper: boolean }>>`
      SELECT usesuper FROM pg_user WHERE usename = current_user
    `;
    // A superuser bypasses RLS, which would make every test above vacuous.
    expect(rows[0]?.usesuper).toBe(false);
  });
});
