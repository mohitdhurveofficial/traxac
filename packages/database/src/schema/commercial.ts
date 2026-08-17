import { pgTable, text, uuid, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { gstins } from "./party.js";
import { createdAt, updatedAt } from "./_shared.js";

/**
 * Payment terms a business offers.
 *
 * Stored as master data rather than a free-text field on the invoice so the
 * same terms can drive the due date, the printed wording and the receivables
 * ageing report without three places disagreeing.
 */
export const paymentTerms = pgTable(
  "payment_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gstinId: uuid("gstin_id").references(() => gstins.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Days from the invoice date until payment falls due. */
    creditDays: integer("credit_days").notNull().default(0),
    /** Printed on the invoice; falls back to a generated sentence. */
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_terms_tenant_idx").on(t.tenantId),
    uniqueIndex("payment_terms_tenant_name_uq").on(t.tenantId, t.name),
  ],
);

/**
 * Tax configuration a business can adjust without a code change: which cess
 * applies, whether TCS is collected, and the round-off behaviour.
 */
export const taxSettings = pgTable("tax_settings", {
  gstinId: uuid("gstin_id")
    .primaryKey()
    .references(() => gstins.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** Collect TCS under section 206C(1H) on sales above the threshold. */
  tcsEnabled: boolean("tcs_enabled").notNull().default(false),
  /** Rate in percent, e.g. 0.1 for 206C(1H). */
  tcsRate: text("tcs_rate").notNull().default("0.1"),
  tcsSection: text("tcs_section").notNull().default("206C(1H)"),
  /** Round the invoice total to the nearest rupee. */
  roundOffEnabled: boolean("round_off_enabled").notNull().default(true),
  /** Charge IGST on intra-state supplies by default (rare; Sec 10(1)(b)). */
  igstOnIntraDefault: boolean("igst_on_intra_default").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
