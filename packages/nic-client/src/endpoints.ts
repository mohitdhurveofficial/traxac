import type { GatewayRequestContext } from "@traxac/gst-gateway";

/**
 * Credentials resolved (decrypted) for one government API session.
 * `appKey` is the per-session AES key NIC requires (ECB-encrypted password).
 */
export interface NicSessionCredentials {
  username: string;
  password: string;
  gstin: string;
  appKey: string; // base64 32-byte key generated per session
}

/** A live NIC session token with expiry. */
export interface NicToken {
  token: string;
  expiresAt: number; // epoch ms
}

export interface NicEndpoints {
  auth: string;
  irnGenerate: string;
  irnCancel: string;
  irnByIrn: string;
  ewbGenerate: string;
  ewbCancel: string;
  ewbExtend: string;
  ewbUpdateTransporter: string;
  base: string;
}

/** NIC e-Invoice sandbox endpoints (einvoice1.gst.gov.in). */
export const IRP_ENDPOINTS: NicEndpoints = {
  base: "https://einvoice1.gst.gov.in",
  auth: "/irp/v1.04/auth",
  irnGenerate: "/irp/candidate/v1.04/Invoice",
  irnCancel: "/irp/candidate/v1.04/Invoice/Cancel",
  irnByIrn: "/irp/candidate/v1.04/Invoice/irnbyirn",
  ewbGenerate: "", // EWB on IRP: /irp/candidate/v1.04/ewayapi
  ewbCancel: "",
  ewbExtend: "",
  ewbUpdateTransporter: "",
};

/** NIC e-Way Bill endpoints (ewaybillgst.gov.in). */
export const EWB_ENDPOINTS: NicEndpoints = {
  base: "https://ewaybillgst.gov.in",
  auth: "/ewb/authenticate",
  irnGenerate: "",
  irnCancel: "",
  irnByIrn: "",
  ewbGenerate: "/ewb/GENEWAYBILL",
  ewbCancel: "/ewb/CANEWB",
  ewbExtend: "/ewb/EXTENDVALIDITY",
  ewbUpdateTransporter: "/ewb/UPDATETRANSPORTER",
};

export type { GatewayRequestContext };
