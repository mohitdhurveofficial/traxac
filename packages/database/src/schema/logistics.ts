import { pgTable, text, uuid, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { createdAt, updatedAt } from "./_shared.js";

/** Transporters remembered per tenant for fast e-Way Bill entry. */
export const transporters = pgTable(
  "transporters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** GSTIN or 15-char TRANSIN issued by the EWB portal. */
    transporterId: text("transporter_id"),
    phone: text("phone"),
    email: text("email"),
    addressLine1: text("address_line1"),
    city: text("city"),
    stateCode: text("state_code"),
    pincode: text("pincode"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("transporters_tenant_idx").on(t.tenantId),
    uniqueIndex("transporters_tenant_transid_uq").on(t.tenantId, t.transporterId),
  ],
);

/** Vehicles remembered per tenant for fast EWB Part-B entry. */
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleNo: text("vehicle_no").notNull(),
    /** R = Regular, O = Over Dimensional Cargo. */
    vehicleType: text("vehicle_type").notNull().default("R"),
    transporterId: uuid("transporter_id").references(() => transporters.id, {
      onDelete: "set null",
    }),
    driverName: text("driver_name"),
    driverPhone: text("driver_phone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vehicles_tenant_idx").on(t.tenantId),
    uniqueIndex("vehicles_tenant_vehicle_uq").on(t.tenantId, t.vehicleNo),
  ],
);
