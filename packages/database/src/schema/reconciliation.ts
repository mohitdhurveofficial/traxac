import { pgTable, text, uuid, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { gstins } from "./party.js";
import { invoices } from "./invoices.js";
import { createdAt, money, tsCol, updatedAt } from "./_shared.js";

/**
 * Reconciliation between our records and the government's.
 *
 * The portal is the system of record for filed documents, and the two can
 * drift: a document filed outside Ewayvo, one cancelled on the portal
 * directly, or an amount that no longer matches. This table holds the
 * comparison so a future portal sync has somewhere to write, and so a human
 * can see what disagrees today.
 *
 * Nothing here is populated by a live portal yet — the sync job is the piece
 * that plugs in once credentials exist.
 */
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gstinId: uuid("gstin_id")
      .notNull()
      .references(() => gstins.id, { onDelete: "cascade" }),
    /** einvoice | ewb | gstr1 */
    scope: text("scope").notNull(),
    /** Period covered, e.g. "2026-08". */
    period: text("period").notNull(),
    /** pending | running | completed | failed */
    status: text("status").notNull().default("pending"),
    /** How the external side was obtained: portal | upload | manual */
    source: text("source").notNull().default("portal"),
    startedAt: tsCol("started_at"),
    completedAt: tsCol("completed_at"),
    matched: text("matched").notNull().default("0"),
    mismatched: text("mismatched").notNull().default("0"),
    missingLocally: text("missing_locally").notNull().default("0"),
    missingRemotely: text("missing_remotely").notNull().default("0"),
    lastError: text("last_error"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reconciliation_runs_tenant_idx").on(t.tenantId),
    uniqueIndex("reconciliation_runs_uq").on(t.tenantId, t.gstinId, t.scope, t.period),
  ],
);

/**
 * One compared document. `matchStatus` is the whole point of the table:
 * everything else exists to explain the verdict.
 */
export const reconciliationItems = pgTable(
  "reconciliation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
    /** Null when the government holds a document we have no record of. */
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),

    /** matched | mismatched | missing_locally | missing_remotely */
    matchStatus: text("match_status").notNull(),
    /** Which fields disagree, as { field: [ours, theirs] }. */
    differences: jsonb("differences").$type<Record<string, [unknown, unknown]> | null>(),

    documentNumber: text("document_number"),
    documentDate: tsCol("document_date"),
    counterpartyGstin: text("counterparty_gstin"),
    ourValue: money("our_value"),
    theirValue: money("their_value"),
    irn: text("irn"),
    ewbNumber: text("ewb_number"),

    /** Verbatim external record, for the audit trail. */
    externalPayload: jsonb("external_payload"),
    errorDetail: text("error_detail"),
    /** When the comparison was made, not when the document was filed. */
    reconciledAt: tsCol("reconciled_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("reconciliation_items_run_idx").on(t.runId),
    index("reconciliation_items_tenant_idx").on(t.tenantId),
    index("reconciliation_items_status_idx").on(t.tenantId, t.matchStatus),
    index("reconciliation_items_invoice_idx").on(t.invoiceId),
  ],
);

/**
 * GSTR-1 preparation.
 *
 * Holds the generated return payload and its validation result. Filing is not
 * connected: `filingStatus` never leaves "not_connected" until a real
 * integration exists, and the UI says so plainly.
 */
export const gstReturns = pgTable(
  "gst_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gstinId: uuid("gstin_id")
      .notNull()
      .references(() => gstins.id, { onDelete: "cascade" }),
    /** gstr1 for now; gstr3b later. */
    returnType: text("return_type").notNull().default("gstr1"),
    /** Tax period, "MMYYYY" as GSTN expects it. */
    period: text("period").notNull(),
    /** draft | ready | exported */
    status: text("status").notNull().default("draft"),
    /**
     * Filing state. Deliberately separate from `status`: preparing a return
     * is something we do, filing it is not, and conflating them would let the
     * UI imply a submission that never happened.
     */
    filingStatus: text("filing_status").notNull().default("not_connected"),
    invoiceCount: text("invoice_count").notNull().default("0"),
    totalTaxableValue: money("total_taxable_value"),
    totalTax: money("total_tax"),
    /** The generated return document. */
    payload: jsonb("payload"),
    /** Blocking problems found while preparing. */
    validationErrors:
      jsonb("validation_errors").$type<
        Array<{ invoiceId?: string; invoiceNumber?: string; field: string; message: string }>
      >(),
    generatedAt: tsCol("generated_at"),
    generatedByUserId: uuid("generated_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("gst_returns_tenant_idx").on(t.tenantId),
    uniqueIndex("gst_returns_uq").on(t.tenantId, t.gstinId, t.returnType, t.period),
  ],
);
