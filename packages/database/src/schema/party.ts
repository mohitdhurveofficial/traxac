import {
  pgTable, text, timestamp, uuid, numeric, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** A company's registered GSTIN (a tenant can have many). */
export const gstins = pgTable(
  "gstins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    gstin: text("gstin").notNull(),
    tradeName: text("trade_name").notNull(),
    legalName: text("legal_name").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    stateCode: text("state_code").notNull(),
    pincode: text("pincode").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gstins_tenant_gstin_uq").on(t.tenantId, t.gstin)],
);

/** Branch / warehouse / plant belonging to a GSTIN. */
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    gstinId: uuid("gstin_id").notNull().references(() => gstins.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLine1: text("addr1").notNull(),
    city: text("city").notNull(),
    stateCode: text("branches_state_code").notNull(),
    pincode: text("pincode").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("branches_tenant_idx").on(t.tenantId)],
);

/** Customers & suppliers. */
export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    partyType: text("party_type").notNull().default("customer"),
    gstin: text("gstin"),
    pan: text("pan"),
    email: text("email"),
    phone: text("phone"),
    addressLine1: text("address_line1"),
    city: text("city"),
    stateCode: text("state_code"),
    pincode: text("pincode"),
    isExport: boolean("is_export").notNull().default(false),
    receivables: numeric("receivables", { precision: 14, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("parties_tenant_idx").on(t.tenantId),
    index("parties_tenant_name_idx").on(t.tenantId, t.name),
  ],
);
