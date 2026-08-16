/** Lifecycle statuses shared across API, DB and web. */

export type InvoiceStatus =
  | "draft"
  | "pending"        // finalized, awaiting e-Invoice/e-Way Bill generation
  | "generated"      // IRN/EWB successfully generated
  | "failed"         // government API call failed (retryable)
  | "cancelled"
  | "completed";     // paid / closed

export type EinvoiceStatus =
  | "not_required"
  | "pending"
  | "generated"
  | "failed"
  | "cancelled";

export type EwbStatus =
  | "not_required"
  | "pending"
  | "generated"
  | "failed"
  | "expired"
  | "extended"
  | "updated"
  | "cancelled";

export type PartyType = "customer" | "supplier" | "both";

export type DocType = "invoice" | "credit_note" | "debit_note";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft", "pending", "generated", "failed", "cancelled", "completed",
];

export const EWB_PART_B_REASON_CODES = {
  sale: 1,
  "sale-return": 2,
  "job-work": 4,
} as const;
