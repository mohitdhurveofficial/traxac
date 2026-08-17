import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invoices } from "@traxac/database";
import type { Container } from "../src/index.js";
import { buildIrpPayload } from "../src/compliance/payload-builder.js";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  type TestBusiness,
} from "./helpers.js";

/**
 * Credit and debit notes.
 *
 * A note must carry the original document's number and date: the IRP requires
 * them in `PrecDocDtls` and rejects the note without them. Those two fields
 * existed on the schema and were read by the payload builder, but nothing ever
 * wrote them — so every note would have been refused by the portal. These
 * tests cover the whole path from input to portal payload.
 */
describe("credit and debit notes", () => {
  let container: Container;
  let business: TestBusiness;
  let originalId: string;
  let originalNumber: string;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "notes",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    const draft = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    const finalized = await container.invoices.finalize(business.ctx, draft.invoice.id);
    originalId = finalized.id;
    originalNumber = finalized.invoiceNumber;
  }, 60_000);

  afterAll(async () => {
    await container?.shutdown();
  });

  const noteInput = (docType: "credit_note" | "debit_note", overrides = {}) =>
    invoiceInput(business, {
      docType,
      referenceInvoiceId: originalId,
      reason: "Rate difference agreed with the customer",
      ...overrides,
    });

  it("snapshots the original number and date onto a credit note", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("credit_note"));
    expect(note.invoice.docType).toBe("credit_note");
    expect(note.invoice.referenceInvoiceId).toBe(originalId);
    expect(note.invoice.referenceInvoiceNumber).toBe(originalNumber);
    expect(note.invoice.referenceInvoiceDate).toBeInstanceOf(Date);
  });

  it("uses the credit-note series, not the invoice series", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("credit_note"));
    const finalized = await container.invoices.finalize(business.ctx, note.invoice.id);
    expect(finalized.series).toBe("CRN");
    expect(finalized.invoiceNumber).toMatch(/^CRN\/\d{4}-\d{2}\/\d{4}$/);
  });

  it("numbers debit notes in their own independent series", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("debit_note"));
    const finalized = await container.invoices.finalize(business.ctx, note.invoice.id);
    expect(finalized.series).toBe("DBN");
    expect(finalized.invoiceNumber).toMatch(/^DBN\/\d{4}-\d{2}\/0001$/);
  });

  it("carries the reference into the IRP payload as PrecDocDtls", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("credit_note"));
    const finalized = await container.invoices.finalize(business.ctx, note.invoice.id);
    const detail = await container.invoices.get(business.ctx, finalized.id);

    const payload = buildIrpPayload({
      invoice: detail.invoice,
      lines: detail.lines,
      charges: detail.charges,
    });

    expect(payload.DocDtls.Typ).toBe("CRN");
    expect(payload.DocDtls.No).toBe(finalized.invoiceNumber);
    expect(payload.RefDtls?.PrecDocDtls).toHaveLength(1);
    expect(payload.RefDtls?.PrecDocDtls?.[0]?.InvNo).toBe(originalNumber);
    expect(payload.RefDtls?.PrecDocDtls?.[0]?.InvDt).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("maps a debit note to the DBN document type for the portal", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("debit_note"));
    const detail = await container.invoices.get(business.ctx, note.invoice.id);
    const payload = buildIrpPayload({
      invoice: detail.invoice,
      lines: detail.lines,
      charges: detail.charges,
    });
    expect(payload.DocDtls.Typ).toBe("DBN");
    expect(payload.RefDtls?.PrecDocDtls?.[0]?.InvNo).toBe(originalNumber);
  });

  it("refuses a note with no reference", async () => {
    await expect(
      container.invoices.createDraft(
        business.ctx,
        invoiceInput(business, {
          docType: "credit_note",
          referenceInvoiceId: null,
        }),
      ),
    ).rejects.toThrow(/must reference the original invoice/i);
  });

  it("refuses a note against a draft", async () => {
    const draft = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    await expect(
      container.invoices.createDraft(
        business.ctx,
        noteInput("credit_note", {
          referenceInvoiceId: draft.invoice.id,
        }),
      ),
    ).rejects.toThrow(/still a draft/i);
  });

  it("refuses a note against another note", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("credit_note"));
    const finalized = await container.invoices.finalize(business.ctx, note.invoice.id);
    await expect(
      container.invoices.createDraft(
        business.ctx,
        noteInput("credit_note", {
          referenceInvoiceId: finalized.id,
        }),
      ),
    ).rejects.toThrow(/only reference a tax invoice/i);
  });

  it("refuses a note referencing another business's invoice", async () => {
    const other = await createBusiness(container, {
      slug: "notes-other",
      gstin: "29AAGCB7383J1Z4",
      stateCode: "29",
    });
    await expect(
      container.invoices.createDraft(
        other.ctx,
        invoiceInput(other, {
          docType: "credit_note",
          referenceInvoiceId: originalId,
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("keeps the snapshot when the original is later amended", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("credit_note"));
    const finalized = await container.invoices.finalize(business.ctx, note.invoice.id);

    // Simulate the original being renumbered by an out-of-band correction.
    await container.database.db
      .update(invoices)
      .set({ invoiceNumber: "INV/2026-27/9999" })
      .where(eq(invoices.id, originalId));

    const reloaded = await container.invoices.get(business.ctx, finalized.id);
    expect(reloaded.invoice.referenceInvoiceNumber).toBe(originalNumber);

    await container.database.db
      .update(invoices)
      .set({ invoiceNumber: originalNumber })
      .where(eq(invoices.id, originalId));
  });

  it("computes note totals with the same engine as an invoice", async () => {
    const note = await container.invoices.createDraft(business.ctx, noteInput("credit_note"));
    // 2 × ₹1,000 intra-state at 18% — identical arithmetic to a tax invoice.
    expect(note.invoice.taxableValue).toBe(200_000);
    expect(note.invoice.cgst).toBe(18_000);
    expect(note.invoice.sgst).toBe(18_000);
    expect(note.invoice.grandTotal).toBe(236_000);
  });

  it("lists notes alongside invoices and filters by document type", async () => {
    const all = await container.invoices.list(business.ctx, {
      limit: 100,
      page: 1,
      sort: "createdAt",
      order: "desc",
    } as never);
    expect(all.items.some((i) => i.docType === "credit_note")).toBe(true);

    const onlyNotes = await container.invoices.list(business.ctx, {
      limit: 100,
      page: 1,
      sort: "createdAt",
      order: "desc",
      docType: "credit_note",
    } as never);
    expect(onlyNotes.total).toBeGreaterThan(0);
    expect(onlyNotes.items.every((i) => i.docType === "credit_note")).toBe(true);
  });
});
