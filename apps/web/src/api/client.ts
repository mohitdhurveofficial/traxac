/**
 * API client.
 *
 * The browser authenticates with the httpOnly session cookie, so there is no
 * token in JavaScript to steal. Every failure is normalised to `ApiError`, so
 * screens branch on `code` instead of parsing messages.
 */
const BASE = import.meta.env["VITE_API_BASE"] ?? "/api";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level messages from a 422, keyed by field path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as Array<{ field?: string; message?: string }>)
        .filter((d) => d.field && d.message)
        .map((d) => [d.field as string, d.message as string]),
    );
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body === undefined ? {} : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new ApiError("INTERNAL", `Request failed (${response.status})`, response.status);
    }
    return (await response.blob()) as T;
  }

  const payload = await response.json();
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      .error;
    throw new ApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? "Something went wrong",
      response.status,
      error?.details,
    );
  }
  return payload as T;
}

export const get = <T>(path: string, query?: RequestOptions["query"]): Promise<T> =>
  api<T>(path, { query });
export const post = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: "POST", body });
export const put = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: "PUT", body });
export const patch = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: "PATCH", body });
export const del = <T>(path: string): Promise<T> => api<T>(path, { method: "DELETE" });
