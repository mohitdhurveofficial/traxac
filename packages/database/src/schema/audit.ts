import { pgTable, text, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { createdAt, tsCol } from "./_shared.js";

/**
 * Immutable audit trail. Every state change on any entity is recorded with an
 * exact timestamp, the actor and a before/after diff. Never updated, never
 * deleted — this is what a GST officer or an auditor reads.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    actorLabel: text("actor_label"), // "user@x.com" or "system:worker"
    action: text("action").notNull(), // invoice.created | ewb.generated ...
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary"),
    diff: jsonb("diff").$type<Record<string, [unknown, unknown]> | null>(),
    metadata: jsonb("metadata"),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_tenant_idx").on(t.tenantId),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

/** In-app + email notification feed. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id"), // null = whole tenant
    channel: text("channel").notNull().default("in_app"), // in_app | email
    /** ewb.expiring | einvoice.failed | invoice.overdue ... */
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("info"), // info | warning | error
    title: text("title").notNull(),
    body: text("body"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: tsCol("read_at"),
    sentAt: tsCol("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_tenant_idx").on(t.tenantId),
    index("notifications_tenant_read_idx").on(t.tenantId, t.readAt),
    index("notifications_user_idx").on(t.userId),
  ],
);
