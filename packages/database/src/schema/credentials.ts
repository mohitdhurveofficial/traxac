import {
  pgTable, text, timestamp, uuid, jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Encrypted credentials for GST/GSP APIs. Secrets are encrypted with
 * AES-256-GCM using a per-tenant data key derived from the platform master
 * key (envelope encryption). Only ciphertext is stored here.
 */
export const gstCredentials = pgTable(
  "gst_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    gstin: text("gstin").notNull(),
    /** gsp: which provider (e.g. "nic-sandbox", "generic-gsp"). */
    provider: text("provider").notNull().default("nic-sandbox"),
    usernameCipher: text("username_cipher").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(), // full encrypted JSON blob
    /** auth-mode: password | OTP-session; sandbox uses username+password+cap. */
    authMode: text("auth_mode").notNull().default("password"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),

    status: text("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gst_credentials_tenant_gstin_provider_uq").on(
      t.tenantId, t.gstin, t.provider,
    ),
    index("gst_credentials_tenant_idx").on(t.tenantId),
  ],
);

/** Sessions for API + web (httpOnly cookie token → session row). */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    role: text("role").notNull().default("member"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);
