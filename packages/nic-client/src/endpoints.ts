import type { GatewayEnvironment } from "@traxac/gst-gateway";

/**
 * NIC endpoints.
 *
 * Sandbox and production share the same path structure; only the host differs.
 * Base URLs are overridable per credential so a GSP-hosted proxy can be
 * pointed at without a code change.
 */
export const NIC_HOSTS: Record<GatewayEnvironment, { irp: string; ewb: string }> = {
  sandbox: {
    irp: "https://einv-apisandbox.nic.in",
    ewb: "https://einv-apisandbox.nic.in",
  },
  production: {
    irp: "https://einvoice1.gst.gov.in",
    ewb: "https://ewaybillgst.gov.in",
  },
};

/** e-Invoice (IRP) paths — `eivital` for auth, `eicore` for documents. */
export const IRP_PATHS = {
  auth: "/eivital/v1.04/auth",
  generateIrn: "/eicore/v1.03/Invoice",
  cancelIrn: "/eicore/v1.03/Invoice/Cancel",
  getIrn: (irn: string) => `/eicore/v1.03/Invoice/irn/${encodeURIComponent(irn)}`,
  getIrnByDoc: "/eicore/v1.03/Invoice/irnbydocdetails",
  /** e-Way Bill generated from an existing IRN. */
  ewbByIrn: "/eiewb/v1.03/ewaybill",
} as const;

/** e-Way Bill portal paths. Actions are selected by query string. */
export const EWB_PATHS = {
  auth: "/ewaybillapi/v1.03/auth",
  ewbApi: "/ewaybillapi/v1.03/ewayapi",
  getEwb: "/ewaybillapi/v1.03/ewayapi/GetEwayBill",
} as const;

export const EWB_ACTIONS = {
  generate: "GENEWAYBILL",
  updatePartB: "VEHEWB",
  updateTransporter: "UPDATETRANSPORTER",
  extend: "EXTENDVALIDITY",
  cancel: "CANEWB",
} as const;

export function resolveBaseUrl(
  gateway: "irp" | "ewb",
  environment: GatewayEnvironment,
  override?: string,
): string {
  const base = override?.trim() || NIC_HOSTS[environment][gateway];
  return base.replace(/\/+$/, "");
}
