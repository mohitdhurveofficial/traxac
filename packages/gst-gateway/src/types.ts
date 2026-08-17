/**
 * Transport-agnostic gateway contracts.
 *
 * Each government system (IRP for e-Invoice, EWB for e-Way Bill) sits behind a
 * provider interface so the application talks to NIC directly today and to any
 * GSP tomorrow without touching business logic. No implementation is permitted
 * to synthesise an IRN, QR payload or e-Way Bill number — a missing credential
 * or an unreachable portal surfaces as an error, never as fabricated data.
 */

export type GatewayId = "irp" | "ewb";
export type GatewayEnvironment = "sandbox" | "production";

/** Decrypted credentials for one registration's gateway session. */
export interface GatewayCredentials {
  /** Portal API username (not the GST portal login). */
  username: string;
  password: string;
  /** Integrator credentials issued by NIC or the GSP. */
  clientId: string;
  clientSecret: string;
  /** Override for GSP-hosted endpoints. */
  baseUrl?: string | undefined;
  /**
   * How the integrator headers are spelled.
   *
   * NIC's own documentation disagrees with itself: the specification tables
   * list `client_id` / `client_secret` / `Gstin`, while both published sample
   * programs send `client-id` / `client-secret` / `gstin`. Which one a given
   * deployment accepts is only knowable once credentials are issued, and a
   * GSP may differ again, so it is configuration rather than a guess.
   */
  headerStyle?: "underscore" | "hyphen" | undefined;
}

export interface GatewayRequestContext {
  tenantId: string;
  gstin: string;
  environment: GatewayEnvironment;
  credentials: GatewayCredentials;
  /** Stable key so a retried call is recognised as the same operation. */
  idempotencyKey: string;
  /** Correlates gateway calls with the API request that triggered them. */
  requestId?: string | undefined;
  /**
   * Supplier GSTIN, sent as `sup_gstin` only when an e-commerce operator acts
   * on another supplier's document. Omitted for ordinary self-billing.
   */
  supplierGstin?: string | undefined;
}

export interface GatewayError {
  /** Portal error code where available (e.g. "2150"), else a transport code. */
  code: string;
  message: string;
  /** True when retrying later could succeed: timeout, 5xx, rate limit. */
  retryable: boolean;
  /** Portal-reported detail lines, kept verbatim for the audit trail. */
  errors?: Array<{ code: string; message: string }>;
}

export type GatewayResult<T> =
  | { ok: true; data: T; raw?: unknown; durationMs?: number }
  | { ok: false; error: GatewayError; raw?: unknown; durationMs?: number };

export function gatewayOk<T>(data: T, raw?: unknown, durationMs?: number): GatewayResult<T> {
  return { ok: true, data, raw, durationMs };
}

export function gatewayFail<T = never>(
  error: GatewayError,
  raw?: unknown,
  durationMs?: number,
): GatewayResult<T> {
  return { ok: false, error, raw, durationMs };
}

/** Portal error codes that mean "already done" rather than "failed". */
export const DUPLICATE_IRN_CODES = new Set(["2150", "2172"]);
export const DUPLICATE_EWB_CODES = new Set(["604", "312"]);

/** Observability hook so every outbound call is recorded. */
export interface GatewayTelemetry {
  record(entry: {
    tenantId: string;
    gateway: GatewayId;
    operation: string;
    endpoint: string;
    gstin: string;
    idempotencyKey: string;
    attempt: number;
    requestPayload?: unknown;
    responseStatus?: number;
    responsePayload?: unknown;
    errorCode?: string;
    durationMs: number;
  }): Promise<void>;
}
