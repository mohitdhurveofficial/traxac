import {
  pgTable, text, uuid, jsonb, integer, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { createdAt, tsCol, updatedAt } from "./_shared.js";

/**
 * Durable job queue for compliance operations (IRN generation, EWB lifecycle,
 * PDF rendering, notifications). Workers claim rows with
 * SELECT ... FOR UPDATE SKIP LOCKED, so scaling means running more workers.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** einvoice.generate | einvoice.cancel | ewb.generate | ewb.extend | ... */
    kind: text("kind").notNull(),
    /**
     * Stable key that makes enqueueing idempotent: re-enqueuing the same
     * logical operation collapses onto the existing row instead of firing a
     * second government API call.
     */
    idempotencyKey: text("idempotency_key"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // pending|running|done|failed|cancelled
    priority: integer("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    result: jsonb("result"),
    runAt: tsCol("run_at").notNull().defaultNow(),
    startedAt: tsCol("started_at"),
    finishedAt: tsCol("finished_at"),
    lockedBy: text("locked_by"),
    lockedAt: tsCol("locked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAt, t.priority),
    index("jobs_tenant_idx").on(t.tenantId),
    index("jobs_kind_idx").on(t.kind),
    uniqueIndex("jobs_idempotency_uq").on(t.idempotencyKey),
  ],
);

/**
 * Every outbound government API call, for observability and dispute
 * resolution. Payloads are redacted of credentials before insertion.
 */
export const gatewayCalls = pgTable(
  "gateway_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    gateway: text("gateway").notNull(),        // irp | ewb
    operation: text("operation").notNull(),    // auth | generateIrn | cancelEwb ...
    endpoint: text("endpoint").notNull(),
    gstin: text("gstin"),
    idempotencyKey: text("idempotency_key"),
    attempt: integer("attempt").notNull().default(1),
    requestPayload: jsonb("request_payload"),
    responseStatus: integer("response_status"),
    responsePayload: jsonb("response_payload"),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("gateway_calls_tenant_idx").on(t.tenantId),
    index("gateway_calls_created_idx").on(t.createdAt),
    index("gateway_calls_idem_idx").on(t.idempotencyKey),
  ],
);
