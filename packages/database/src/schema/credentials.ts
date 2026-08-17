import { pgTable, text, uuid, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { gstins } from "./party.js";
import { users } from "./tenants.js";
import { createdAt, tsCol, updatedAt } from "./_shared.js";

/**
 * Encrypted GST/GSP API credentials. Secrets are AES-256-GCM encrypted with
 * the platform master key before they ever reach this table; plaintext is
 * never stored, logged or returned by the API.
 */
export const gstCredentials = pgTable(
  "gst_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    gstinId: uuid("gstin_id")
      .notNull()
      .references(() => gstins.id, { onDelete: "cascade" }),
    gstin: text("gstin").notNull(),
    /** nic | gsp-<vendor> */
    provider: text("provider").notNull().default("nic"),
    /** sandbox | production */
    environment: text("environment").notNull().default("sandbox"),
    /** einvoice | ewb */
    service: text("service").notNull(),
    /** Non-secret display hint, e.g. "API_USER_***23". */
    usernameHint: text("username_hint"),
    /** AES-256-GCM ciphertext of the full credential JSON. */
    encryptedPayload: text("encrypted_payload").notNull(),
    /** Key version so credentials can be re-wrapped during key rotation. */
    keyVersion: integer("key_version").notNull().default(1),

    status: text("status").notNull().default("active"), // active | invalid | disabled
    lastVerifiedAt: tsCol("last_verified_at"),
    lastUsedAt: tsCol("last_used_at"),
    lastError: text("last_error"),

    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("gst_credentials_uq").on(t.tenantId, t.gstin, t.provider, t.environment, t.service),
    index("gst_credentials_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Cached government API session tokens (also encrypted). Sharing the cache in
 * Postgres means API and worker processes never double-authenticate, which
 * matters because NIC rate-limits auth calls.
 */
export const gatewayTokens = pgTable(
  "gateway_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => gstCredentials.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    encryptedToken: text("encrypted_token").notNull(),
    /** Session encryption key (SEK) returned by NIC, encrypted at rest. */
    encryptedSek: text("encrypted_sek"),
    expiresAt: tsCol("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("gateway_tokens_credential_uq").on(t.credentialId),
    index("gateway_tokens_expires_idx").on(t.expiresAt),
  ],
);

/** Browser/API sessions. Only a SHA-256 hash of the bearer token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    /**
     * The registration the user is currently working in.
     *
     * Held on the session rather than in the URL or a client cookie so every
     * request — including a form posted from a stale tab — is scoped to the
     * same books the user last chose. Null means "all registrations".
     */
    activeGstinId: uuid("active_gstin_id"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    lastSeenAt: tsCol("last_seen_at").notNull().defaultNow(),
    expiresAt: tsCol("expires_at").notNull(),
    revokedAt: tsCol("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Single-use password reset tokens.
 *
 * Only a hash is stored, exactly as for sessions: a leaked table must not let
 * anyone take over an account. Tokens are short-lived and consumed on use.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: tsCol("expires_at").notNull(),
    usedAt: tsCol("used_at"),
    requestedIp: text("requested_ip"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("password_resets_token_uq").on(t.tokenHash),
    index("password_resets_user_idx").on(t.userId),
  ],
);

/** Machine-to-machine API keys so a mobile app or ERP can call the same API. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Public, non-secret prefix shown in the UI (e.g. "txk_live_a1b2"). */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    role: text("role").notNull().default("member"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    lastUsedAt: tsCol("last_used_at"),
    expiresAt: tsCol("expires_at"),
    revokedAt: tsCol("revoked_at"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    index("api_keys_tenant_idx").on(t.tenantId),
  ],
);
