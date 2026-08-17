import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Database } from "@traxac/database";
import { auditLogs } from "@traxac/database";
import { actorLabel, type AuthContext } from "../auth/context.js";

/**
 * Audit trail writer. Recording is best-effort at the call site but never
 * silently swallowed: a failure is logged, because a missing audit row is a
 * compliance problem worth seeing.
 */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  summary?: string | undefined;
  diff?: Record<string, [unknown, unknown]> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AuditWriter {
  record(ctx: AuthContext, entry: AuditEntry): Promise<void>;
}

export class DatabaseAuditWriter implements AuditWriter {
  constructor(
    private readonly database: Database,
    private readonly onError: (err: unknown, entry: AuditEntry) => void = () => {},
  ) {}

  async record(ctx: AuthContext, entry: AuditEntry): Promise<void> {
    try {
      await this.database.db.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorUserId: ctx.actor === "system" ? null : ctx.userId,
        actorLabel: actorLabel(ctx),
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary ?? null,
        diff: entry.diff ?? null,
        metadata: entry.metadata ?? null,
        requestId: ctx.requestId ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      });
    } catch (err) {
      this.onError(err, entry);
    }
  }
}

/**
 * Field-level diff between two versions of a row, skipping unchanged values
 * and noisy bookkeeping columns.
 */
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "tenantId", "id"]);

export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const diff: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const from = before?.[key];
    const to = after[key];
    if (!deepEqual(from, to)) diff[key] = [normalise(from), normalise(to)];
  }
  return diff;
}

function normalise(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(normaliseDeep(a)) === JSON.stringify(normaliseDeep(b));
}

function normaliseDeep(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normaliseDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normaliseDeep(v)]),
    );
  }
  return value;
}

/** Read the timeline for one entity — what the UI shows as "history". */
export async function readTimeline(
  database: Database,
  ctx: AuthContext,
  entityType: string,
  entityId: string,
  limit = 100,
) {
  return database.db
    .select()
    .from(auditLogs)
    .where(and(
      eq(auditLogs.tenantId, ctx.tenantId),
      eq(auditLogs.entityType, entityType),
      eq(auditLogs.entityId, entityId),
    ))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

/** Tenant-wide activity feed with keyset pagination. */
export async function readActivity(
  database: Database,
  ctx: AuthContext,
  options: { limit?: number; before?: Date; action?: string; entityType?: string } = {},
) {
  const clauses = [eq(auditLogs.tenantId, ctx.tenantId)];
  if (options.before) clauses.push(lt(auditLogs.createdAt, options.before));
  if (options.action) clauses.push(sql`${auditLogs.action} LIKE ${`${options.action}%`}`);
  if (options.entityType) clauses.push(eq(auditLogs.entityType, options.entityType));
  return database.db
    .select()
    .from(auditLogs)
    .where(and(...clauses))
    .orderBy(desc(auditLogs.createdAt))
    .limit(options.limit ?? 50);
}
