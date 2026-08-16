/** Lifecycle statuses shared across API, worker, database and web. */

export const INVOICE_STATUSES = [
  "draft",       // editable, no number consumed yet for e-invoicing
  "pending",     // finalized; compliance work queued
  "generated",   // IRN and/or EWB successfully generated
  "failed",      // a government API call failed; retryable
  "cancelled",
  "completed",   // fully paid / closed
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EINVOICE_STATUSES = [
  "not_required",
  "pending",
  "queued",
  "processing",
  "generated",
  "failed",
  "cancelled",
] as const;
export type EinvoiceStatus = (typeof EINVOICE_STATUSES)[number];

export const EWB_STATUSES = [
  "not_required",
  "pending",
  "queued",
  "processing",
  "generated",
  "part_b_pending", // Part-A generated, vehicle details still awaited
  "failed",
  "expired",
  "cancelled",
] as const;
export type EwbStatus = (typeof EWB_STATUSES)[number];

export const DOC_TYPES = [
  "invoice",
  "credit_note",
  "debit_note",
  "delivery_challan",
  "bill_of_supply",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** IRP document type codes. */
export const IRP_DOC_TYPE: Record<DocType, string> = {
  invoice: "INV",
  credit_note: "CRN",
  debit_note: "DBN",
  delivery_challan: "INV",
  bill_of_supply: "INV",
};

/** EWB document type codes. */
export const EWB_DOC_TYPE: Record<DocType, string> = {
  invoice: "INV",
  credit_note: "CRN",
  debit_note: "OTH",
  delivery_challan: "CHL",
  bill_of_supply: "BIL",
};

export const PARTY_TYPES = ["customer", "supplier", "both"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const REGISTRATION_TYPES = [
  "regular",
  "composition",
  "unregistered",
  "sez",
  "overseas",
  "uin",
  "deemed_export",
] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

/** IRN cancellation reasons, per the IRP API. */
export const IRN_CANCEL_REASONS = {
  "1": "Duplicate",
  "2": "Data entry mistake",
  "3": "Order cancelled",
  "4": "Others",
} as const;

/** EWB cancellation reasons, per the EWB API. */
export const EWB_CANCEL_REASONS = {
  "1": "Duplicate",
  "2": "Order cancelled",
  "3": "Data entry mistake",
  "4": "Others",
} as const;

/** EWB extension reasons, per the EWB API. */
export const EWB_EXTEND_REASONS = {
  "1": "Natural Calamity",
  "2": "Law and Order Situation",
  "4": "Transhipment",
  "5": "Accident",
  "99": "Others",
} as const;

export const JOB_KINDS = [
  "einvoice.generate",
  "einvoice.cancel",
  "ewb.generate",
  "ewb.update_part_b",
  "ewb.update_transporter",
  "ewb.extend",
  "ewb.cancel",
  "ewb.sync",
  "invoice.render_pdf",
  "notification.send",
  "maintenance.expire_ewbs",
  "maintenance.purge_sessions",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["pending", "running", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DOCUMENT_KINDS = [
  "invoice_pdf",
  "einvoice_json",
  "einvoice_qr",
  "ewb_pdf",
  "attachment",
  "logo",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
