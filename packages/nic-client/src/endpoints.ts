import type { GatewayEnvironment } from "@traxac/gst-gateway";

/**
 * NIC endpoints.
 *
 * Sandbox and production share the same path structure; only the host differs.
 * Base URLs are overridable per credential so a GSP-hosted proxy can be
 * pointed at without a code change.
 */
/**
 * Default hosts, confirmed by probing the live endpoints:
 *
 *   api.einvoice1.gst.gov.in/eivital/v1.04/auth
 *     {} -> 5003 "Data cannot be null or empty"
 *     {Data:"..."} -> 1020 "Decryption failed"
 *   einv-apisandbox.nic.in/ewaybillapi/v1.03/auth
 *     -> {"status":"0","error":"<base64 errorCodes>"}
 *
 * `einvoice1.gst.gov.in` serves the taxpayer web portal, not the API; the API
 * lives on the `api.` host and requests to the portal host 404.
 *
 * The e-Invoice **sandbox** base URL is issued per integrator when they
 * register at einv-apisandbox.nic.in, so it has no usable public default and
 * must be supplied through configuration or the per-credential base URL.
 */
export const NIC_HOSTS: Record<GatewayEnvironment, { irp: string | null; ewb: string }> = {
  sandbox: {
    // Set NIC_IRP_SANDBOX_BASE_URL (or the credential's base URL) to the host
    // NIC issues on registration. There is no correct default to guess.
    irp: null,
    ewb: "https://einv-apisandbox.nic.in",
  },
  production: {
    irp: "https://api.einvoice1.gst.gov.in",
    ewb: "https://ewaybillgst.gov.in",
  },
};

/**
 * e-Invoice (IRP) paths — `eivital` for auth, `eicore` for documents.
 *
 * The specification writes these against an `<URL>` placeholder that NIC
 * issues on registration: `<URL>/api/Invoice`, `<URL>/api/Cancel`,
 * `<URL>/api/Invoice/irn/<irn_no>`. Mapping `<URL>/api` onto `/eicore/v1.03`
 * reproduces the generate and get paths exactly, so cancel follows the same
 * mapping and is `/eicore/v1.03/Cancel` — note it is a sibling of `Invoice`,
 * not a child of it.
 *
 * @see https://einv-apisandbox.nic.in/version1.03/cancel-irn.html
 */
export const IRP_PATHS = {
  auth: "/eivital/v1.04/auth",
  generateIrn: "/eicore/v1.03/Invoice",
  cancelIrn: "/eicore/v1.03/Cancel",
  getIrn: (irn: string) => `/eicore/v1.03/Invoice/irn/${encodeURIComponent(irn)}`,
  getIrnByDoc: "/eicore/v1.03/Invoice/irnbydocdetails",
  /** e-Way Bill generated from an existing IRN. */
  ewbByIrn: "/eiewb/v1.03/ewaybill",
  /**
   * Read the e-Way Bill the IRP holds against an IRN.
   *
   * Confirmed against the specification. Note the sibling Cancel-EWB API on
   * the IRP is documented as **sandbox only** — "On the production
   * environment, the Cancel E Way Bill API of the E Way Bill System only
   * should be used" — which is why cancellation routes through the e-Way Bill
   * portal instead.
   *
   * @see https://einv-apisandbox.nic.in/version1.03/get-ewaybill-details-by-irn.html
   * @see https://einv-apisandbox.nic.in/version1.03/cancel-eway-bill.html
   */
  ewbByIrnDetails: (irn: string) => `/eiewb/v1.03/ewaybill/irn/${encodeURIComponent(irn)}`,
  /**
   * Taxpayer master lookup. v1.04 is the current version — it adds the
   * registration and de-registration dates that v1.03 did not carry.
   *
   * @see https://einv-apisandbox.nic.in/version1.04/get-gstin-details.html
   */
  getGstin: (gstin: string) => `/eivital/v1.04/Master/gstin/${encodeURIComponent(gstin)}`,
  /**
   * Force the IRP to re-read a taxpayer from the GST Common Portal.
   *
   * `Master/gstin` serves the IRP's own copy, which can lag the Common
   * Portal. This is what a user's explicit "refresh" should do — otherwise
   * refreshing just re-reads the same stale answer.
   *
   * @see https://einv-apisandbox.nic.in/version1.04/Sync-GSTIN-Details-from-CP.html
   */
  syncGstin: (gstin: string) => `/eivital/v1.04/Master/syncgstin/${encodeURIComponent(gstin)}`,
} as const;

/** e-Way Bill portal paths. Actions are selected by query string. */
export const EWB_PATHS = {
  auth: "/ewaybillapi/v1.03/auth",
  ewbApi: "/ewaybillapi/v1.03/ewayapi",
  getEwb: "/ewaybillapi/v1.03/ewayapi/GetEwayBill",
  /**
   * Master registers. Both answer with the REK envelope rather than plain
   * SEK encryption, and TRANSIN is a different register from GSTIN.
   *
   * @see https://docs.ewaybillgst.gov.in/apidocs/version1.03/get-gstin-details.html
   * @see https://docs.ewaybillgst.gov.in/apidocs/version1.03/get-transin-details.html
   */
  getGstin: (gstin: string) =>
    `/ewaybillapi/v1.03/Master/GetGSTINDetails?gstin=${encodeURIComponent(gstin)}`,
  getTransporter: (transin: string) =>
    `/ewaybillapi/v1.03/Master/GetTransporterDetails?trn_no=${encodeURIComponent(transin)}`,
} as const;

export const EWB_ACTIONS = {
  generate: "GENEWAYBILL",
  updatePartB: "VEHEWB",
  updateTransporter: "UPDATETRANSPORTER",
  extend: "EXTENDVALIDITY",
  cancel: "CANEWB",
} as const;

/**
 * Resolve the host for a call. Throws rather than guessing when no base URL
 * is configured — silently defaulting to the wrong host is how a request ends
 * up 404ing against a web portal instead of reaching the API.
 */
export function resolveBaseUrl(
  gateway: "irp" | "ewb",
  environment: GatewayEnvironment,
  override?: string,
): string {
  const base = override?.trim() || NIC_HOSTS[environment][gateway];
  if (!base) {
    throw new MissingBaseUrlError(
      `No ${gateway === "irp" ? "e-Invoice" : "e-Way Bill"} ${environment} base URL is configured. ` +
        "NIC issues this when you register for API access; set it on the credential or via " +
        `NIC_${gateway === "irp" ? "IRP" : "EWB"}_${environment.toUpperCase()}_BASE_URL.`,
    );
  }
  return base.replace(/\/+$/, "");
}

/** Raised when a gateway has no configured host — never substituted. */
export class MissingBaseUrlError extends Error {
  readonly code = "CREDENTIALS_MISSING";
  constructor(message: string) {
    super(message);
    this.name = "MissingBaseUrlError";
  }
}
