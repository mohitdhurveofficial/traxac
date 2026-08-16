import {
  pgTable, text, timestamp, uuid, integer, jsonb, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { gstins } from "./party.js";

/**
 * Invoice header. Bill From / Bill To / Dispatch From / Ship To are stored
 * as address snapshots (jsonb) so historical documents never change when
 * master data changes later.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** Human number, e.g. INV/2026-27/0001. Unique per tenant+series. */
    invoiceNumber: text("invoice_number").notNull(),
    series: text("series").notNull().default("INV"),
    docType: text("doc_type").notNull().default("invoice"),
    status: text("status").notNull().default("draft"),
    einvoiceStatus: text("einvoice_status").notNull().default("pending"),
    ewbStatus: text("ewb_status").notNull().default("not_required"),

    invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }),

    sellerGstinId: uuid("seller_gstin_id").references(() => gstins.id, { onDelete: "restrict" }),
    billFrom: jsonb("bill_from").notNull(), // AddressSnapshot
    billTo: jsonb("bill_to").notNull(),     // AddressSnapshot
    dispatchFrom: jsonb("dispatch_from"),   // optional plant/warehouse
    shipTo: jsonb("ship_to"),               // optional shipping address

    placeOfSupply: text("place_of_supply").notNull(),
    isExport: boolean("is_export").notNull().default(false),
    reverseCharge: boolean("reverse_charge").notNull().default(false),

    currency: text("currency").notNull().default("INR"),
    taxableValue: integer("taxable_value").notNull().default(0), // paise
    cgst: integer("cgst").notNull().default(0),
    sgst: integer("sgst").notNull().default(0),
    igst: integer("igst").notNull().default(0),
    totalTax: integer("total_tax").notNull().default(0),
    additionalCharges: integer("additional_charges").notNull().default(0),
    roundOff: integer("round_off").notNull().default(0),
    grandTotal: integer("grand_total").notNull().default(0),

    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoices_tenant_idx").on(t.tenantId),
    uniqueIndex("invoices_tenant_series_number_uq").on(t.tenantId, t.series, t.invoiceNumber),
    index("invoices_tenant_status_idx").on(t.tenantId, t.status),
  ],
);
