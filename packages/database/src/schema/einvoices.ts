import { pgTable, text, uuid, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { invoices } from "./invoices.js";
import { createdAt, tsCol, updatedAt } from "./_shared.js";

/** e-Invoice (IRN) lifecycle — exactly one row per invoice. */
export const einvoices = pgTable(
  "einvoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** Seller GSTIN the IRN was generated under. */
    gstin: text("gstin").notNull(),
    provider: text("provider").notNull().default("nic"),
    environment: text("environment").notNull().default("sandbox"),

    status: text("status").notNull().default("pending"),
    irn: text("irn"),
    ackNumber: text("ack_number"),
    ackDate: tsCol("ack_date"),
    /** Signed invoice JWS returned by the IRP. */
    signedInvoice: text("signed_invoice"),
    /** Signed QR code JWS — the payload printed as a QR on the PDF. */
    signedQrCode: text("signed_qr_code"),
    /** EWB number when the IRP generated it together with the IRN. */
    ewbNumber: text("ewb_number"),

    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    errorCode: text("error_code"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),

    cancelledAt: tsCol("cancelled_at"),
    /** 1=Duplicate 2=Data entry mistake 3=Order cancelled 4=Others */
    cancelReasonCode: text("cancel_reason_code"),
    cancelRemark: text("cancel_remark"),
    cancelResponse: jsonb("cancel_response"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("einvoices_invoice_uq").on(t.invoiceId),
    uniqueIndex("einvoices_irn_uq").on(t.irn),
    index("einvoices_tenant_idx").on(t.tenantId),
    index("einvoices_tenant_status_idx").on(t.tenantId, t.status),
  ],
);
