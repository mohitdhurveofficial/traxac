import {
  pgTable, text, timestamp, uuid, integer, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** e-Way Bill lifecycle: generate / Part-B / extend / update / cancel. */
export const ewayBills = pgTable(
  "eway_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    ewbNumber: text("ewb_number"),            // 12-digit EWB no once generated
    status: text("status").notNull().default("pending"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    /** 1=100km .. roughly; actual validity per NIC rules. */
    distanceKm: integer("distance_km"),
    transporterId: text("transporter_id"),
    transporterName: text("transporter_name"),
    vehicleNo: text("vehicle_no"),
    lrNo: text("lr_no"),
    lrDate: timestamp("lr_date", { withTimezone: true }),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("eway_bills_ewb_number_uq").on(t.ewbNumber),
    index("eway_bills_invoice_idx").on(t.invoiceId),
    index("eway_bills_tenant_idx").on(t.tenantId),
    index("eway_bills_valid_until_idx").on(t.validUntil),
  ],
);
