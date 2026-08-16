import type { GatewayError } from "@traxac/gst-gateway";

/** Sleep helper for exponential backoff. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** Exponential backoff with jitter: 500ms, 1s, 2s, 4s... max 30s. */
export function backoffMs(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const exp = Math.min(baseMs * 2 ** attempt, maxMs);
  return Math.round(exp * (0.7 + Math.random() * 0.6));
}

export function toGatewayError(err: unknown): GatewayError {
  if (err instanceof GatewayHttpError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: "UNKNOWN", message, retryable: true };
}

export class GatewayHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable: boolean,
    public body?: unknown,
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

/** fetch with timeout + retry on retryable statuses/network errors. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const attemptsDefault = opts.attempts ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attemptsDefault; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || !isRetryableStatus(res.status)) return res;
      lastErr = new GatewayHttpError(
        res.status, `HTTP_${res.status}`, `HTTP ${res.status}`, true, await safeText(res),
      );
    } catch (e) {
      lastErr = e;
    }
    if (attempt < attemptsDefault - 1) await sleep(backoffMs(attempt));
  }
  throw lastErr;
}

async function safeText(res: Response): Promise<string | undefined> {
  try { return await res.text(); } catch { return undefined; }
}
