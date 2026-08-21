import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Container } from "../src/index.js";
import { financialYear } from "@ewayvo/shared";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  type TestBusiness,
} from "./helpers.js";

/**
 * Numbering and the invoice state machine.
 *
 * The numbering test runs concurrent finalizations against a real database,
 * because the guarantee comes from a row lock — asserting it any other way
 * would only be testing the mock.
 */
describe("invoice lifecycle", () => {
  let container: Container;
  let business: TestBusiness;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "lifecycle",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
  }, 60_000);

  afterAll(async () => {
    await container?.shutdown();
  });

  it("computes and persists the same totals the engine produces", async () => {
    const created = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    // 2 × ₹1,000 = ₹2,000 taxable, intra-state 18% = ₹180 split 90/90.
    expect(created.invoice.taxableValue).toBe(200_000);
    expect(created.invoice.cgst).toBe(18_000);
    expect(created.invoice.sgst).toBe(18_000);
    expect(created.invoice.igst).toBe(0);
    expect(created.invoice.grandTotal).toBe(236_000);
    expect(created.lines).toHaveLength(1);
    expect(created.lines[0]?.lineTotal).toBe(236_000);
  });

  it("keeps drafts out of the numbered series until finalized", async () => {
    const created = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    expect(created.invoice.status).toBe("draft");
    expect(created.invoice.invoiceNumber).toMatch(/^DRAFT-/);

    const finalized = await container.invoices.finalize(business.ctx, created.invoice.id);
    expect(finalized.status).toBe("pending");
    expect(finalized.invoiceNumber).toMatch(/^INV\/\d{4}-\d{2}\/\d{4}$/);
    expect(finalized.financialYear).toBe(financialYear(new Date("2026-08-17T06:00:00Z")));
  });

  it("refuses to edit or re-finalize an issued invoice", async () => {
    const created = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    await container.invoices.finalize(business.ctx, created.invoice.id);

    await expect(
      container.invoices.updateDraft(business.ctx, created.invoice.id, invoiceInput(business)),
    ).rejects.toThrow(/cannot be edited/i);
    await expect(container.invoices.finalize(business.ctx, created.invoice.id)).rejects.toThrow(
      /already/i,
    );
  });

  it("never issues the same number twice under concurrent finalization", async () => {
    const drafts = await Promise.all(
      Array.from({ length: 12 }, () =>
        container.invoices.createDraft(business.ctx, invoiceInput(business)),
      ),
    );

    // Fire every finalization at once: the sequence row lock is the only thing
    // standing between this and two invoices sharing a number.
    const finalized = await Promise.all(
      drafts.map((draft) => container.invoices.finalize(business.ctx, draft.invoice.id)),
    );

    const numbers = finalized.map((invoice) => invoice.invoiceNumber);
    expect(new Set(numbers).size).toBe(numbers.length);

    // The series must also be gapless.
    const sequence = numbers.map((number) => Number(number.split("/").pop())).sort((a, b) => a - b);
    for (let index = 1; index < sequence.length; index++) {
      expect(sequence[index]).toBe((sequence[index - 1] as number) + 1);
    }
  }, 30_000);

  it("refuses to move a number series backwards", async () => {
    const [series] = await container.numbering.listSeries(business.ctx);
    expect(series).toBeDefined();
    await expect(
      container.numbering.configureSeries(business.ctx, series!.id, { nextNumber: 1 }),
    ).rejects.toThrow(/already issued/i);
  });

  it("charges IGST when the place of supply is another state", async () => {
    const created = await container.invoices.createDraft(
      business.ctx,
      invoiceInput(business, { placeOfSupply: "29" }),
    );
    expect(created.invoice.igst).toBe(36_000);
    expect(created.invoice.cgst).toBe(0);
    expect(created.invoice.sgst).toBe(0);
  });

  it("flags an e-Way Bill above the threshold and not below it", async () => {
    const small = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    expect(small.invoice.ewbRequired).toBe(false);

    const large = await container.invoices.createDraft(
      business.ctx,
      invoiceInput(business, {
        lines: [
          {
            productId: business.productId,
            name: "Widget",
            description: "",
            hsnSac: "7308",
            isService: false,
            quantity: 100,
            unit: "NOS",
            unitPrice: 1000,
            discountPercent: 0,
            discountAmount: 0,
            gstRate: 18,
            cessRate: 0,
            cessNonAdvol: 0,
            stateCess: 0,
            batchNo: "",
            barcode: "",
            expiryDate: null,
          },
        ],
      }),
    );
    expect(large.invoice.grandTotal).toBeGreaterThan(50_000_00);
    expect(large.invoice.ewbRequired).toBe(true);
  });

  it("does not require an e-Way Bill for a services-only invoice", async () => {
    const created = await container.invoices.createDraft(
      business.ctx,
      invoiceInput(business, {
        lines: [
          {
            productId: null,
            name: "Consulting",
            description: "",
            hsnSac: "998313",
            isService: true,
            quantity: 100,
            unit: "NOS",
            unitPrice: 5000,
            discountPercent: 0,
            discountAmount: 0,
            gstRate: 18,
            cessRate: 0,
            cessNonAdvol: 0,
            stateCess: 0,
            batchNo: "",
            barcode: "",
            expiryDate: null,
          },
        ],
      }),
    );
    expect(created.invoice.grandTotal).toBeGreaterThan(50_000_00);
    expect(created.invoice.ewbRequired).toBe(false);
  });

  it("marks an invoice completed once it is fully paid", async () => {
    const created = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    await container.invoices.finalize(business.ctx, created.invoice.id);

    await container.invoices.recordPayment(business.ctx, created.invoice.id, {
      amount: 1000,
      method: "neft",
    } as never);
    let detail = await container.invoices.get(business.ctx, created.invoice.id);
    expect(detail.invoice.status).toBe("pending");
    expect(detail.amountDue).toBe(236_000 - 100_000);

    await container.invoices.recordPayment(business.ctx, created.invoice.id, {
      amount: 1360,
      method: "upi",
    } as never);
    detail = await container.invoices.get(business.ctx, created.invoice.id);
    expect(detail.invoice.status).toBe("completed");
    expect(detail.amountDue).toBe(0);
  });

  it("blocks a payment against a draft", async () => {
    const created = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    await expect(
      container.invoices.recordPayment(business.ctx, created.invoice.id, {
        amount: 100,
        method: "cash",
      } as never),
    ).rejects.toThrow(/finalize/i);
  });

  it("copies an invoice into a fresh, unnumbered draft", async () => {
    const source = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    await container.invoices.finalize(business.ctx, source.invoice.id);

    const copy = await container.invoices.duplicate(business.ctx, source.invoice.id);
    expect(copy.invoice.id).not.toBe(source.invoice.id);
    expect(copy.invoice.status).toBe("draft");
    expect(copy.invoice.invoiceNumber).toMatch(/^DRAFT-/);
    expect(copy.invoice.amountPaid).toBe(0);
    expect(copy.lines).toHaveLength(source.lines.length);
    expect(copy.invoice.grandTotal).toBe(source.invoice.grandTotal);
  });

  it("snapshots the customer address so later edits do not rewrite history", async () => {
    const created = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    await container.invoices.finalize(business.ctx, created.invoice.id);
    const before = await container.invoices.get(business.ctx, created.invoice.id);

    await container.masters.updateParty(business.ctx, business.partyId, {
      name: "Renamed Buyer",
      addressLine1: "99 New Street",
    });

    const after = await container.invoices.get(business.ctx, created.invoice.id);
    expect(after.invoice.billTo.name).toBe(before.invoice.billTo.name);
    expect(after.invoice.billTo.addressLine1).toBe("2 Buyer Street");
  });

  it("refuses to cancel an invoice whose IRN is live", async () => {
    const created = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    await container.invoices.finalize(business.ctx, created.invoice.id);
    await container.database.client`
      UPDATE invoices SET einvoice_status = 'generated' WHERE id = ${created.invoice.id}
    `;
    await expect(
      container.invoices.cancel(business.ctx, created.invoice.id, "test"),
    ).rejects.toThrow(/cancel the e-invoice/i);
  });
});
