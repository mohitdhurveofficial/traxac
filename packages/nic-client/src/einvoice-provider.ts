import {
  DUPLICATE_IRN_CODES, gatewayFail, gatewayOk,
  type EinvoiceProvider, type GatewayRequestContext, type GatewayResult,
  type IrnDetails, type IrnResult, type IrpInvoicePayload,
} from "@traxac/gst-gateway";
import { aesDecrypt, aesEncrypt } from "./crypto.js";
import { IRP_PATHS, resolveBaseUrl } from "./endpoints.js";
import { isPermanentPortalError, NicHttpError, nicFetch, toGatewayError } from "./http.js";
import {
  extractErrorDetail, MissingGatewayConfigError, parsePortalExpiry,
  type NicClientOptions, type NicSessionManager,
} from "./session.js";

/**
 * e-Invoice provider speaking the NIC IRP protocol directly.
 *
 * Two behaviours are deliberate:
 *  - A duplicate-IRN rejection (2150) is **not** an error. The portal returns
 *    the existing IRN, which is exactly the right answer for a retried job.
 *  - Nothing is ever invented. Without credentials or the environment public
 *    key the call fails with CREDENTIALS_MISSING.
 */
export class NicEinvoiceProvider implements EinvoiceProvider {
  readonly id = "irp" as const;

  constructor(
    private readonly sessions: NicSessionManager,
    private readonly options: NicClientOptions,
  ) {}

  async verify(ctx: GatewayRequestContext): Promise<GatewayResult<{ verifiedAt: Date }>> {
    try {
      await this.sessions.session("irp", ctx);
      return gatewayOk({ verifiedAt: new Date() });
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async generateIrn(
    ctx: GatewayRequestContext,
    payload: IrpInvoicePayload,
  ): Promise<GatewayResult<IrnResult>> {
    try {
      const body = await this.call(ctx, "generateIrn", "POST", IRP_PATHS.generateIrn, payload);
      if (!body.ok) {
        // The portal already holds this document: recover rather than fail.
        if (body.detail.errors.some((e) => DUPLICATE_IRN_CODES.has(e.code))) {
          const recovered = await this.recoverDuplicate(ctx, payload, body.raw);
          if (recovered) return recovered;
        }
        return gatewayFail(portalError(body.detail), body.raw);
      }
      return gatewayOk(mapIrnResponse(body.data), body.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  /**
   * On a duplicate the portal returns the original IRN in `InfoDtls` or, for
   * older responses, only an error. Reading it back by document number gives
   * the authoritative record either way.
   */
  private async recoverDuplicate(
    ctx: GatewayRequestContext,
    payload: IrpInvoicePayload,
    raw: unknown,
  ): Promise<GatewayResult<IrnResult> | null> {
    const lookup = await this.getIrnByDocument(ctx, {
      docType: payload.DocDtls.Typ,
      docNo: payload.DocDtls.No,
      docDate: payload.DocDtls.Dt,
    });
    if (!lookup.ok || !lookup.data.irn) return null;
    return gatewayOk({
      irn: lookup.data.irn,
      ackNumber: lookup.data.ackNumber ?? "",
      ackDate: lookup.data.ackDate ?? new Date(),
      signedInvoice: lookup.data.signedInvoice ?? "",
      signedQrCode: lookup.data.signedQrCode ?? "",
      ewbNumber: lookup.data.ewbNumber ?? null,
      status: lookup.data.status || "ACT",
      alert: "Recovered an IRN the portal had already issued for this document",
    }, raw);
  }

  async cancelIrn(
    ctx: GatewayRequestContext,
    input: { irn: string; reasonCode: string; remark: string },
  ): Promise<GatewayResult<{ irn: string; cancelDate: Date }>> {
    try {
      const body = await this.call(ctx, "cancelIrn", "POST", IRP_PATHS.cancelIrn, {
        Irn: input.irn,
        CnlRsn: input.reasonCode,
        CnlRem: input.remark,
      });
      if (!body.ok) return gatewayFail(portalError(body.detail), body.raw);
      const data = body.data;
      return gatewayOk({
        irn: String(data["Irn"] ?? input.irn),
        cancelDate: parsePortalExpiry(String(data["CancelDate"] ?? "")) ?? new Date(),
      }, body.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async getIrn(ctx: GatewayRequestContext, irn: string): Promise<GatewayResult<IrnDetails>> {
    try {
      const body = await this.call(ctx, "getIrn", "GET", IRP_PATHS.getIrn(irn));
      if (!body.ok) return gatewayFail(portalError(body.detail), body.raw);
      return gatewayOk(mapIrnDetails(body.data, irn), body.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async getIrnByDocument(
    ctx: GatewayRequestContext,
    input: { docType: string; docNo: string; docDate: string },
  ): Promise<GatewayResult<IrnDetails>> {
    const query = new URLSearchParams({
      doctype: input.docType,
      docno: input.docNo,
      docdate: input.docDate,
    });
    try {
      const body = await this.call(
        ctx, "getIrnByDocument", "GET", `${IRP_PATHS.getIrnByDoc}?${query.toString()}`,
      );
      if (!body.ok) return gatewayFail(portalError(body.detail), body.raw);
      return gatewayOk(mapIrnDetails(body.data, String(body.data["Irn"] ?? "")), body.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  /**
   * One encrypted exchange. A rejected auth token is retried exactly once
   * with a fresh session, because tokens can expire mid-flight.
   */
  private async call(
    ctx: GatewayRequestContext,
    operation: string,
    method: "GET" | "POST",
    path: string,
    payload?: unknown,
    isRetry = false,
  ): Promise<PortalOutcome> {
    const session = await this.sessions.session("irp", ctx);
    const baseUrl = resolveBaseUrl("irp", ctx.environment, ctx.credentials.baseUrl);

    const response = await nicFetch({
      url: `${baseUrl}${path}`,
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        client_id: ctx.credentials.clientId,
        client_secret: ctx.credentials.clientSecret,
        Gstin: ctx.gstin,
        gstin: ctx.gstin,
        user_name: ctx.credentials.username,
        AuthToken: session.authToken,
      },
      body: payload === undefined ? undefined : { Data: aesEncrypt(session.sek, JSON.stringify(payload)) },
      timeoutMs: this.options.timeoutMs,
      // A document-creating call is sent once; only reads are retried.
      attempts: method === "GET" ? (this.options.attempts ?? 3) : 1,
      telemetry: this.options.telemetry
        ? {
            sink: this.options.telemetry,
            tenantId: ctx.tenantId,
            gateway: "irp",
            operation,
            gstin: ctx.gstin,
            idempotencyKey: ctx.idempotencyKey,
            loggablePayload: payload,
          }
        : undefined,
    });

    const body = response.json ?? {};
    const status = String(body["Status"] ?? "");
    if (status === "1") {
      const encrypted = body["Data"];
      const decoded = typeof encrypted === "string" && encrypted
        ? JSON.parse(aesDecrypt(session.sek, encrypted)) as Record<string, unknown>
        : (body);
      return { ok: true, data: decoded, raw: redactRaw(body) };
    }

    const detail = extractErrorDetail(body);
    if (!isRetry && isAuthRejection(detail.code, response.status)) {
      await this.sessions.invalidate("irp", ctx);
      return this.call(ctx, operation, method, path, payload, true);
    }
    return { ok: false, detail, raw: redactRaw(body) };
  }

  private mapError(err: unknown) {
    if (err instanceof MissingGatewayConfigError) {
      return { code: "CREDENTIALS_MISSING", message: err.message, retryable: false };
    }
    if (err instanceof NicHttpError) {
      return { code: err.code, message: err.message, retryable: err.retryable };
    }
    return toGatewayError(err);
  }
}

/** Result of one encrypted exchange, before it becomes a GatewayResult. */
export type PortalOutcome =
  | { ok: true; data: Record<string, unknown>; raw: unknown }
  | { ok: false; detail: PortalErrorDetail; raw: unknown };

export type PortalErrorDetail = ReturnType<typeof extractErrorDetail>;

function portalError(detail: PortalErrorDetail) {
  return {
    code: detail.code,
    message: detail.message,
    retryable: !isPermanentPortalError(detail.code),
    errors: detail.errors,
  };
}

/** 1005/1006 and HTTP 401 mean the auth token was rejected. */
function isAuthRejection(code: string, httpStatus: number): boolean {
  return httpStatus === 401 || code === "1005" || code === "1006" || code === "1007";
}

function mapIrnResponse(data: Record<string, unknown>): IrnResult {
  return {
    irn: String(data["Irn"] ?? ""),
    ackNumber: String(data["AckNo"] ?? ""),
    ackDate: parsePortalExpiry(String(data["AckDt"] ?? "")) ?? new Date(),
    signedInvoice: String(data["SignedInvoice"] ?? ""),
    signedQrCode: String(data["SignedQRCode"] ?? ""),
    ewbNumber: data["EwbNo"] ? String(data["EwbNo"]) : null,
    ewbValidUntil: data["EwbValidTill"]
      ? parsePortalExpiry(String(data["EwbValidTill"]))
      : null,
    status: String(data["Status"] ?? "ACT"),
    alert: data["Remarks"] ? String(data["Remarks"]) : null,
  };
}

function mapIrnDetails(data: Record<string, unknown>, fallbackIrn: string): IrnDetails {
  return {
    irn: String(data["Irn"] ?? fallbackIrn),
    ackNumber: data["AckNo"] ? String(data["AckNo"]) : undefined,
    ackDate: parsePortalExpiry(String(data["AckDt"] ?? "")) ?? undefined,
    status: String(data["Status"] ?? data["IrnStatus"] ?? "UNKNOWN"),
    signedInvoice: data["SignedInvoice"] ? String(data["SignedInvoice"]) : undefined,
    signedQrCode: data["SignedQRCode"] ? String(data["SignedQRCode"]) : undefined,
    ewbNumber: data["EwbNo"] ? String(data["EwbNo"]) : null,
    cancelDate: data["CancelDate"] ? parsePortalExpiry(String(data["CancelDate"])) : null,
  };
}

/** Keep the envelope for the audit trail but drop the opaque ciphertext. */
function redactRaw(body: Record<string, unknown>): Record<string, unknown> {
  const { Data: _data, ...rest } = body;
  return rest;
}
