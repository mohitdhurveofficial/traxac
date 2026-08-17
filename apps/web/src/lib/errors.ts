import { ApiError } from "../api/client.js";

export interface FriendlyError {
  /** One sentence, in the language a business owner uses. */
  title: string;
  /** Optional second line telling them what to do about it. */
  detail?: string;
  /** Support reference, shown small. Only present for our own faults. */
  reference?: string;
  /** True when trying the same thing again could plausibly work. */
  retryable: boolean;
}

/**
 * Turns anything thrown by a query or mutation into something a person can act
 * on.
 *
 * The server already refuses to leak stack traces, SQL, or NIC protocol text,
 * so this layer is about tone and next steps rather than redaction: "Session
 * expired" instead of "UNAUTHENTICATED", and a sentence saying what to do.
 */
export function describeError(error: unknown): FriendlyError | null {
  if (!error) return null;

  if (error instanceof ApiError) {
    const base = BY_CODE[error.code] ?? BY_STATUS(error.status);
    return {
      ...base,
      // Field-level problems are shown on the fields themselves; the banner
      // just says how many need attention.
      detail: fieldSummary(error) ?? base.detail,
      ...(error.requestId ? { reference: error.requestId } : {}),
    };
  }

  // fetch() rejects rather than resolving when the network is unreachable.
  if (error instanceof TypeError || (error instanceof Error && error.name === "TypeError")) {
    return {
      title: navigator.onLine ? "Could not reach Traxac" : "You are offline",
      detail: navigator.onLine
        ? "The connection dropped mid-request. Check your internet and try again."
        : "Reconnect to the internet and try again. Nothing you had typed has been lost.",
      retryable: true,
    };
  }

  if (error instanceof Error && error.name === "AbortError") return null;

  return { title: "Something went wrong", detail: "Please try again.", retryable: true };
}

/** Convenience for places that only have room for one line. */
export function errorMessage(error: unknown): string | null {
  const described = describeError(error);
  return described ? described.title : null;
}

function fieldSummary(error: ApiError): string | undefined {
  const count = Object.keys(error.fieldErrors).length;
  if (count === 0) return undefined;
  return count === 1 ? "One field needs attention." : `${count} fields need attention.`;
}

const BY_CODE: Record<string, FriendlyError> = {
  VALIDATION_FAILED: {
    title: "Some details need fixing",
    detail: "Check the highlighted fields and save again.",
    retryable: false,
  },
  UNAUTHENTICATED: {
    title: "Your session expired",
    detail: "Sign in again to continue. Anything already saved is safe.",
    retryable: false,
  },
  FORBIDDEN: {
    title: "You do not have access to this",
    detail: "Ask an owner or admin on your team to give you permission.",
    retryable: false,
  },
  NOT_FOUND: {
    title: "This no longer exists",
    detail: "It may have been deleted, or the link may be out of date.",
    retryable: false,
  },
  CONFLICT: {
    title: "That conflicts with something already saved",
    detail: "Reload the page to see the current version, then try again.",
    retryable: false,
  },
  INVALID_STATE: {
    title: "This cannot be done right now",
    detail: "The document has moved on since this page loaded. Reload to see where it stands.",
    retryable: false,
  },
  CREDENTIALS_MISSING: {
    title: "GST portal is not connected",
    detail: "Add your GST portal credentials in Settings › GST connection to use this.",
    retryable: false,
  },
  GATEWAY_ERROR: {
    title: "The GST portal could not complete this",
    detail: "This is on the government portal's side. Traxac will keep retrying automatically.",
    retryable: true,
  },
  RATE_LIMITED: {
    title: "Too many attempts",
    detail: "Wait a moment, then try again.",
    retryable: true,
  },
  PAYLOAD_TOO_LARGE: {
    title: "That file is too large",
    detail: "Attachments must be under 20 MB.",
    retryable: false,
  },
  UNSUPPORTED_MEDIA_TYPE: {
    title: "That file type is not supported",
    detail: "Attach a PDF, image, CSV, or Excel file.",
    retryable: false,
  },
  INTERNAL: {
    title: "Something went wrong on our side",
    detail: "We have been notified. Please try again in a moment.",
    retryable: true,
  },
};

function BY_STATUS(status: number): FriendlyError {
  if (status === 0 || status >= 500) return BY_CODE["INTERNAL"] as FriendlyError;
  if (status === 404) return BY_CODE["NOT_FOUND"] as FriendlyError;
  if (status === 403) return BY_CODE["FORBIDDEN"] as FriendlyError;
  if (status === 401) return BY_CODE["UNAUTHENTICATED"] as FriendlyError;
  return {
    title: "That request could not be processed",
    detail: "Check the details and try again.",
    retryable: false,
  };
}
