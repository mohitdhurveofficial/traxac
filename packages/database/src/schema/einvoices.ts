import {
  pgTable, text, timestamp, uuid, integer, jsonb, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/** e-Invoice (IRN) lifecycle per invoice. */
export const einvoices = pgTable(
  "einvoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    irn: text("irn").notNull(),
    ackNumber: integer("ack_number"),
    ackDate: timestamp("ack_date", { withTimezone: true }),
    signedInvoice: text("signed_invoice"),   // base64 QR-signed invoice from IRP
    qrData: text("qr_data"),                 // QR payload (JWS) for printing
    status: text("status").notNull().default("pending"),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("einvoices_irn_uq").on(t.irn),
    index("einvoices_invoice_idx").on(t.invoiceId),
    index("einvoices_tenant_idx").on(t.tenantId),
  ],
);
