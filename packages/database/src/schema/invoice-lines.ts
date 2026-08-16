import {
  pgTable, text, timestamp, uuid, integer, numeric, index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** One billable line on an invoice (snapshot of product + rate at time of billing). */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    productId: uuid("product_id"),
    position: integer("position").notNull().default(0),
    description: text("description").notNull(),
    hsnSac: text("hsn_sac").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unit: text("unit").notNull().default("NOS"),
    unitPrice: integer("unit_price").notNull(),       // paise
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    taxableValue: integer("taxable_value").notNull(),  // paise
    cgst: integer("cgst").notNull(),
    sgst: integer("sgst").notNull(),
    igst: integer("igst").notNull(),
    lineTotal: integer("line_total").notNull(),        // paise
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoice_lines_invoice_idx").on(t.invoiceId),
    index("invoice_lines_tenant_idx").on(t.tenantId),
  ],
);

/** Additional charges (freight, packing, insurance) with GST treatment. */
export const invoiceCharges = pgTable(
  "invoice_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    position: integer("position").notNull().default(0),
    label: text("label").notNull(),
    amount: integer("amount").notNull(),               // paise
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxAmount: integer("tax_amount").notNull().default(0), // paise
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoice_charges_invoice_idx").on(t.invoiceId)],
);
