import type { GatewayError, GatewayTelemetry } from "@traxac/gst-gateway";

export class NicHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "NicHttpError";
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/** 400ms, 900ms, 2s, 4.5s … with jitter, capped at 20s. */
export function backoffMs(attempt: number, baseMs = 400, maxMs = 20_000): number {
  const exponential = Math.min(baseMs * 2.25 ** attempt, maxMs);
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

export interface NicRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  attempts: number;
  /** Recorded alongside the call for the audit trail. */
  telemetry?: {
    sink: GatewayTelemetry;
    tenantId: string;
    gateway: "irp" | "ewb";
    operation: string;
    gstin: string;
    idempotencyKey: string;
    /** Redacted copy of the plaintext request, safe to persist. */
    loggablePayload?: unknown;
  };
}

export interface NicResponse {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  durationMs: number;
}

/**
 * A single HTTP exchange with the portal: bounded timeout, bounded retries for
 * transport-level failures only, and one telemetry row per attempt.
 *
 * Retries never apply to a portal-level rejection — a 200 carrying
 * `Status: "0"` is a business answer, and repeating it would risk a duplicate
 * document.
 */
export async function nicFetch(request: NicRequest): Promise<NicResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= request.attempts; attempt++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      const text = await response.text();
      const durationMs = Date.now() - startedAt;
      const json = safeParse(text);

      await recordTelemetry(request, attempt, response.status, json ?? { raw: truncate(text) }, durationMs);

      if (!response.ok && isRetryableStatus(response.status)) {
        lastError = new NicHttpError(
          response.status, `HTTP_${response.status}`,
          `The portal returned HTTP ${response.status}`, true, json ?? text,
        );
      } else {
        return { status: response.status, json, text, durationMs };
      }
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const aborted = err instanceof Error && err.name === "AbortError";
      lastError = aborted
        ? new NicHttpError(408, "TIMEOUT", `The portal did not respond within ${request.timeoutMs}ms`, true)
        : err;
      await recordTelemetry(
        request, attempt, undefined, { error: String(err) }, durationMs,
        aborted ? "TIMEOUT" : "NETWORK",
      );
    } finally {
      clearTimeout(timer);
    }

    if (attempt < request.attempts) await sleep(backoffMs(attempt));
  }

  throw lastError instanceof Error
    ? lastError
    : new NicHttpError(500, "UNKNOWN", "The portal call failed", true, lastError);
}

async function recordTelemetry(
  request: NicRequest,
  attempt: number,
  status: number | undefined,
  responsePayload: unknown,
  durationMs: number,
  errorCode?: string,
): Promise<void> {
  const t = request.telemetry;
  if (!t) return;
  await t.sink.record({
    tenantId: t.tenantId,
    gateway: t.gateway,
    operation: t.operation,
    endpoint: request.url,
    gstin: t.gstin,
    idempotencyKey: t.idempotencyKey,
    attempt,
    requestPayload: t.loggablePayload,
    responseStatus: status,
    responsePayload,
    errorCode,
    durationMs,
  }).catch(() => undefined);
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function truncate(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Map a thrown transport error to the gateway error shape. */
export function toGatewayError(err: unknown): GatewayError {
  if (err instanceof NicHttpError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    code: "TRANSPORT_ERROR",
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  };
}

/**
 * Portal error codes that are permanent: retrying sends the same rejection.
 * Everything else is treated as retryable so a transient portal outage
 * eventually succeeds.
 */
const PERMANENT_PREFIXES = ["1", "2", "3", "4", "6"];

export function isPermanentPortalError(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  return PERMANENT_PREFIXES.includes(code[0] as string);
}
