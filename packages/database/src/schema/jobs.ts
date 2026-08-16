import {
  pgTable, text, timestamp, uuid, jsonb, integer, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Durable job queue for compliance operations (IRN generation, EWB lifecycle,
 * PDF generation). Uses SELECT ... FOR UPDATE SKIP LOCKED for claiming.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** Job kind, e.g. einvoice.generate, ewb.extend, invoice.finalize. */
    kind: text("kind").notNull(),
    /** Idempotency key to dedupe government API calls. */
    idempotencyKey: text("idempotency_key"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // pending|running|done|failed|cancelled
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("error"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_status_runat_idx").on(t.status, t.runAt),
    index("jobs_tenant_idx").on(t.tenantId),
    uniqueIndex("jobs_idempotency_uq").on(t.idempotencyKey),
  ],
);
