import { and, eq } from "drizzle-orm";
import type { Database, GstCredential } from "@ewayvo/database";
import { gatewayTokens, gstCredentials, gstins, requireScope } from "@ewayvo/database";
import { AppError } from "@ewayvo/shared";
import type { GatewayCredentials, GatewayEnvironment } from "@ewayvo/gst-gateway";
import type { NicSession, SessionStore } from "@ewayvo/nic-client";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { SecretBox } from "../infra/crypto.js";
import type { AuditWriter } from "../infra/audit.js";

export type GatewayService = "einvoice" | "ewb";

/** Shape stored (encrypted) in `gst_credentials.encrypted_payload`. */
interface StoredCredential {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export interface SaveCredentialInput {
  gstinId: string;
  provider: string;
  environment: GatewayEnvironment;
  service: GatewayService;
  username: string;
  password: string;
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
}

/** Non-secret projection returned by the API. */
export interface CredentialSummary {
  id: string;
  gstinId: string;
  gstin: string;
  provider: string;
  environment: string;
  service: string;
  usernameHint: string | null;
  status: string;
  lastVerifiedAt: Date | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

/**
 * Stores and retrieves government API credentials.
 *
 * Plaintext exists only inside this class and only for the duration of a
 * gateway call. Nothing here is ever returned to a client: the API sees
 * `CredentialSummary`, which carries a masked username and nothing else.
 */
export class CredentialService {
  constructor(
    private readonly database: Database,
    private readonly secrets: SecretBox,
    private readonly audit: AuditWriter,
    /** Platform-level integrator credentials, used when a tenant has none. */
    private readonly platformDefaults: { clientId?: string; clientSecret?: string } = {},
  ) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  async list(ctx: AuthContext): Promise<CredentialSummary[]> {
    requirePermission(ctx, "credentials:read");
    const rows = await this.db.select().from(gstCredentials).where(scoped(ctx, gstCredentials));
    return rows.map(toSummary);
  }

  async save(ctx: AuthContext, input: SaveCredentialInput): Promise<CredentialSummary> {
    requirePermission(ctx, "credentials:write");
    const [gstin] = await this.db
      .select()
      .from(gstins)
      .where(scopedById(ctx, gstins, input.gstinId))
      .limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "GSTIN registration not found");

    const payload: StoredCredential = {
      username: input.username.trim(),
      password: input.password,
      clientId: (input.clientId || this.platformDefaults.clientId || "").trim(),
      clientSecret: input.clientSecret || this.platformDefaults.clientSecret || "",
      ...(input.baseUrl ? { baseUrl: input.baseUrl.trim() } : {}),
    };

    const values = {
      tenantId: ctx.tenantId,
      gstinId: gstin.id,
      gstin: gstin.gstin,
      provider: input.provider,
      environment: input.environment,
      service: input.service,
      usernameHint: maskUsername(payload.username),
      encryptedPayload: this.secrets.encryptJson(payload),
      keyVersion: this.secrets.keyVersion,
      status: "active",
      lastError: null,
      createdByUserId: ctx.userId,
      updatedAt: new Date(),
    };

    const [row] = await this.db
      .insert(gstCredentials)
      .values(values)
      .onConflictDoUpdate({
        target: [
          gstCredentials.tenantId,
          gstCredentials.gstin,
          gstCredentials.provider,
          gstCredentials.environment,
          gstCredentials.service,
        ],
        set: {
          encryptedPayload: values.encryptedPayload,
          keyVersion: values.keyVersion,
          usernameHint: values.usernameHint,
          status: "active",
          lastError: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the credentials");

    // Any cached portal token belongs to the previous credentials.
    await this.db.delete(gatewayTokens).where(eq(gatewayTokens.credentialId, row.id));

    await this.audit.record(ctx, {
      action: "credential.saved",
      entityType: "gst_credential",
      entityId: row.id,
      summary: `${input.service} / ${input.environment} for ${gstin.gstin}`,
    });
    return toSummary(row);
  }

  async remove(ctx: AuthContext, id: string): Promise<void> {
    requirePermission(ctx, "credentials:write");
    await this.db.delete(gstCredentials).where(scopedById(ctx, gstCredentials, id));
    await this.audit.record(ctx, {
      action: "credential.deleted",
      entityType: "gst_credential",
      entityId: id,
    });
  }

  /**
   * Whether a usable credential exists, without decrypting anything.
   *
   * Callers use this to decide whether queuing a portal call is worth doing
   * at all: a job that can only fail leaves a permanent red mark on a
   * business that has simply not connected yet.
   */
  async exists(
    ctx: AuthContext,
    input: { gstin: string; service: GatewayService; environment: GatewayEnvironment },
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ status: gstCredentials.status })
      .from(gstCredentials)
      .where(
        scoped(
          ctx,
          gstCredentials,
          eq(gstCredentials.gstin, input.gstin),
          eq(gstCredentials.service, input.service),
          eq(gstCredentials.environment, input.environment),
        ),
      )
      .limit(1);
    return Boolean(row) && row?.status !== "disabled";
  }

  /** Decrypt for a gateway call. Never expose the return value to a client. */
  async resolve(
    ctx: AuthContext,
    input: { gstin: string; service: GatewayService; environment: GatewayEnvironment },
  ): Promise<{ credential: GstCredential; credentials: GatewayCredentials }> {
    const [row] = await this.db
      .select()
      .from(gstCredentials)
      .where(
        scoped(
          ctx,
          gstCredentials,
          eq(gstCredentials.gstin, input.gstin),
          eq(gstCredentials.service, input.service),
          eq(gstCredentials.environment, input.environment),
        ),
      )
      .limit(1);

    if (!row) {
      throw new AppError(
        "CREDENTIALS_MISSING",
        `No ${input.service === "einvoice" ? "e-Invoice" : "e-Way Bill"} credentials saved for ` +
          `${input.gstin} (${input.environment}). Add them in Settings → GST credentials.`,
      );
    }
    if (row.status === "disabled") {
      throw new AppError("CREDENTIALS_MISSING", `The credentials for ${input.gstin} are disabled`);
    }

    const stored = this.secrets.decryptJson<StoredCredential>(row.encryptedPayload);

    // Lazily re-wrap ciphertext written with a retired key.
    if (this.secrets.needsRewrap(row.encryptedPayload)) {
      await this.db
        .update(gstCredentials)
        .set({
          encryptedPayload: this.secrets.encryptJson(stored),
          keyVersion: this.secrets.keyVersion,
          updatedAt: new Date(),
        })
        .where(eq(gstCredentials.id, row.id))
        .catch(() => undefined);
    }

    return {
      credential: row,
      credentials: {
        username: stored.username,
        password: stored.password,
        clientId: stored.clientId || this.platformDefaults.clientId || "",
        clientSecret: stored.clientSecret || this.platformDefaults.clientSecret || "",
        baseUrl: stored.baseUrl,
      },
    };
  }

  async markUsed(credentialId: string): Promise<void> {
    await this.db
      .update(gstCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(gstCredentials.id, credentialId))
      .catch(() => undefined);
  }

  async markVerified(credentialId: string): Promise<void> {
    await this.db
      .update(gstCredentials)
      .set({ lastVerifiedAt: new Date(), status: "active", lastError: null, updatedAt: new Date() })
      .where(eq(gstCredentials.id, credentialId));
  }

  async markFailed(credentialId: string, error: string, disable = false): Promise<void> {
    await this.db
      .update(gstCredentials)
      .set({
        lastError: error.slice(0, 500),
        status: disable ? "invalid" : "active",
        updatedAt: new Date(),
      })
      .where(eq(gstCredentials.id, credentialId));
  }
}

/**
 * Portal session cache in Postgres. Tokens are short-lived but rate-limited to
 * obtain, so API and worker processes share one cache — and, being credentials
 * themselves, they are encrypted at rest like everything else.
 */
export class DatabaseSessionStore implements SessionStore {
  constructor(
    private readonly database: Database,
    private readonly secrets: SecretBox,
    private readonly lookup: (
      cacheKey: string,
    ) => { credentialId: string; tenantId: string } | null,
  ) {}

  async read(key: string): Promise<NicSession | null> {
    const ref = this.lookup(key);
    if (!ref) return null;
    const [row] = await this.database.db
      .select()
      .from(gatewayTokens)
      .where(eq(gatewayTokens.credentialId, ref.credentialId))
      .limit(1);
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    try {
      return {
        authToken: this.secrets.decrypt(row.encryptedToken),
        sek: row.encryptedSek ? this.secrets.decrypt(row.encryptedSek) : "",
        expiresAt: row.expiresAt,
      };
    } catch {
      return null;
    }
  }

  async write(key: string, session: NicSession): Promise<void> {
    const ref = this.lookup(key);
    if (!ref) return;
    await this.database.db
      .insert(gatewayTokens)
      .values({
        credentialId: ref.credentialId,
        tenantId: ref.tenantId,
        encryptedToken: this.secrets.encrypt(session.authToken),
        encryptedSek: this.secrets.encrypt(session.sek),
        expiresAt: session.expiresAt,
      })
      .onConflictDoUpdate({
        target: gatewayTokens.credentialId,
        set: {
          encryptedToken: this.secrets.encrypt(session.authToken),
          encryptedSek: this.secrets.encrypt(session.sek),
          expiresAt: session.expiresAt,
        },
      });
  }

  async clear(key: string): Promise<void> {
    const ref = this.lookup(key);
    if (!ref) return;
    await this.database.db
      .delete(gatewayTokens)
      .where(eq(gatewayTokens.credentialId, ref.credentialId));
  }
}

function toSummary(row: GstCredential): CredentialSummary {
  return {
    id: row.id,
    gstinId: row.gstinId,
    gstin: row.gstin,
    provider: row.provider,
    environment: row.environment,
    service: row.service,
    usernameHint: row.usernameHint,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

/** "API_USER_12345" → "API_…345" — enough to recognise, not enough to reuse. */
function maskUsername(username: string): string {
  if (username.length <= 6) return `${username.slice(0, 2)}***`;
  return `${username.slice(0, 3)}…${username.slice(-3)}`;
}

export { and };
