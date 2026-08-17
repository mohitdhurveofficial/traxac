import {
  gatewayFail,
  gatewayOk,
  type EinvoiceProvider,
  type GatewayRequestContext,
  type GatewayResult,
  type IrnDetails,
  type IrnResult,
  type IrpInvoicePayload,
  type GstinDetails,
} from "@traxac/gst-gateway";
import { aesDecrypt, aesEncrypt } from "./crypto.js";
import { IRP_PATHS, resolveBaseUrl } from "./endpoints.js";
import { isPermanentPortalError, NicHttpError, nicFetch, toGatewayError } from "./http.js";
import {
  integratorHeaders,
  MissingGatewayConfigError,
  parsePortalExpiry,
  type NicClientOptions,
  type NicSessionManager,
} from "./session.js";
import {
  IRP_AUTH_CODES,
  IRP_DUPLICATE_CODES,
  isSuccess,
  parseIrpError,
  type ParsedNicError,
} from "./errors.js";
import { MissingBaseUrlError } from "./endpoints.js";
import { verifyJws } from "./signed.js";
import { mapIrpGstinDetails } from "./registry-mapping.js";

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
        if (body.detail.details.some((d: { code: string }) => IRP_DUPLICATE_CODES.has(d.code))) {
          const recovered = await this.recoverDuplicate(ctx, payload, body.raw);
          if (recovered) return recovered;
        }
        return gatewayFail(portalError(body.detail), body.raw);
      }
      return gatewayOk(mapIrnResponse(body.data, this.signingCert(ctx)), body.raw);
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
    return gatewayOk(
      {
        irn: lookup.data.irn,
        ackNumber: lookup.data.ackNumber ?? "",
        ackDate: lookup.data.ackDate ?? new Date(),
        signedInvoice: lookup.data.signedInvoice ?? "",
        signedQrCode: lookup.data.signedQrCode ?? "",
        ewbNumber: lookup.data.ewbNumber ?? null,
        status: lookup.data.status || "ACT",
        alert: "Recovered an IRN the portal had already issued for this document",
      },
      raw,
    );
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
      return gatewayOk(
        {
          irn: String(data["Irn"] ?? input.irn),
          cancelDate: parsePortalExpiry(String(data["CancelDate"] ?? "")) ?? new Date(),
        },
        body.raw,
      );
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async getIrn(ctx: GatewayRequestContext, irn: string): Promise<GatewayResult<IrnDetails>> {
    try {
      const body = await this.call(ctx, "getIrn", "GET", IRP_PATHS.getIrn(irn));
      if (!body.ok) return gatewayFail(portalError(body.detail), body.raw);
      return gatewayOk(mapIrnDetails(body.data, irn, this.signingCert(ctx)), body.raw);
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
        ctx,
        "getIrnByDocument",
        "GET",
        `${IRP_PATHS.getIrnByDoc}?${query.toString()}`,
      );
      if (!body.ok) return gatewayFail(portalError(body.detail), body.raw);
      return gatewayOk(
        mapIrnDetails(body.data, String(body.data["Irn"] ?? ""), this.signingCert(ctx)),
        body.raw,
      );
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  /**
   * Resolve a taxpayer from the IRP master register.
   *
   * A read, so it is retried like any other GET. The portal's own field names
   * are mapped rather than reshaped, and anything it omitted stays null.
   */
  async getGstinDetails(
    ctx: GatewayRequestContext,
    gstin: string,
  ): Promise<GatewayResult<GstinDetails>> {
    try {
      const body = await this.call(ctx, "getGstinDetails", "GET", IRP_PATHS.getGstin(gstin));
      if (!body.ok) return gatewayFail(portalError(body.detail), body.raw);
      return gatewayOk(mapIrpGstinDetails(body.data, gstin), body.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  /** NIC's signing certificate for this environment, if one is configured. */
  private signingCert(ctx: GatewayRequestContext): string | undefined {
    return this.options.signingCerts?.[ctx.environment];
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
    const baseUrl = resolveBaseUrl(
      "irp",
      ctx.environment,
      ctx.credentials.baseUrl || this.options.baseUrls?.irp?.[ctx.environment],
    );

    const response = await nicFetch({
      url: `${baseUrl}${path}`,
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...integratorHeaders("irp", ctx),
        user_name: ctx.credentials.username,
        AuthToken: session.authToken,
        // Only when an e-commerce operator acts for another supplier.
        ...(ctx.supplierGstin ? { sup_gstin: ctx.supplierGstin } : {}),
      },
      body:
        payload === undefined
          ? undefined
          : { Data: aesEncrypt(session.sek, JSON.stringify(payload)) },
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
    if (isSuccess(body)) {
      const encrypted = body["Data"];
      const decoded =
        typeof encrypted === "string" && encrypted
          ? (JSON.parse(aesDecrypt(session.sek, encrypted)) as Record<string, unknown>)
          : body;
      return { ok: true, data: decoded, raw: redactRaw(body) };
    }

    const detail = parseIrpError(body);
    if (!isRetry && isAuthRejection(detail.code, response.status)) {
      await this.sessions.invalidate("irp", ctx);
      return this.call(ctx, operation, method, path, payload, true);
    }
    return { ok: false, detail, raw: redactRaw(body) };
  }

  private mapError(err: unknown) {
    if (err instanceof MissingGatewayConfigError || err instanceof MissingBaseUrlError) {
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
  | { ok: false; detail: ParsedNicError; raw: unknown };

export type PortalErrorDetail = ParsedNicError;

/**
 * Convert a parsed portal rejection into the gateway error the application
 * shows. `message` is the human sentence; the verbatim portal text stays in
 * `errors` and in the gateway call log for diagnosis.
 */
function portalError(detail: PortalErrorDetail) {
  return {
    code: detail.code,
    message: detail.userMessage,
    retryable: detail.retryable && !isPermanentPortalError(detail.code),
    errors: detail.details,
  };
}

/** An expired or rejected auth token: drop the session and try once more. */
function isAuthRejection(code: string, httpStatus: number): boolean {
  return httpStatus === 401 || IRP_AUTH_CODES.has(code);
}

function mapIrnResponse(data: Record<string, unknown>, signingCert?: string): IrnResult {
  const signedInvoice = String(data["SignedInvoice"] ?? "");
  const signedQrCode = String(data["SignedQRCode"] ?? "");
  return {
    irn: String(data["Irn"] ?? ""),
    ackNumber: String(data["AckNo"] ?? ""),
    ackDate: parsePortalExpiry(String(data["AckDt"] ?? "")) ?? new Date(),
    signedInvoice,
    signedQrCode,
    ewbNumber: data["EwbNo"] ? String(data["EwbNo"]) : null,
    ewbDate: data["EwbDt"] ? parsePortalExpiry(String(data["EwbDt"])) : null,
    ewbValidUntil: data["EwbValidTill"] ? parsePortalExpiry(String(data["EwbValidTill"])) : null,
    status: String(data["Status"] ?? "ACT"),
    alert: data["Remarks"] ? String(data["Remarks"]) : null,
    signedInvoiceSignature: verifyJws(signedInvoice, signingCert).status,
    signedQrSignature: verifyJws(signedQrCode, signingCert).status,
  };
}

function mapIrnDetails(
  data: Record<string, unknown>,
  fallbackIrn: string,
  signingCert?: string,
): IrnDetails {
  const signedInvoice = data["SignedInvoice"] ? String(data["SignedInvoice"]) : undefined;
  const signedQrCode = data["SignedQRCode"] ? String(data["SignedQRCode"]) : undefined;
  return {
    irn: String(data["Irn"] ?? fallbackIrn),
    ackNumber: data["AckNo"] ? String(data["AckNo"]) : undefined,
    ackDate: parsePortalExpiry(String(data["AckDt"] ?? "")) ?? undefined,
    status: String(data["Status"] ?? data["IrnStatus"] ?? "UNKNOWN"),
    signedInvoice,
    signedQrCode,
    ewbNumber: data["EwbNo"] ? String(data["EwbNo"]) : null,
    ewbDate: data["EwbDt"] ? parsePortalExpiry(String(data["EwbDt"])) : null,
    ewbValidUntil: data["EwbValidTill"] ? parsePortalExpiry(String(data["EwbValidTill"])) : null,
    cancelDate: data["CancelDate"] ? parsePortalExpiry(String(data["CancelDate"])) : null,
    remarks: data["Remarks"] ? String(data["Remarks"]) : null,
    signedInvoiceSignature: verifyJws(signedInvoice, signingCert).status,
    signedQrSignature: verifyJws(signedQrCode, signingCert).status,
  };
}

/** Keep the envelope for the audit trail but drop the opaque ciphertext. */
function redactRaw(body: Record<string, unknown>): Record<string, unknown> {
  const { Data: _data, ...rest } = body;
  return rest;
}
