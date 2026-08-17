import { pgTable, text, uuid, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { createdAt, updatedAt } from "./_shared.js";

/**
 * A GSTIN registration belonging to the tenant's own business.
 * A tenant may hold several (one per state).
 */
export const gstins = pgTable(
  "gstins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gstin: text("gstin").notNull(),
    legalName: text("legal_name").notNull(),
    tradeName: text("trade_name").notNull(),
    /** regular | composition | sez | casual | isd */
    registrationType: text("registration_type").notNull().default("regular"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    stateCode: text("state_code").notNull(),
    pincode: text("pincode").notNull(),
    phone: text("phone"),
    email: text("email"),
    /** Whether e-Invoicing applies to this registration (turnover based). */
    einvoiceEnabled: boolean("einvoice_enabled").notNull().default(true),
    ewbEnabled: boolean("ewb_enabled").notNull().default(true),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("gstins_tenant_gstin_uq").on(t.tenantId, t.gstin),
    index("gstins_tenant_idx").on(t.tenantId),
  ],
);

/** Branch / warehouse / plant / office belonging to a GSTIN. */
export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gstinId: uuid("gstin_id")
      .notNull()
      .references(() => gstins.id, { onDelete: "cascade" }),
    code: text("code"),
    name: text("name").notNull(),
    /** branch | warehouse | plant | office */
    kind: text("kind").notNull().default("branch"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    stateCode: text("state_code").notNull(),
    pincode: text("pincode").notNull(),
    phone: text("phone"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("branches_tenant_idx").on(t.tenantId), index("branches_gstin_idx").on(t.gstinId)],
);

/** Customers & suppliers — the tenant's trading partners. */
export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    /** customer | supplier | both */
    partyType: text("party_type").notNull().default("customer"),
    gstin: text("gstin"),
    pan: text("pan"),
    /** regular | composition | unregistered | sez | overseas | uin | deemed_export */
    registrationType: text("registration_type").notNull().default("regular"),
    email: text("email"),
    phone: text("phone"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    stateCode: text("state_code"),
    pincode: text("pincode"),
    country: text("country").notNull().default("IN"),
    /** Default place of supply (state code) used when billing this party. */
    defaultPlaceOfSupply: text("default_place_of_supply"),
    creditDays: text("credit_days"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("parties_tenant_idx").on(t.tenantId),
    index("parties_tenant_name_idx").on(t.tenantId, t.name),
    index("parties_tenant_gstin_idx").on(t.tenantId, t.gstin),
  ],
);

/**
 * Extra addresses per party: Ship To locations and Dispatch From plants.
 * Keeps repeat Bill-To/Ship-To invoices a one-click affair.
 */
export const partyAddresses = pgTable(
  "party_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** shipping | billing | dispatch */
    kind: text("kind").notNull().default("shipping"),
    /** Ship-to may carry its own GSTIN (different registration of the buyer). */
    gstin: text("gstin"),
    name: text("name").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    stateCode: text("state_code").notNull(),
    pincode: text("pincode").notNull(),
    phone: text("phone"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("party_addresses_tenant_idx").on(t.tenantId),
    index("party_addresses_party_idx").on(t.partyId),
  ],
);
