import { pgTable, text, uuid, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { invoices } from "./invoices.js";
import { createdAt, tsCol, updatedAt } from "./_shared.js";

/** e-Way Bill lifecycle: generate / Part-B / extend / update / cancel. */
export const ewayBills = pgTable(
  "eway_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    gstin: text("gstin").notNull(),
    provider: text("provider").notNull().default("nic"),
    environment: text("environment").notNull().default("sandbox"),

    /** 12-digit EWB number once generated. */
    ewbNumber: text("ewb_number"),
    status: text("status").notNull().default("pending"),
    generatedAt: tsCol("generated_at"),
    validFrom: tsCol("valid_from"),
    validUntil: tsCol("valid_until"),
    distanceKm: integer("distance_km"),

    docType: text("doc_type").notNull().default("INV"),
    /** O = Outward, I = Inward */
    supplyType: text("supply_type").notNull().default("O"),
    subSupplyType: text("sub_supply_type").notNull().default("1"),
    transactionType: integer("transaction_type").notNull().default(1),

    transporterId: text("transporter_id"),
    transporterName: text("transporter_name"),
    transportMode: integer("transport_mode"),
    vehicleNo: text("vehicle_no"),
    vehicleType: text("vehicle_type"),
    transportDocNo: text("transport_doc_no"),
    transportDocDate: tsCol("transport_doc_date"),

    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    errorCode: text("error_code"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),

    extensionCount: integer("extension_count").notNull().default(0),
    cancelledAt: tsCol("cancelled_at"),
    /** 1=Duplicate 2=Order cancelled 3=Data entry mistake 4=Others */
    cancelReasonCode: text("cancel_reason_code"),
    cancelRemark: text("cancel_remark"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("eway_bills_ewb_number_uq").on(t.ewbNumber),
    index("eway_bills_invoice_idx").on(t.invoiceId),
    index("eway_bills_tenant_idx").on(t.tenantId),
    index("eway_bills_tenant_status_idx").on(t.tenantId, t.status),
    index("eway_bills_valid_until_idx").on(t.validUntil),
  ],
);

/** Append-only history of every EWB action (who, when, what the portal said). */
export const ewbEvents = pgTable(
  "ewb_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ewayBillId: uuid("eway_bill_id")
      .notNull()
      .references(() => ewayBills.id, { onDelete: "cascade" }),
    /** generated | part_b_updated | transporter_updated | extended | cancelled | rejected | failed */
    eventType: text("event_type").notNull(),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    note: text("note"),
    actorUserId: uuid("actor_user_id"),
    actorLabel: text("actor_label"),
    occurredAt: tsCol("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("ewb_events_ewb_idx").on(t.ewayBillId),
    index("ewb_events_tenant_idx").on(t.tenantId),
  ],
);
