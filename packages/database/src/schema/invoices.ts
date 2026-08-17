import {
  pgTable,
  text,
  uuid,
  integer,
  numeric,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { gstins, branches, parties } from "./party.js";
import { transporters } from "./logistics.js";
import { createdAt, money, tsCol, updatedAt } from "./_shared.js";

/**
 * Frozen copy of an address as it existed when the document was issued.
 * Historical documents must never change when master data is edited later.
 */
export interface AddressSnapshot {
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  /** URP for unregistered persons, as required by the IRP schema. */
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  stateCode: string;
  stateName?: string | null;
  pincode: string;
  phone?: string | null;
  email?: string | null;
  country?: string | null;
}

/** Per-GSTIN, per-financial-year document number series. */
export const invoiceSequences = pgTable(
  "invoice_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gstinId: uuid("gstin_id")
      .notNull()
      .references(() => gstins.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull().default("invoice"),
    series: text("series").notNull().default("INV"),
    /** e.g. "2026-27" */
    financialYear: text("financial_year").notNull(),
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    padding: integer("padding").notNull().default(4),
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoice_sequences_uq").on(
      t.tenantId,
      t.gstinId,
      t.docType,
      t.series,
      t.financialYear,
    ),
  ],
);

/**
 * Invoice header. Bill From / Bill To / Dispatch From / Ship To are stored as
 * snapshots (jsonb) alongside the master-data ids used to create them.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    /** Human number, e.g. INV/2026-27/0001. Unique per tenant+gstin+FY+series. */
    invoiceNumber: text("invoice_number").notNull(),
    series: text("series").notNull().default("INV"),
    financialYear: text("financial_year").notNull(),
    /** invoice | credit_note | debit_note | delivery_challan | bill_of_supply */
    docType: text("doc_type").notNull().default("invoice"),
    /** b2b | b2c | export_wp | export_wop | sez_wp | sez_wop | deemed_export */
    supplyCategory: text("supply_category").notNull().default("b2b"),

    status: text("status").notNull().default("draft"),
    einvoiceStatus: text("einvoice_status").notNull().default("not_required"),
    ewbStatus: text("ewb_status").notNull().default("not_required"),

    invoiceDate: tsCol("invoice_date").notNull(),
    dueDate: tsCol("due_date"),

    gstinId: uuid("gstin_id")
      .notNull()
      .references(() => gstins.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    buyerPartyId: uuid("buyer_party_id").references(() => parties.id, { onDelete: "set null" }),

    billFrom: jsonb("bill_from").$type<AddressSnapshot>().notNull(),
    billTo: jsonb("bill_to").$type<AddressSnapshot>().notNull(),
    /** Set when goods leave from somewhere other than Bill From (plant/3rd party). */
    dispatchFrom: jsonb("dispatch_from").$type<AddressSnapshot | null>(),
    /** Set for Bill-To/Ship-To transactions. */
    shipTo: jsonb("ship_to").$type<AddressSnapshot | null>(),

    placeOfSupply: text("place_of_supply").notNull(),
    isExport: boolean("is_export").notNull().default(false),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    /** IGST charged even though supplier and POS share a state (Sec 10(1)(b)). */
    igstOnIntra: boolean("igst_on_intra").notNull().default(false),

    currency: text("currency").notNull().default("INR"),
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 4 }).notNull().default("1"),
    exportInfo: jsonb("export_info").$type<{
      shippingBillNo?: string;
      shippingBillDate?: string;
      portCode?: string;
      countryCode?: string;
      refundClaim?: boolean;
    } | null>(),

    // --- totals, all integer paise ---
    grossValue: money("gross_value"),
    totalDiscount: money("total_discount"),
    taxableValue: money("taxable_value"),
    cgst: money("cgst"),
    sgst: money("sgst"),
    igst: money("igst"),
    cess: money("cess"),
    cessNonAdvol: money("cess_non_advol"),
    stateCess: money("state_cess"),
    totalTax: money("total_tax"),
    otherCharges: money("other_charges"),
    /** Insurance recovered from the buyer, taxed like any other charge. */
    insuranceAmount: money("insurance_amount"),
    /**
     * Tax Collected at Source under 206C(1H).
     * Charged on the invoice total including GST, not on the taxable value,
     * and it is not a GST component — it is an income-tax collection that
     * sits outside the tax breakup.
     */
    tcsRate: numeric("tcs_rate", { precision: 5, scale: 3 }).notNull().default("0"),
    tcsAmount: money("tcs_amount"),
    tcsSection: text("tcs_section"),
    roundOff: money("round_off"),
    grandTotal: money("grand_total"),
    amountPaid: money("amount_paid"),

    // --- transport (Part-A/Part-B source of truth on the invoice) ---
    ewbRequired: boolean("ewb_required").notNull().default(false),
    transporterId: uuid("transporter_id").references(() => transporters.id, {
      onDelete: "set null",
    }),
    /** 1=Road 2=Rail 3=Air 4=Ship */
    transportMode: integer("transport_mode"),
    distanceKm: integer("distance_km"),
    vehicleNo: text("vehicle_no"),
    vehicleType: text("vehicle_type"),
    /** LR / RR / Airway Bill / Bill of Lading number. */
    transportDocNo: text("transport_doc_no"),
    transportDocDate: tsCol("transport_doc_date"),
    /** EWB sub-supply type: 1=Supply 2=Import 3=Export 4=Job Work ... */
    subSupplyType: text("sub_supply_type").notNull().default("1"),
    /** 1=Regular 2=Bill To - Ship To 3=Bill From - Dispatch From 4=Combination */
    ewbTransactionType: integer("ewb_transaction_type").notNull().default(1),

    /** Credit/Debit notes reference the original invoice. */
    referenceInvoiceId: uuid("reference_invoice_id"),
    referenceInvoiceNumber: text("reference_invoice_number"),
    referenceInvoiceDate: tsCol("reference_invoice_date"),
    reason: text("reason"),

    poNumber: text("po_number"),
    poDate: tsCol("po_date"),
    /** Delivery note / challan reference accompanying the consignment. */
    deliveryNoteNumber: text("delivery_note_number"),
    deliveryNoteDate: tsCol("delivery_note_date"),
    /** Chosen payment terms; the due date is derived from its credit days. */
    paymentTermsId: uuid("payment_terms_id"),
    paymentTermsLabel: text("payment_terms_label"),
    creditDays: integer("credit_days"),
    notes: text("notes"),
    terms: text("terms"),

    finalizedAt: tsCol("finalized_at"),
    cancelledAt: tsCol("cancelled_at"),
    cancelledByUserId: uuid("cancelled_by_user_id"),
    cancelReason: text("cancel_reason"),

    createdByUserId: uuid("created_by_user_id"),
    updatedByUserId: uuid("updated_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_number_uq").on(
      t.tenantId,
      t.gstinId,
      t.docType,
      t.financialYear,
      t.invoiceNumber,
    ),
    index("invoices_tenant_idx").on(t.tenantId),
    index("invoices_tenant_status_idx").on(t.tenantId, t.status),
    index("invoices_tenant_date_idx").on(t.tenantId, t.invoiceDate),
    index("invoices_tenant_buyer_idx").on(t.tenantId, t.buyerPartyId),
    index("invoices_tenant_einvoice_status_idx").on(t.tenantId, t.einvoiceStatus),
    index("invoices_tenant_ewb_status_idx").on(t.tenantId, t.ewbStatus),
    // Billing history is filtered by registration far more often than not.
    index("invoices_tenant_gstin_date_idx").on(t.tenantId, t.gstinId, t.invoiceDate),
    // Receivables ageing scans unpaid invoices by due date.
    index("invoices_tenant_due_idx").on(t.tenantId, t.dueDate),
    index("invoices_tenant_number_idx").on(t.tenantId, t.invoiceNumber),
    index("invoices_reference_idx").on(t.referenceInvoiceId),
  ],
);

/** Payments recorded against an invoice (drives completed/partially-paid). */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amount: money("amount"),
    paidAt: tsCol("paid_at").notNull().defaultNow(),
    /** cash | upi | neft | rtgs | cheque | card | other */
    method: text("method").notNull().default("other"),
    reference: text("reference"),
    notes: text("notes"),
    recordedByUserId: uuid("recorded_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_payments_invoice_idx").on(t.invoiceId),
    index("invoice_payments_tenant_idx").on(t.tenantId),
  ],
);
