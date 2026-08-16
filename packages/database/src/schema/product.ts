import {
  pgTable, text, timestamp, uuid, numeric, integer, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** Products / services with default HSN & GST rate for fast repeat billing. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    hsnSac: text("hsn_sac").notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    unit: text("unit").notNull().default("NOS"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    sku: text("sku"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_tenant_idx").on(t.tenantId),
    uniqueIndex("products_tenant_name_uq").on(t.tenantId, t.name),
  ],
);

/** Units of measure (master list, seeded once per tenant or globally). */
export const units = pgTable("units", {
  code: text("code").primaryKey(), // NOS, KGS, MTR, LTR, BOX...
  description: text("description").notNull(),
  qtyDecimals: integer("qty_decimals").notNull().default(0),
});
