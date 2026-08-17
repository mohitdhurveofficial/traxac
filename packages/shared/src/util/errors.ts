/**
 * Domain error taxonomy. Every error crossing the API boundary carries a
 * stable machine-readable `code` so clients (web today, mobile later) can
 * react without string-matching messages.
 */

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TENANT_ISOLATION"
  | "INVALID_STATE"
  | "GATEWAY_ERROR"
  | "CREDENTIALS_MISSING"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TENANT_ISOLATION: 403,
  INVALID_STATE: 409,
  GATEWAY_ERROR: 502,
  CREDENTIALS_MISSING: 412,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** True when the same call could succeed if retried later. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }

  toJSON(): { code: ErrorCode; message: string; details?: unknown } {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export const notFound = (what: string): AppError => new AppError("NOT_FOUND", `${what} not found`);

export const invalidState = (message: string, details?: unknown): AppError =>
  new AppError("INVALID_STATE", message, { details });

export const validationFailed = (message: string, details?: unknown): AppError =>
  new AppError("VALIDATION_FAILED", message, { details });

export const forbidden = (message = "You do not have access to this resource"): AppError =>
  new AppError("FORBIDDEN", message);

export const conflict = (message: string, details?: unknown): AppError =>
  new AppError("CONFLICT", message, { details });

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
