import type { GatewayRequestContext, GatewayTelemetry } from "@traxac/gst-gateway";
import { aesDecrypt, aesDecryptToBase64, generateAppKey, rsaEncrypt, toPublicKeyPem } from "./crypto.js";
import { NicHttpError, nicFetch } from "./http.js";
import { EWB_PATHS, IRP_PATHS, resolveBaseUrl } from "./endpoints.js";

/**
 * NIC session management.
 *
 * A token is valid for roughly six hours and NIC rate-limits the auth
 * endpoint, so tokens are cached in shared storage (Postgres) rather than
 * per-process — otherwise the API and every worker would authenticate
 * separately and trip the limit.
 */

export interface NicSession {
  authToken: string;
  /** Session encryption key, base64. Encrypts every subsequent payload. */
  sek: string;
  expiresAt: Date;
}

/** Shared, encrypted-at-rest cache. Implemented by the core package. */
export interface SessionStore {
  read(key: string): Promise<NicSession | null>;
  write(key: string, session: NicSession): Promise<void>;
  clear(key: string): Promise<void>;
}

/** In-process fallback, used by tests and single-process deployments. */
export class MemorySessionStore implements SessionStore {
  private readonly map = new Map<string, NicSession>();
  async read(key: string): Promise<NicSession | null> {
    return this.map.get(key) ?? null;
  }
  async write(key: string, session: NicSession): Promise<void> {
    this.map.set(key, session);
  }
  async clear(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export interface NicClientOptions {
  /** NIC's RSA public key for the environment, PEM or bare base64. */
  publicKeys: { sandbox?: string | undefined; production?: string | undefined };
  timeoutMs: number;
  attempts?: number;
  store: SessionStore;
  telemetry?: GatewayTelemetry | undefined;
}

/** Raised when integration material is absent — never substituted with a stub. */
export class MissingGatewayConfigError extends Error {
  readonly code = "CREDENTIALS_MISSING";
  constructor(message: string) {
    super(message);
    this.name = "MissingGatewayConfigError";
  }
}

/** Refresh a little before expiry so a long call cannot straddle the boundary. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

export class NicSessionManager {
  constructor(private readonly options: NicClientOptions) {}

  private cacheKey(gateway: "irp" | "ewb", ctx: GatewayRequestContext): string {
    return `${gateway}:${ctx.environment}:${ctx.gstin}:${ctx.credentials.username}`;
  }

  private publicKey(environment: "sandbox" | "production"): string {
    const key = this.options.publicKeys[environment];
    if (!key) {
      throw new MissingGatewayConfigError(
        `No NIC ${environment} public key is configured. Add NIC_PUBLIC_KEY_${environment.toUpperCase()} `
        + "before e-Invoice or e-Way Bill calls can be made.",
      );
    }
    return toPublicKeyPem(key);
  }

  private assertCredentials(ctx: GatewayRequestContext): void {
    const { clientId, clientSecret, username, password } = ctx.credentials;
    const missing = [
      !clientId && "client id",
      !clientSecret && "client secret",
      !username && "username",
      !password && "password",
    ].filter(Boolean);
    if (missing.length) {
      throw new MissingGatewayConfigError(
        `Missing GST API ${missing.join(", ")} for ${ctx.gstin}. Add the credentials in Settings.`,
      );
    }
  }

  /** Get a live session, authenticating only when the cache is cold or stale. */
  async session(gateway: "irp" | "ewb", ctx: GatewayRequestContext): Promise<NicSession> {
    this.assertCredentials(ctx);
    const key = this.cacheKey(gateway, ctx);
    const cached = await this.options.store.read(key);
    if (cached && cached.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()) return cached;

    const session = await this.authenticate(gateway, ctx);
    await this.options.store.write(key, session);
    return session;
  }

  /** Drop a session after the portal rejects the token, forcing re-auth. */
  async invalidate(gateway: "irp" | "ewb", ctx: GatewayRequestContext): Promise<void> {
    await this.options.store.clear(this.cacheKey(gateway, ctx));
  }

  private async authenticate(
    gateway: "irp" | "ewb",
    ctx: GatewayRequestContext,
  ): Promise<NicSession> {
    const appKey = generateAppKey();
    const publicKeyPem = this.publicKey(ctx.environment);
    const baseUrl = resolveBaseUrl(gateway, ctx.environment, ctx.credentials.baseUrl);
    const path = gateway === "irp" ? IRP_PATHS.auth : EWB_PATHS.auth;

    const authPayload = {
      UserName: ctx.credentials.username,
      Password: ctx.credentials.password,
      AppKey: appKey,
      ForceRefreshAccessToken: false,
    };

    const response = await nicFetch({
      url: `${baseUrl}${path}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        client_id: ctx.credentials.clientId,
        client_secret: ctx.credentials.clientSecret,
        gstin: ctx.gstin,
        Gstin: ctx.gstin,
      },
      body: { Data: rsaEncrypt(publicKeyPem, JSON.stringify(authPayload)) },
      timeoutMs: this.options.timeoutMs,
      attempts: this.options.attempts ?? 3,
      telemetry: this.options.telemetry
        ? {
            sink: this.options.telemetry,
            tenantId: ctx.tenantId,
            gateway,
            operation: "auth",
            gstin: ctx.gstin,
            idempotencyKey: ctx.idempotencyKey,
            loggablePayload: { UserName: ctx.credentials.username, AppKey: "[redacted]" },
          }
        : undefined,
    });

    const body = response.json ?? {};
    const status = String(body["Status"] ?? body["status"] ?? "");
    if (status !== "1") {
      const detail = extractErrorDetail(body);
      throw new NicHttpError(
        response.status,
        detail.code,
        `NIC authentication failed: ${detail.message}`,
        // Wrong credentials must not be retried — repeated failures lock the account.
        false,
        body,
      );
    }

    const encrypted = String(body["Data"] ?? "");
    if (!encrypted) throw new NicHttpError(response.status, "AUTH_NO_DATA", "NIC returned no auth data", false, body);

    const decoded = JSON.parse(aesDecrypt(appKey, encrypted)) as {
      AuthToken?: string;
      Sek?: string;
      TokenExpiry?: string;
    };
    if (!decoded.AuthToken || !decoded.Sek) {
      throw new NicHttpError(response.status, "AUTH_INCOMPLETE", "NIC returned an incomplete session", false, body);
    }

    return {
      authToken: decoded.AuthToken,
      // The SEK arrives wrapped with the AppKey we just generated.
      sek: aesDecryptToBase64(appKey, decoded.Sek),
      expiresAt: parsePortalExpiry(decoded.TokenExpiry) ?? new Date(Date.now() + 6 * 3_600_000),
    };
  }
}

/** NIC returns "yyyy-MM-dd HH:mm:ss" in IST. */
export function parsePortalExpiry(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  const [, y, mo, d, h, mi, s] = match;
  // IST is UTC+5:30.
  return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!) - 330 * 60_000);
}

export function extractErrorDetail(body: Record<string, unknown>): {
  code: string;
  message: string;
  errors: Array<{ code: string; message: string }>;
} {
  const raw = body["ErrorDetails"] ?? body["error"] ?? body["errorDetails"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const errors = list.map((item) => {
    const e = item as Record<string, unknown>;
    return {
      code: String(e["ErrorCode"] ?? e["error_cd"] ?? e["errorCode"] ?? "UNKNOWN"),
      message: String(e["ErrorMessage"] ?? e["message"] ?? e["error_desc"] ?? "Unspecified portal error"),
    };
  });
  const first = errors[0];
  return {
    code: first?.code ?? "PORTAL_ERROR",
    message: errors.length
      ? errors.map((e) => `${e.code}: ${e.message}`).join("; ")
      : String(body["ErrorMessage"] ?? body["message"] ?? "The portal rejected the request"),
    errors,
  };
}
