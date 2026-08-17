import { and, eq, sql } from "drizzle-orm";
import type { Database, Job } from "@traxac/database";
import { jobs } from "@traxac/database";
import type { JobKind } from "@traxac/shared";

/**
 * Durable job queue backed by Postgres.
 *
 * Two properties matter for government API calls:
 *  - **Idempotency**: enqueueing the same logical operation twice collapses
 *    onto one row, so a double-click never files two IRNs.
 *  - **At-least-once with backoff**: a claimed job that crashes is retried
 *    after an exponential delay, and its handler is expected to check whether
 *    the remote side already succeeded before re-submitting.
 */

export interface EnqueueOptions {
  tenantId: string | null;
  kind: JobKind;
  payload: Record<string, unknown>;
  /** Collapses duplicate enqueues. Usually `${kind}:${entityId}:${attemptScope}`. */
  idempotencyKey?: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

export interface EnqueueResult {
  job: Job;
  /** False when an existing job with the same idempotency key was reused. */
  created: boolean;
}

export class JobQueue {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db;
  }

  async enqueue(options: EnqueueOptions): Promise<EnqueueResult> {
    const values = {
      tenantId: options.tenantId,
      kind: options.kind,
      payload: options.payload,
      idempotencyKey: options.idempotencyKey ?? null,
      runAt: options.runAt ?? new Date(),
      priority: options.priority ?? 100,
      maxAttempts: options.maxAttempts ?? 5,
    };

    if (!values.idempotencyKey) {
      const [job] = await this.db.insert(jobs).values(values).returning();
      return { job: job as Job, created: true };
    }

    // Re-enqueueing a finished job is allowed; re-enqueueing a live one is not.
    const [inserted] = await this.db
      .insert(jobs)
      .values(values)
      .onConflictDoNothing({ target: jobs.idempotencyKey })
      .returning();
    if (inserted) return { job: inserted, created: true };

    const [existing] = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, values.idempotencyKey))
      .limit(1);
    return { job: existing as Job, created: false };
  }

  /**
   * Re-run a job that previously failed or completed, under the same
   * idempotency key. Used by "Retry" in the UI.
   */
  async requeue(idempotencyKey: string, runAt = new Date()): Promise<Job | null> {
    const [row] = await this.db
      .update(jobs)
      .set({
        status: "pending",
        runAt,
        lastError: null,
        lockedBy: null,
        lockedAt: null,
        startedAt: null,
        finishedAt: null,
        attempts: 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.idempotencyKey, idempotencyKey),
          sql`${jobs.status} IN ('failed', 'done', 'cancelled')`,
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Claim up to `limit` due jobs for this worker. `FOR UPDATE SKIP LOCKED`
   * means several workers can poll the same table without contending.
   */
  async claim(workerId: string, limit = 1, kinds?: JobKind[]): Promise<Job[]> {
    const kindFilter = kinds?.length
      ? this.database.client`AND kind = ANY(${this.database.client.array(kinds)})`
      : this.database.client``;

    const rows = await this.database.client<Job[]>`
      WITH claimed AS (
        SELECT id FROM jobs
        WHERE status = 'pending'
          AND run_at <= now()
          ${kindFilter}
        ORDER BY priority ASC, run_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs j
      SET status = 'running',
          attempts = j.attempts + 1,
          locked_by = ${workerId},
          locked_at = now(),
          started_at = COALESCE(j.started_at, now()),
          updated_at = now()
      FROM claimed
      WHERE j.id = claimed.id
      RETURNING j.*
    `;
    return rows.map(normaliseJobRow);
  }

  async complete(jobId: string, result?: unknown): Promise<void> {
    await this.db
      .update(jobs)
      .set({
        status: "done",
        result: result ?? null,
        finishedAt: new Date(),
        lockedBy: null,
        lockedAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  /**
   * Record a failure. Retries use exponential backoff with jitter; a job that
   * exhausts its attempts (or fails non-retryably) is parked as `failed`.
   */
  async fail(
    jobId: string,
    error: string,
    options: { retryable?: boolean } = {},
  ): Promise<{ willRetry: boolean; nextRunAt?: Date }> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return { willRetry: false };

    const retryable = options.retryable ?? true;
    const willRetry = retryable && job.attempts < job.maxAttempts;
    const nextRunAt = willRetry ? new Date(Date.now() + backoffMs(job.attempts)) : undefined;

    await this.db
      .update(jobs)
      .set({
        status: willRetry ? "pending" : "failed",
        lastError: error.slice(0, 2000),
        runAt: nextRunAt ?? job.runAt,
        finishedAt: willRetry ? null : new Date(),
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    return willRetry ? { willRetry, nextRunAt: nextRunAt as Date } : { willRetry };
  }

  async cancel(jobId: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), sql`${jobs.status} IN ('pending', 'running')`));
  }

  /** Release jobs whose worker died mid-run so another worker can pick them up. */
  async reclaimStale(olderThanMs = 5 * 60_000): Promise<number> {
    const result = await this.database.client`
      UPDATE jobs
      SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE status = 'running'
        AND locked_at < now() - (${Math.round(olderThanMs / 1000)} || ' seconds')::interval
    `;
    return result.count ?? 0;
  }

  async stats(): Promise<Record<string, number>> {
    const rows = await this.database.client<Array<{ status: string; count: string }>>`
      SELECT status, count(*)::text AS count FROM jobs GROUP BY status
    `;
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }
}

/** 5s, 15s, 45s, ~2m, ~7m — with jitter so retries do not synchronise. */
export function backoffMs(attempt: number, baseMs = 5000, maxMs = 30 * 60_000): number {
  const exponential = Math.min(baseMs * 3 ** Math.max(0, attempt - 1), maxMs);
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
}

/** postgres.js returns snake_case columns for raw queries; map them back. */
function normaliseJobRow(row: Record<string, unknown>): Job {
  if ("tenantId" in row) return row as unknown as Job;
  const r = row as Record<string, never>;
  return {
    id: r["id"],
    tenantId: r["tenant_id"],
    kind: r["kind"],
    idempotencyKey: r["idempotency_key"],
    payload: r["payload"],
    status: r["status"],
    priority: r["priority"],
    attempts: r["attempts"],
    maxAttempts: r["max_attempts"],
    lastError: r["last_error"],
    result: r["result"],
    runAt: r["run_at"],
    startedAt: r["started_at"],
    finishedAt: r["finished_at"],
    lockedBy: r["locked_by"],
    lockedAt: r["locked_at"],
    createdAt: r["created_at"],
    updatedAt: r["updated_at"],
  } as unknown as Job;
}
