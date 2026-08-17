import { pgTable, text, uuid, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { createdAt, updatedAt } from "./_shared.js";

/**
 * Verified taxpayer and transporter details, cached per tenant.
 *
 * Cached rather than fetched on every keystroke because the government
 * register changes rarely, the portals rate-limit, and a lookup costs an
 * authenticated round trip. `fetchedAt` is the whole point: nothing here is
 * presented as current without saying when it was last confirmed.
 *
 * Scoped per tenant even though a GSTIN is public information. Two reasons:
 * one tenant's lookup volume must not be inferable by another, and the row
 * records *which tenant's credentials* obtained it — a fact that belongs to
 * that tenant alone.
 *
 * `kind` separates the two registers. A TRANSIN row can never satisfy a GSTIN
 * lookup: an enrolled transporter has no registration status, and answering a
 * "is this GSTIN active?" question from a transporter record would be a
 * fabricated answer.
 */
export const gstinRegistry = pgTable(
  "gstin_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** "gstin" for the taxpayer register, "transin" for enrolled transporters. */
    kind: text("kind").notNull(),
    /** The GSTIN or TRANSIN looked up, uppercased. */
    identifier: text("identifier").notNull(),

    legalName: text("legal_name"),
    tradeName: text("trade_name"),
    /** Parsed status: ACT / CNL / INA / PRO / UNKNOWN. Null for a TRANSIN. */
    status: text("status"),
    /** Exactly what the portal sent, kept because the parse is lossy. */
    statusRaw: text("status_raw"),
    taxpayerType: text("taxpayer_type"),
    /** blocked / unblocked / unknown — e-Way Bill generation block. */
    blockStatus: text("block_status"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    /** IRP-only granular parts, so a cached read matches a fresh lookup. */
    street: text("street"),
    location: text("location"),
    floorNumber: text("floor_number"),
    buildingNumber: text("building_number"),
    buildingName: text("building_name"),
    stateCode: text("state_code"),
    pincode: text("pincode"),
    jurisdiction: text("jurisdiction"),

    /** Which register answered: "irp" or "ewb". */
    source: text("source").notNull(),
    environment: text("environment").notNull(),
    /**
     * The provider's response as received, minus transport ciphertext. Kept so
     * a field we do not model yet is not lost, and so an operator can see
     * exactly what the government said.
     */
    raw: jsonb("raw"),
    /** When the portal actually answered. Drives every staleness decision. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("gstin_registry_uq").on(t.tenantId, t.kind, t.identifier),
    index("gstin_registry_tenant_idx").on(t.tenantId),
    index("gstin_registry_fetched_idx").on(t.fetchedAt),
  ],
);
