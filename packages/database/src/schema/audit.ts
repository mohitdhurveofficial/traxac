import {
  pgTable, text, timestamp, uuid, jsonb, index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Immutable audit trail: every state change on any entity is recorded with
 * exact timestamp, actor and before/after diff. Never updated or deleted.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    actorLabel: text("actor_label"),           // "user@x.com" or "system:worker"
    action: text("action").notNull(),           // invoice.created, ewb.generated...
    entityType: text("entity_type").notNull(),  // invoice | party | product...
    entityId: text("entity_id").notNull(),
    diff: jsonb("diff"),                        // {field: [before, after]}
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_idx").on(t.tenantId),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

/** In-app + email notification queue. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),                    // null = broadcast to tenant
    channel: text("channel").notNull().default("in_app"), // in_app | email
    kind: text("kind").notNull(),               // ewb.expiring | einvoice.failed ...
    title: text("title").notNull(),
    body: text("body"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_tenant_idx").on(t.tenantId),
    index("notifications_user_idx").on(t.userId),
  ],
);
