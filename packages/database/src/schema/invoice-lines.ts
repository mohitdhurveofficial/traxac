import {
  pgTable, text, uuid, integer, numeric, boolean, index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { invoices } from "./invoices.js";
import { products } from "./product.js";
import { createdAt, money, tsCol } from "./_shared.js";

/**
 * One billable line. Product details are snapshotted at billing time so a
 * later price/HSN change never rewrites history.
 */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),

    name: text("name").notNull(),
    description: text("description"),
    hsnSac: text("hsn_sac").notNull(),
    isService: boolean("is_service").notNull().default(false),
    barcode: text("barcode"),
    batchNo: text("batch_no"),
    expiryDate: tsCol("expiry_date"),

    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    unit: text("unit").notNull().default("NOS"),
    unitPrice: money("unit_price"),

    discountPercent: numeric("discount_percent", { precision: 6, scale: 3 }).notNull().default("0"),
    discountAmount: money("discount_amount"),

    grossValue: money("gross_value"),
    taxableValue: money("taxable_value"),

    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    cgst: money("cgst"),
    sgst: money("sgst"),
    igst: money("igst"),
    cessRate: numeric("cess_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    cess: money("cess"),
    cessNonAdvol: money("cess_non_advol"),
    stateCess: money("state_cess"),
    totalTax: money("total_tax"),
    lineTotal: money("line_total"),

    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_lines_invoice_idx").on(t.invoiceId),
    index("invoice_lines_tenant_idx").on(t.tenantId),
    index("invoice_lines_hsn_idx").on(t.tenantId, t.hsnSac),
  ],
);

/** Freight, packing, insurance and other invoice-level charges. */
export const invoiceCharges = pgTable(
  "invoice_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    label: text("label").notNull(),
    /** freight | insurance | packing | loading | other */
    kind: text("kind").notNull().default("other"),
    hsnSac: text("hsn_sac"),
    amount: money("amount"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    cgst: money("cgst"),
    sgst: money("sgst"),
    igst: money("igst"),
    taxAmount: money("tax_amount"),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoice_charges_invoice_idx").on(t.invoiceId),
    index("invoice_charges_tenant_idx").on(t.tenantId),
  ],
);
