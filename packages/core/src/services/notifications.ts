import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database, Notification } from "@traxac/database";
import { notifications } from "@traxac/database";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { AuthContext } from "../auth/context.js";
import { countExpr } from "./query.js";

export interface CreateNotificationInput {
  tenantId: string;
  userId?: string | null;
  kind: string;
  severity?: "info" | "warning" | "error";
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  /** Suppress duplicates of the same alert for the same entity. */
  dedupeWithinHours?: number;
}

/**
 * In-app alerts: e-Way Bills nearing expiry, failed IRN submissions, overdue
 * invoices. Deliberately quiet — an alert only fires once per entity per
 * window, because a noisy feed gets ignored.
 */
export class NotificationService {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db;
  }

  async create(input: CreateNotificationInput): Promise<Notification | null> {
    if (input.dedupeWithinHours && input.entityId) {
      const since = new Date(Date.now() - input.dedupeWithinHours * 3_600_000);
      const [existing] = await this.db.select({ id: notifications.id }).from(notifications)
        .where(and(
          eq(notifications.tenantId, input.tenantId),
          eq(notifications.kind, input.kind),
          eq(notifications.entityId, input.entityId),
          sql`${notifications.createdAt} > ${since}`,
        )).limit(1);
      if (existing) return null;
    }

    const [row] = await this.db.insert(notifications).values({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      kind: input.kind,
      severity: input.severity ?? "info",
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    }).returning();
    return row ?? null;
  }

  async list(ctx: AuthContext, options: { unreadOnly?: boolean; limit?: number } = {}) {
    return this.db.select().from(notifications)
      .where(scoped(ctx, notifications,
        options.unreadOnly ? isNull(notifications.readAt) : undefined,
        sql`(${notifications.userId} IS NULL OR ${notifications.userId} = ${ctx.userId})`,
      ))
      .orderBy(desc(notifications.createdAt))
      .limit(options.limit ?? 50);
  }

  async unreadCount(ctx: AuthContext): Promise<number> {
    const [row] = await this.db.select({ n: countExpr }).from(notifications)
      .where(scoped(ctx, notifications,
        isNull(notifications.readAt),
        sql`(${notifications.userId} IS NULL OR ${notifications.userId} = ${ctx.userId})`,
      ));
    return row?.n ?? 0;
  }

  async markRead(ctx: AuthContext, id: string): Promise<void> {
    await this.db.update(notifications).set({ readAt: new Date() })
      .where(scopedById(ctx, notifications, id));
  }

  async markAllRead(ctx: AuthContext): Promise<void> {
    await this.db.update(notifications).set({ readAt: new Date() })
      .where(scoped(ctx, notifications, isNull(notifications.readAt)));
  }

  /** Housekeeping: drop read notifications older than 90 days. */
  async purgeOld(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    const rows = await this.db.delete(notifications)
      .where(and(lt(notifications.createdAt, cutoff), sql`${notifications.readAt} IS NOT NULL`))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
