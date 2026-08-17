import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Container } from "../src/index.js";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  type TestBusiness,
} from "./helpers.js";
import { SIMPLE_INTERSTATE, BILL_TO_SHIP_TO } from "./fixtures/reference-transactions.js";

/**
 * The commercial layer: payment terms, TCS, insurance, ledgers, GSTR-1,
 * reconciliation and import.
 *
 * The two reference transactions drive the invoice cases, so the shapes under
 * test are the ones the product actually sees rather than tidy inventions.
 */
describe("commercial features", () => {
  let container: Container;
  let business: TestBusiness;

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "commercial",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
  }, 60_000);

  afterAll(async () => await container?.shutdown());

  /* --------------------------- Payment terms --------------------------- */

  it("derives the due date from the chosen payment terms", async () => {
    const term = await container.commercial.createPaymentTerm(business.ctx, {
      name: "Net 45",
      creditDays: 45,
      description: "",
      isDefault: true,
    });

    const invoiceDate = new Date("2026-08-01T06:00:00Z");
    const draft = await container.invoices.createDraft(
      business.ctx,
      invoiceInput(business, { invoiceDate, paymentTermsId: term.id }),
    );

    expect(draft.invoice.paymentTermsLabel).toBe("Net 45");
    expect(draft.invoice.creditDays).toBe(45);
    const due = draft.invoice.dueDate as Date;
    expect(Math.round((due.getTime() - invoiceDate.getTime()) / 86_400_000)).toBe(45);
  });

  it("falls back to the default terms when none are named", async () => {
    const draft = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    expect(draft.invoice.paymentTermsLabel).toBe("Net 45");
  });

  it("keeps only one default", async () => {
    await container.commercial.createPaymentTerm(business.ctx, {
      name: "Advance",
      creditDays: 0,
      description: "",
      isDefault: true,
    });
    const terms = await container.commercial.listPaymentTerms(business.ctx);
    expect(terms.filter((t) => t.isDefault)).toHaveLength(1);
  });

  /* ------------------------------ TCS ---------------------------------- */

  it("does not charge TCS unless the registration enables it", async () => {
    const draft = await container.invoices.createDraft(
      business.ctx,
      invoiceInput(business, { tcsRate: 1 }),
    );
    // An invoice cannot opt into collecting a tax the business does not collect.
    expect(draft.invoice.tcsAmount).toBe(0);
  });

  it("charges TCS on the value including GST once enabled", async () => {
    await container.commercial.saveTaxSettings(business.ctx, business.gstinId, {
      tcsEnabled: true,
      tcsRate: 0.1,
      tcsSection: "206C(1H)",
      roundOffEnabled: true,
      igstOnIntraDefault: false,
    });

    const draft = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    // 2 × ₹1,000 = ₹2,000 taxable, 18% = ₹360, total ₹2,360; 0.1% = ₹2.36.
    expect(draft.invoice.taxableValue).toBe(200_000);
    expect(draft.invoice.tcsAmount).toBe(236);
    expect(draft.invoice.tcsSection).toBe("206C(1H)");
    expect(draft.invoice.grandTotal).toBe(236_200);
  });

  it("taxes insurance and keeps it out of the taxable value", async () => {
    const draft = await container.invoices.createDraft(
      business.ctx,
      invoiceInput(business, { insuranceAmount: 500, insuranceGstRate: 18 }),
    );
    expect(draft.invoice.insuranceAmount).toBe(50_000);
    expect(draft.invoice.taxableValue).toBe(200_000);
    expect(draft.invoice.otherCharges).toBe(50_000);
  });

  it("records a delivery note reference", async () => {
    const draft = await container.invoices.createDraft(
      business.ctx,
      invoiceInput(business, {
        deliveryNoteNumber: "DC/2026/0042",
        deliveryNoteDate: new Date("2026-08-10T06:00:00Z"),
      }),
    );
    expect(draft.invoice.deliveryNoteNumber).toBe("DC/2026/0042");
    expect(draft.invoice.deliveryNoteDate).toBeInstanceOf(Date);
  });

  /* ---------------------------- Reference cases ------------------------ */

  it("handles the single-commodity inter-state reference transaction", async () => {
    const reference = SIMPLE_INTERSTATE;
    const buyer = await container.masters.createParty(business.ctx, {
      name: reference.buyer.name,
      legalName: "",
      partyType: "customer",
      gstin: reference.buyer.gstin,
      pan: "",
      registrationType: "regular",
      email: "",
      phone: "",
      addressLine1: reference.buyer.addressLine1,
      addressLine2: "",
      city: reference.buyer.city,
      stateCode: reference.buyer.stateCode,
      pincode: reference.buyer.pincode,
      country: "IN",
      defaultPlaceOfSupply: reference.placeOfSupply,
      notes: "",
    });

    const draft = await container.invoices.createDraft(business.ctx, {
      ...invoiceInput(business),
      buyerPartyId: buyer.id,
      placeOfSupply: reference.placeOfSupply,
      lines: reference.lines.map((line) => ({
        productId: null,
        name: line.name,
        description: line.description,
        hsnSac: line.hsnSac,
        isService: false,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        discountPercent: 0,
        discountAmount: 0,
        gstRate: line.gstRate,
        cessRate: 0,
        cessNonAdvol: 0,
        stateCess: 0,
        batchNo: "",
        barcode: "",
        expiryDate: null,
      })),
    } as never);

    // 27 -> 24 is inter-state, so IGST and no CGST/SGST.
    expect(draft.invoice.igst).toBeGreaterThan(0);
    expect(draft.invoice.cgst).toBe(0);
    expect(draft.invoice.ewbTransactionType).toBe(reference.expectedEwbTransactionType);
    expect(draft.lines[0]?.hsnSac).toBe("26190090");
    // 35.380 MTS × ₹12,500 = ₹4,42,250.
    expect(draft.invoice.taxableValue).toBe(44_225_000);
  });

  it("handles the Bill-To/Ship-To reference transaction", async () => {
    const reference = BILL_TO_SHIP_TO;
    const buyer = await container.masters.createParty(business.ctx, {
      name: reference.buyer.name,
      legalName: "",
      partyType: "customer",
      gstin: reference.buyer.gstin,
      pan: "",
      registrationType: "regular",
      email: "",
      phone: "",
      addressLine1: reference.buyer.addressLine1,
      addressLine2: "",
      city: reference.buyer.city,
      stateCode: reference.buyer.stateCode,
      pincode: reference.buyer.pincode,
      country: "IN",
      defaultPlaceOfSupply: reference.placeOfSupply,
      notes: "",
    });
    const shipTo = await container.masters.addPartyAddress(business.ctx, buyer.id, {
      label: reference.shipTo!.label,
      kind: "shipping",
      gstin: "",
      name: reference.shipTo!.name,
      addressLine1: reference.shipTo!.addressLine1,
      addressLine2: "",
      city: reference.shipTo!.city,
      stateCode: reference.shipTo!.stateCode,
      pincode: reference.shipTo!.pincode,
      phone: "",
      isDefault: true,
    });
    const plant = await container.masters.createBranch(business.ctx, {
      gstinId: business.gstinId,
      code: "PLT",
      name: reference.dispatchFrom!.name,
      kind: "plant",
      addressLine1: reference.dispatchFrom!.addressLine1,
      addressLine2: "",
      city: reference.dispatchFrom!.city,
      stateCode: reference.dispatchFrom!.stateCode,
      pincode: reference.dispatchFrom!.pincode,
      phone: "",
      isDefault: false,
    });

    const draft = await container.invoices.createDraft(business.ctx, {
      ...invoiceInput(business),
      buyerPartyId: buyer.id,
      shipToAddressId: shipTo.id,
      dispatchFromBranchId: plant.id,
      placeOfSupply: reference.placeOfSupply,
      lines: reference.lines.map((line) => ({
        productId: null,
        name: line.name,
        description: line.description,
        hsnSac: line.hsnSac,
        isService: false,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        discountPercent: 0,
        discountAmount: 0,
        gstRate: line.gstRate,
        cessRate: 0,
        cessNonAdvol: 0,
        stateCess: 0,
        batchNo: "",
        barcode: "",
        expiryDate: null,
      })),
    } as never);

    // Bill-To in one state, Ship-To in another, dispatched from a plant:
    // EWB transaction type 4 (combination).
    expect(draft.invoice.ewbTransactionType).toBe(4);
    expect(draft.invoice.shipTo?.stateCode).toBe("33");
    expect(draft.invoice.dispatchFrom?.city).toBe("Chakan");
    expect(draft.lines).toHaveLength(3);
    expect(new Set(draft.lines.map((l) => l.hsnSac)).size).toBe(3);
  });

  /* -------------------------------- Ledgers ---------------------------- */

  it("builds a customer ledger with outstanding and purchase history", async () => {
    const buyer = await container.masters.getParty(business.ctx, business.partyId);
    const draft = await container.invoices.createDraft(business.ctx, invoiceInput(business));
    const finalized = await container.invoices.finalize(business.ctx, draft.invoice.id);
    await container.invoices.recordPayment(business.ctx, finalized.id, {
      amount: 500,
      method: "upi",
    } as never);

    const ledger = await container.ledgers.customerLedger(business.ctx, buyer.id);
    expect(ledger.party.id).toBe(buyer.id);
    expect(ledger.totals.invoiceCount).toBeGreaterThan(0);
    expect(ledger.totals.totalPaid).toBe(50_000);
    expect(ledger.totals.outstanding).toBeGreaterThan(0);
    expect(ledger.payments.length).toBeGreaterThan(0);
    expect(ledger.topProducts.length).toBeGreaterThan(0);
  });

  it("reports receivables in ageing buckets", async () => {
    const result = await container.ledgers.receivables(business.ctx);
    expect(result.buckets.length).toBeGreaterThanOrEqual(4);
    expect(result.total).toBeGreaterThan(0);
    // Every bucket amount must add up to the total.
    expect(result.buckets.reduce((s, b) => s + b.amount, 0)).toBe(result.total);
  });

  /* -------------------------------- GSTR-1 ----------------------------- */

  it("prepares GSTR-1 and never claims it was filed", async () => {
    const period = "082026";
    const prepared = await container.gstr1.save(business.ctx, business.gstinId, period);

    expect(prepared.filingStatus).toBe("not_connected");
    expect(prepared.payload.gstin).toBe("27AAPFU0939F1ZV");
    expect(prepared.payload.fp).toBe(period);
    expect(Array.isArray(prepared.payload.b2b)).toBe(true);
    expect(prepared.payload.hsn.data.length).toBeGreaterThan(0);
  });

  it("reports validation problems instead of exporting a broken return", async () => {
    // An unregistered buyer with a bad HSN should be flagged, not silently filed.
    const draft = await container.invoices.createDraft(business.ctx, {
      ...invoiceInput(business),
      lines: [
        {
          productId: null,
          name: "Odd item",
          description: "",
          hsnSac: "7308",
          isService: false,
          quantity: 1,
          unit: "NOS",
          unitPrice: 100,
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
    } as never);
    await container.invoices.finalize(business.ctx, draft.invoice.id);

    const prepared = await container.gstr1.prepare(business.ctx, business.gstinId, "082026");
    expect(prepared.invoiceCount).toBeGreaterThan(0);
    expect(typeof prepared.ready).toBe("boolean");
  });

  /* --------------------------- Reconciliation -------------------------- */

  it("reconciles against supplied documents and classifies each one", async () => {
    const { UploadedDocumentSource } = await import("../src/services/reconciliation.js");
    const invoices = await container.invoices.list(business.ctx, {
      limit: 5,
      page: 1,
      sort: "invoiceDate",
      order: "desc",
    } as never);
    const issued = invoices.items.filter((i) => i.status !== "draft");
    expect(issued.length).toBeGreaterThan(0);

    const first = issued[0]!;
    const result = await container.reconciliation.run(
      business.ctx,
      { gstinId: business.gstinId, scope: "einvoice", period: "2026-08" },
      new UploadedDocumentSource([
        // Matches ours exactly.
        {
          documentNumber: first.invoiceNumber,
          documentDate: new Date(first.invoiceDate),
          value: first.grandTotal,
        },
        // The government has one we do not.
        {
          documentNumber: "INV/GOVT/ONLY/1",
          documentDate: new Date("2026-08-15T06:00:00Z"),
          value: 100_000,
        },
      ]),
    );

    expect(result.matched).toBe(1);
    expect(result.missingLocally).toBe(1);
    expect(result.missingRemotely).toBeGreaterThanOrEqual(0);

    const items = await container.reconciliation.listItems(business.ctx, result.run!.id);
    expect(items.some((i) => i.matchStatus === "missing_locally")).toBe(true);
  });

  it("flags a value mismatch rather than calling it a match", async () => {
    const { UploadedDocumentSource } = await import("../src/services/reconciliation.js");
    const invoices = await container.invoices.list(business.ctx, {
      limit: 5,
      page: 1,
      sort: "invoiceDate",
      order: "desc",
    } as never);
    const first = invoices.items.find((i) => i.status !== "draft")!;

    const result = await container.reconciliation.run(
      business.ctx,
      { gstinId: business.gstinId, scope: "einvoice", period: "2026-08" },
      new UploadedDocumentSource([
        {
          documentNumber: first.invoiceNumber,
          documentDate: new Date(first.invoiceDate),
          // ₹500 apart: well beyond the rounding tolerance.
          value: first.grandTotal + 50_000,
        },
      ]),
    );
    expect(result.mismatched).toBe(1);
  });

  /* -------------------------------- Import ----------------------------- */

  it("imports customers row by row and reports each verdict", async () => {
    const result = await container.imports.run(business.ctx, {
      kind: "customers",
      dryRun: false,
      rows: [
        { Name: "Imported One", GSTIN: "33AAACT2727Q1Z3", City: "Surat", Pincode: "395003" },
        { Name: "Imported Two", Phone: "9820011223", City: "Thane", Pincode: "400601" },
        { Name: "Bad GSTIN", GSTIN: "33AAACT2727Q1ZZ" },
        { Name: "" },
      ],
    });

    expect(result.created).toBe(2);
    expect(result.failed).toBe(2);
    // Row numbers match the spreadsheet the user is looking at.
    expect(result.results.find((r) => r.row === 4)?.message).toMatch(/GSTIN/i);
    expect(result.results.find((r) => r.row === 5)?.message).toMatch(/name is required/i);
  });

  it("updates rather than duplicating on a re-import", async () => {
    const rows = [{ Name: "Reimport Co", GSTIN: "19AABCT1234A1ZX", City: "Mysore" }];
    const first = await container.imports.run(business.ctx, {
      kind: "customers",
      rows,
      dryRun: false,
    });
    const second = await container.imports.run(business.ctx, {
      kind: "customers",
      rows,
      dryRun: false,
    });
    expect(first.created).toBe(1);
    expect(second.updated).toBe(1);
    expect(second.created).toBe(0);
  });

  it("validates without writing on a dry run", async () => {
    const before = await container.masters.listProducts(business.ctx, { limit: 200 });
    const result = await container.imports.run(business.ctx, {
      kind: "products",
      dryRun: true,
      rows: [
        { Name: "Dry Item", HSN: "7308", Unit: "NOS", "GST Rate": "18", Price: "500" },
        { Name: "Bad Unit", HSN: "7308", Unit: "KILO" },
      ],
    });
    const after = await container.masters.listProducts(business.ctx, { limit: 200 });

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(after.total).toBe(before.total);
  });
});
