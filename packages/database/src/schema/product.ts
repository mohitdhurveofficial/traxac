import {
  pgTable,
  text,
  uuid,
  numeric,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { gstins } from "./party.js";
import { createdAt, money, updatedAt } from "./_shared.js";

/** Products / services with default HSN & GST rate for fast repeat billing. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Null means the item is available to every registration. */
    gstinId: uuid("gstin_id").references(() => gstins.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku"),
    hsnSac: text("hsn_sac").notNull(),
    isService: boolean("is_service").notNull().default(false),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    cessRate: numeric("cess_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    unit: text("unit").notNull().default("NOS"),
    /** Default selling price in paise. */
    unitPrice: money("unit_price"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_tenant_idx").on(t.tenantId),
    index("products_tenant_gstin_idx").on(t.tenantId, t.gstinId),
    index("products_tenant_hsn_idx").on(t.tenantId, t.hsnSac),
    uniqueIndex("products_tenant_name_uq").on(t.tenantId, t.name),
  ],
);

/** Global HSN/SAC master used for lookup & autocompletion. */
export const hsnCodes = pgTable(
  "hsn_codes",
  {
    code: text("code").primaryKey(),
    description: text("description").notNull(),
    /** Most common GST rate for this code; the user can always override. */
    defaultGstRate: numeric("default_gst_rate", { precision: 5, scale: 2 }),
    isService: boolean("is_service").notNull().default(false),
  },
  (t) => [index("hsn_codes_description_idx").on(t.description)],
);

/** Unit Quantity Codes (UQC) as accepted by the IRP / EWB APIs. */
export const units = pgTable("units", {
  code: text("code").primaryKey(), // NOS, KGS, MTR, LTR, BOX...
  description: text("description").notNull(),
  qtyDecimals: integer("qty_decimals").notNull().default(0),
});
