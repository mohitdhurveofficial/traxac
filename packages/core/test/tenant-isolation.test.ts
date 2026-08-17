import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Container } from "../src/index.js";
import { AppError } from "@traxac/shared";
import {
  createBusiness, invoiceInput, resetDatabase, testContainer, type TestBusiness,
} from "./helpers.js";

/**
 * Tenant isolation is the single property that must never fail: one business
 * seeing another's invoices is not a bug, it is a breach. These tests use two
 * real businesses in one database and try, from each direction, to reach
 * across.
 */
describe("tenant isolation", () => {
  let container: Container;
  let alpha: TestBusiness;
  let beta: TestBusiness;
  let alphaInvoiceId: string;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    alpha = await createBusiness(container, { slug: "alpha", gstin: "27AAPFU0939F1ZV", stateCode: "27" });
    beta = await createBusiness(container, { slug: "beta", gstin: "29AAGCB7383J1Z4", stateCode: "29" });
    const created = await container.invoices.createDraft(alpha.ctx, invoiceInput(alpha));
    alphaInvoiceId = created.invoice.id;
  }, 60_000);

  afterAll(async () => {
    await container?.shutdown();
  });

  it("gives each business its own tenant", () => {
    expect(alpha.tenantId).not.toBe(beta.tenantId);
  });

  it("hides another business's invoice from get()", async () => {
    await expect(container.invoices.get(beta.ctx, alphaInvoiceId))
      .rejects.toThrow(/not found/i);
  });

  it("excludes another business's invoices from list()", async () => {
    const listed = await container.invoices.list(beta.ctx, {
      limit: 50, page: 1, sort: "invoiceDate", order: "desc",
    } as never);
    expect(listed.total).toBe(0);
    expect(listed.items).toHaveLength(0);

    const own = await container.invoices.list(alpha.ctx, {
      limit: 50, page: 1, sort: "invoiceDate", order: "desc",
    } as never);
    expect(own.total).toBe(1);
  });

  it("refuses to finalize another business's invoice", async () => {
    await expect(container.invoices.finalize(beta.ctx, alphaInvoiceId))
      .rejects.toThrow(/not found/i);
  });

  it("refuses to edit another business's invoice", async () => {
    await expect(container.invoices.updateDraft(beta.ctx, alphaInvoiceId, invoiceInput(beta)))
      .rejects.toThrow(/not found/i);
  });

  it("refuses to cancel another business's invoice", async () => {
    await expect(container.invoices.cancel(beta.ctx, alphaInvoiceId, "attempt"))
      .rejects.toThrow(/not found/i);
  });

  it("hides another business's customers and products", async () => {
    await expect(container.masters.getParty(beta.ctx, alpha.partyId)).rejects.toThrow(/not found/i);
    await expect(container.masters.getProduct(beta.ctx, alpha.productId)).rejects.toThrow(/not found/i);
    await expect(container.masters.getGstin(beta.ctx, alpha.gstinId)).rejects.toThrow(/not found/i);

    const parties = await container.masters.listParties(beta.ctx, { limit: 50 });
    expect(parties.items.every((p) => p.name.startsWith("beta"))).toBe(true);
  });

  it("refuses an invoice that references another business's GSTIN", async () => {
    await expect(
      container.invoices.createDraft(beta.ctx, invoiceInput(beta, { gstinId: alpha.gstinId })),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses an invoice that references another business's customer", async () => {
    await expect(
      container.invoices.createDraft(beta.ctx, invoiceInput(beta, { buyerPartyId: alpha.partyId })),
    ).rejects.toThrow(/not found/i);
  });

  it("keeps compliance records tenant-scoped", async () => {
    expect(await container.compliance.readEinvoice(beta.ctx, alphaInvoiceId)).toBeNull();
    expect(await container.compliance.readEwb(beta.ctx, alphaInvoiceId)).toBeNull();
  });

  it("scopes the audit timeline to the owning tenant", async () => {
    const { readTimeline } = await import("../src/infra/audit.js");
    const foreign = await readTimeline(container.database, beta.ctx, "invoice", alphaInvoiceId);
    expect(foreign).toHaveLength(0);
    const own = await readTimeline(container.database, alpha.ctx, "invoice", alphaInvoiceId);
    expect(own.length).toBeGreaterThan(0);
  });

  it("refuses to resolve another business's GST credentials", async () => {
    await expect(container.credentials.resolve(beta.ctx, {
      gstin: "27AAPFU0939F1ZV", service: "einvoice", environment: "sandbox",
    })).rejects.toBeInstanceOf(AppError);
  });
});
