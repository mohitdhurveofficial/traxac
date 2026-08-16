import {
  pgTable, text, uuid, boolean, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, tsCol, updatedAt } from "./_shared.js";

/** Tenant = one business on Traxac. Every tenant-owned row references this. */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("trial"),
  status: text("status").notNull().default("active"), // active | suspended | closed
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Platform-level user accounts. A user may belong to several tenants. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  lastLoginAt: tsCol("last_login_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Membership joins users <-> tenants with a role. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | admin | member | viewer
    status: text("status").notNull().default("active"), // active | invited | disabled
    invitedByUserId: uuid("invited_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_user_tenant_uq").on(t.userId, t.tenantId),
    index("memberships_tenant_idx").on(t.tenantId),
  ],
);

/** Per-tenant application preferences (defaults that speed up billing). */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  defaultGstinId: uuid("default_gstin_id"),
  /** Auto-submit the e-Invoice as soon as an invoice is finalized. */
  autoGenerateEinvoice: boolean("auto_generate_einvoice").notNull().default(true),
  /** Auto-generate the e-Way Bill when the invoice crosses the threshold. */
  autoGenerateEwb: boolean("auto_generate_ewb").notNull().default(false),
  /** Invoice value (paise) above which an EWB is required. Default Rs 50,000. */
  ewbThreshold: jsonb("ewb_threshold").$type<{ paise: number }>().notNull().default({ paise: 5_000_000 }),
  defaultTerms: text("default_terms"),
  defaultNotes: text("default_notes"),
  logoDocumentId: uuid("logo_document_id"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
