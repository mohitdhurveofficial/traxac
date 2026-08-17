/**
 * NIC error handling.
 *
 * The two portals report failures in different shapes, and neither is
 * presentable to a trader:
 *
 *   IRP  {"Status":0,"ErrorDetails":[{"ErrorCode":"2150","ErrorMessage":"..."}]}
 *   EWB  {"status":"0","error":"<base64 of {\"errorCodes\":\"116\"}>"}
 *
 * Both shapes were confirmed against the live endpoints. This module turns
 * either one into a single structured error carrying the raw codes for the
 * audit trail and a plain-English message for the screen.
 */

export interface NicErrorDetail {
  code: string;
  message: string;
}

export interface ParsedNicError {
  /** Primary portal code, e.g. "2150". */
  code: string;
  /** Every code the portal reported. */
  details: NicErrorDetail[];
  /** Verbatim portal text, kept for the audit trail — never shown as-is. */
  rawMessage: string;
  /** What a trader is told. */
  userMessage: string;
  /** True when retrying the same request could plausibly succeed. */
  retryable: boolean;
}

/**
 * Codes the portals return, mapped to what the user should do about them.
 *
 * Only codes with a confident, actionable meaning are listed. Anything else
 * falls back to a generic message plus the portal's own text, so an unmapped
 * code degrades to "readable" rather than "wrong".
 */
const IRP_MESSAGES: Record<string, string> = {
  "1005": "The e-Invoice session expired. It will be retried automatically.",
  "1006": "The e-Invoice session is invalid. It will be retried automatically.",
  "1020":
    "The e-Invoice credentials could not be read by the portal. Check the API username and password in Settings.",
  "2150": "This invoice already has an IRN on the portal. The existing one has been linked.",
  "2172": "An IRN already exists for this document number.",
  "2176": "The invoice number contains characters the portal does not accept.",
  "2182": "The taxable value does not match the sum of the line items.",
  "2189": "The invoice total does not match the calculated total.",
  "2193": "The tax amounts do not match the rate applied to the taxable value.",
  "2194": "The invoice value does not match the sum of the line items.",
  "2211": "The buyer's GSTIN is not active on the portal.",
  "2212": "The seller's GSTIN is not active on the portal.",
  "2233": "The document date cannot be in the future.",
  "2240": "The place of supply is not valid for this transaction.",
  "3028": "The buyer's GSTIN is not registered on the portal.",
  "3029": "The buyer's GSTIN is not active.",
  "3075": "e-Invoicing is not enabled for this GSTIN.",
  "3077": "This GSTIN is not authorised to use the e-Invoice API.",
  "4019": "The document date is outside the period the portal accepts.",
  "5003": "The request reached the portal empty. This is an internal error and has been logged.",
};

const EWB_MESSAGES: Record<string, string> = {
  "102": "The e-Way Bill session expired. It will be retried automatically.",
  "103":
    "The e-Way Bill credentials were rejected. Check the API username and password in Settings.",
  "107":
    "The e-Way Bill API credentials were rejected by the portal. Check the username, password, client ID and client secret in Settings.",
  "104": "The e-Way Bill request could not be read by the portal.",
  "106":
    "The e-Way Bill credentials were rejected. Check the API username and password in Settings.",
  "108": "The e-Way Bill session is invalid. It will be retried automatically.",
  "109": "This GSTIN is not registered on the e-Way Bill portal.",
  "110":
    "The e-Way Bill credentials were rejected. Check the API username and password in Settings.",
  "116": "The e-Way Bill username or client credentials are not valid for this GSTIN.",
  "201": "The document number is missing or not in a format the portal accepts.",
  "202": "The document date is missing or invalid.",
  "203": "The supplier GSTIN is not valid.",
  "204": "The buyer GSTIN is not valid.",
  "205": "The document type is not valid for this transaction.",
  "212": "The HSN code is not valid for one of the items.",
  "220": "The vehicle number is not in a format the portal accepts.",
  "228": "The transport distance is missing or outside the allowed range.",
  "230": "The transporter ID is not valid.",
  "238": "The e-Way Bill session is invalid. It will be retried automatically.",
  "311": "This e-Way Bill cannot be cancelled — the 24-hour window has passed.",
  "312": "An e-Way Bill already exists for this document.",
  "325": "The requested e-Way Bill operation is not valid.",
  "342": "The validity of this e-Way Bill cannot be extended yet.",
  "343": "The extension window for this e-Way Bill has closed.",
  "376": "The e-Way Bill has already been cancelled.",
  "378": "This e-Way Bill has already been verified in transit and cannot be changed.",
  "393":
    "The e-Way Bill request is missing the GSTIN header. This is an internal error and has been logged.",
  "604": "An e-Way Bill already exists for this document. The existing one has been linked.",
};

/** Codes that mean the portal already holds the document — not failures. */
export const IRP_DUPLICATE_CODES = new Set(["2150", "2172"]);
export const EWB_DUPLICATE_CODES = new Set(["604", "312"]);

/** Codes that mean the session must be discarded and re-established. */
export const IRP_AUTH_CODES = new Set(["1005", "1006", "1007"]);
export const EWB_AUTH_CODES = new Set(["102", "108", "238"]);

/**
 * Codes worth retrying. Everything the portal rejects on content is
 * permanent: resending an identical payload gets an identical rejection, and
 * for a document-creating call it risks a duplicate.
 */
const RETRYABLE = new Set([
  ...IRP_AUTH_CODES,
  ...EWB_AUTH_CODES,
  "5000", // portal internal error
  "5001",
  "5002",
]);

function messageFor(gateway: "irp" | "ewb", code: string): string | undefined {
  return gateway === "irp" ? IRP_MESSAGES[code] : EWB_MESSAGES[code];
}

/** IRP shape: `ErrorDetails: [{ ErrorCode, ErrorMessage }]`. */
export function parseIrpError(body: Record<string, unknown>): ParsedNicError {
  const raw = body["ErrorDetails"] ?? body["errorDetails"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const details: NicErrorDetail[] = list.map((item) => {
    const entry = item as Record<string, unknown>;
    return {
      code: scalar(entry["ErrorCode"] ?? entry["errorCode"]) || "UNKNOWN",
      message: scalar(entry["ErrorMessage"] ?? entry["errorMessage"]) || "Unspecified portal error",
    };
  });

  if (details.length === 0) {
    const fallback = scalar(body["ErrorMessage"] ?? body["message"]);
    details.push({ code: "UNKNOWN", message: fallback || "The portal rejected the request" });
  }
  return assemble("irp", details);
}

/**
 * EWB shape: a base64 blob in `error` decoding to `{"errorCodes":"116,220"}`.
 * The portal sends codes only — no text — so the message comes from the map.
 */
export function parseEwbError(body: Record<string, unknown>): ParsedNicError {
  const encoded = scalar(body["error"] ?? body["Error"]);
  const codes: string[] = [];
  let rawText = "";

  if (encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      rawText = decoded;
      const parsed = JSON.parse(decoded) as { errorCodes?: unknown; message?: unknown };
      const list = scalar(parsed.errorCodes);
      if (list)
        codes.push(
          ...list
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        );
      const text = scalar(parsed.message);
      if (text) rawText = text;
    } catch {
      // Not base64 JSON — keep whatever the portal sent for the audit trail.
      rawText = encoded;
    }
  }

  const details: NicErrorDetail[] = codes.length
    ? codes.map((code) => ({ code, message: EWB_MESSAGES[code] ?? "" }))
    : [{ code: "UNKNOWN", message: rawText || "The portal rejected the request" }];

  return assemble("ewb", details, rawText);
}

function assemble(
  gateway: "irp" | "ewb",
  details: NicErrorDetail[],
  rawOverride?: string,
): ParsedNicError {
  const primary = details[0] as NicErrorDetail;
  const mapped = messageFor(gateway, primary.code);

  // An unmapped code still has to read as a sentence, so the portal's own
  // text is surfaced with context rather than a bare number.
  const portal = gateway === "irp" ? "e-Invoice" : "e-Way Bill";
  const hasText = primary.message && primary.message !== "Unspecified portal error";
  const userMessage =
    mapped ??
    (hasText
      ? `The ${portal} portal rejected this: ${primary.message}`
      : `The ${portal} portal rejected this request (code ${primary.code}). ` +
        "The full response has been recorded for support.");

  return {
    code: primary.code,
    details,
    rawMessage: rawOverride || details.map((d) => `${d.code}: ${d.message}`).join("; "),
    userMessage,
    retryable: details.every((d) => RETRYABLE.has(d.code)),
  };
}

/** Coerce a portal field that should be scalar, without "[object Object]". */
function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** True when a portal response indicates success. Status is 1 or "1". */
export function isSuccess(body: Record<string, unknown>): boolean {
  const status = body["Status"] ?? body["status"];
  return status === 1 || status === "1";
}
