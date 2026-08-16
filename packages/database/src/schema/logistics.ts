import {
  pgTable, text, timestamp, uuid, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** Transporters (GSP-linked or standalone) remembered for repeat billing. */
export const transporters = pgTable(
  "transporters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transporterId: text("transporter_id"), // GSTIN or Transporter ID from EWB portal
    phone: text("phone"),
    email: text("email"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transporters_tenant_idx").on(t.tenantId)],
);

/** Vehicles remembered per tenant for fast EWB Part-B entry. */
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    vehicleNo: text("vehicle_no").notNull(),
    vehicleType: text("vehicle_type").notNull().default("R"), // R=Regular, O=Over Dimensional
    isActive: boolean("is_active").notNull().default(true),
    lastTransporterId: uuid("last_transporter_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vehicle_tenant_idx").on(t.tenantId),
    uniqueIndex("vehicles_tenant_vehicle_uq").on(t.tenantId, t.vehicleNo),
  ],
);
