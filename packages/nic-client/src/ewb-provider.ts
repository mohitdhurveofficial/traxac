import {
  DUPLICATE_EWB_CODES, gatewayFail, gatewayOk,
  type EwbCancelPayload, type EwbDetails, type EwbExtendPayload,
  type EwbGeneratePayload, type EwbGenerateResult, type EwbPartBPayload,
  type EwbProvider, type EwbUpdateTransporterPayload,
  type GatewayRequestContext, type GatewayResult,
} from "@traxac/gst-gateway";
import { aesDecrypt, aesEncrypt } from "./crypto.js";
import { EWB_ACTIONS, EWB_PATHS, resolveBaseUrl } from "./endpoints.js";
import { isPermanentPortalError, NicHttpError, nicFetch, toGatewayError } from "./http.js";
import {
  extractErrorDetail, MissingGatewayConfigError,
  type NicClientOptions, type NicSessionManager,
} from "./session.js";
import type { PortalErrorDetail, PortalOutcome } from "./einvoice-provider.js";

/**
 * e-Way Bill provider speaking the NIC EWB API directly.
 *
 * The EWB portal returns dates as "dd/MM/yyyy hh:mm:ss AM/PM", which is parsed
 * into real Dates here so nothing downstream has to deal with portal
 * formatting.
 */
export class NicEwbProvider implements EwbProvider {
  readonly id = "ewb" as const;

  constructor(
    private readonly sessions: NicSessionManager,
    private readonly options: NicClientOptions,
  ) {}

  async verify(ctx: GatewayRequestContext): Promise<GatewayResult<{ verifiedAt: Date }>> {
    try {
      await this.sessions.session("ewb", ctx);
      return gatewayOk({ verifiedAt: new Date() });
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async generate(
    ctx: GatewayRequestContext,
    payload: EwbGeneratePayload,
  ): Promise<GatewayResult<EwbGenerateResult>> {
    try {
      const outcome = await this.action(ctx, "generate", EWB_ACTIONS.generate, payload);
      if (!outcome.ok) {
        // 604: an EWB already exists for this document — read it back instead.
        if (outcome.detail.errors.some((e) => DUPLICATE_EWB_CODES.has(e.code))) {
          const existing = extractExistingEwbNumber(outcome.detail);
          if (existing) {
            const lookup = await this.getEwb(ctx, existing);
            if (lookup.ok) {
              return gatewayOk({
                ewbNumber: lookup.data.ewbNumber,
                generatedAt: lookup.data.generatedAt ?? new Date(),
                validUntil: lookup.data.validUntil ?? new Date(),
                alert: "Recovered an e-Way Bill the portal had already issued",
              }, outcome.raw);
            }
          }
        }
        return gatewayFail(portalError(outcome.detail), outcome.raw);
      }
      const data = outcome.data;
      return gatewayOk({
        ewbNumber: String(data["ewayBillNo"] ?? data["ewbNo"] ?? ""),
        generatedAt: parseEwbDate(String(data["ewayBillDate"] ?? "")) ?? new Date(),
        validUntil: parseEwbDate(String(data["validUpto"] ?? "")) ?? new Date(),
        alert: data["alert"] ? String(data["alert"]) : null,
      }, outcome.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async updatePartB(
    ctx: GatewayRequestContext,
    payload: EwbPartBPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; validUntil: Date; vehicleNo?: string }>> {
    try {
      const outcome = await this.action(ctx, "updatePartB", EWB_ACTIONS.updatePartB, payload);
      if (!outcome.ok) return gatewayFail(portalError(outcome.detail), outcome.raw);
      const data = outcome.data;
      return gatewayOk({
        ewbNumber: String(data["ewayBillNo"] ?? payload.ewbNo),
        validUntil: parseEwbDate(String(data["validUpto"] ?? "")) ?? new Date(),
        vehicleNo: data["vehicleNo"] ? String(data["vehicleNo"]) : payload.vehicleNo,
      }, outcome.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async updateTransporter(
    ctx: GatewayRequestContext,
    payload: EwbUpdateTransporterPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; transporterId: string }>> {
    try {
      const outcome = await this.action(
        ctx, "updateTransporter", EWB_ACTIONS.updateTransporter, payload,
      );
      if (!outcome.ok) return gatewayFail(portalError(outcome.detail), outcome.raw);
      return gatewayOk({
        ewbNumber: String(outcome.data["ewayBillNo"] ?? payload.ewbNo),
        transporterId: payload.transporterId,
      }, outcome.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async extend(
    ctx: GatewayRequestContext,
    payload: EwbExtendPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; validUntil: Date }>> {
    try {
      const outcome = await this.action(ctx, "extend", EWB_ACTIONS.extend, payload);
      if (!outcome.ok) return gatewayFail(portalError(outcome.detail), outcome.raw);
      const data = outcome.data;
      const validUntil = parseEwbDate(String(data["validUpto"] ?? ""));
      if (!validUntil) {
        return gatewayFail({
          code: "EWB_NO_VALIDITY",
          message: "The portal accepted the extension but returned no new validity date",
          retryable: false,
        }, outcome.raw);
      }
      return gatewayOk({
        ewbNumber: String(data["ewayBillNo"] ?? payload.ewbNo),
        validUntil,
      }, outcome.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async cancel(
    ctx: GatewayRequestContext,
    payload: EwbCancelPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; cancelledAt: Date }>> {
    try {
      const outcome = await this.action(ctx, "cancel", EWB_ACTIONS.cancel, payload);
      if (!outcome.ok) return gatewayFail(portalError(outcome.detail), outcome.raw);
      return gatewayOk({
        ewbNumber: String(outcome.data["ewayBillNo"] ?? payload.ewbNo),
        cancelledAt: parseEwbDate(String(outcome.data["cancelDate"] ?? "")) ?? new Date(),
      }, outcome.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  async getEwb(ctx: GatewayRequestContext, ewbNumber: string): Promise<GatewayResult<EwbDetails>> {
    try {
      const outcome = await this.request(
        ctx, "getEwb", "GET",
        `${EWB_PATHS.getEwb}?ewbNo=${encodeURIComponent(ewbNumber)}`,
      );
      if (!outcome.ok) return gatewayFail(portalError(outcome.detail), outcome.raw);
      const data = outcome.data;
      return gatewayOk({
        ewbNumber: String(data["ewbNo"] ?? data["ewayBillNo"] ?? ewbNumber),
        status: String(data["status"] ?? "ACT"),
        generatedAt: parseEwbDate(String(data["ewayBillDate"] ?? "")) ?? undefined,
        validUntil: parseEwbDate(String(data["validUpto"] ?? "")) ?? undefined,
        vehicleNo: data["vehicleNo"] ? String(data["vehicleNo"]) : null,
        transporterId: data["transporterId"] ? String(data["transporterId"]) : null,
        cancelledAt: data["cancelDate"] ? parseEwbDate(String(data["cancelDate"])) : null,
      }, outcome.raw);
    } catch (err) {
      return gatewayFail(this.mapError(err));
    }
  }

  /** POST an encrypted action payload to the EWB action endpoint. */
  private action(
    ctx: GatewayRequestContext,
    operation: string,
    action: string,
    payload: unknown,
  ): Promise<PortalOutcome> {
    return this.request(ctx, operation, "POST", EWB_PATHS.ewbApi, { action, payload });
  }

  private async request(
    ctx: GatewayRequestContext,
    operation: string,
    method: "GET" | "POST",
    path: string,
    input?: { action: string; payload: unknown },
    isRetry = false,
  ): Promise<PortalOutcome> {
    const session = await this.sessions.session("ewb", ctx);
    const baseUrl = resolveBaseUrl("ewb", ctx.environment, ctx.credentials.baseUrl);

    const response = await nicFetch({
      url: `${baseUrl}${path}`,
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        client_id: ctx.credentials.clientId,
        client_secret: ctx.credentials.clientSecret,
        gstin: ctx.gstin,
        username: ctx.credentials.username,
        "authtoken": session.authToken,
      },
      body: input
        ? { action: input.action, data: aesEncrypt(session.sek, JSON.stringify(input.payload)) }
        : undefined,
      timeoutMs: this.options.timeoutMs,
      attempts: method === "GET" ? (this.options.attempts ?? 3) : 1,
      telemetry: this.options.telemetry
        ? {
            sink: this.options.telemetry,
            tenantId: ctx.tenantId,
            gateway: "ewb",
            operation,
            gstin: ctx.gstin,
            idempotencyKey: ctx.idempotencyKey,
            loggablePayload: input?.payload,
          }
        : undefined,
    });

    const body = response.json ?? {};
    const status = String(body["status"] ?? body["Status"] ?? "");
    if (status === "1") {
      const encrypted = body["data"] ?? body["Data"];
      const decoded = typeof encrypted === "string" && encrypted
        ? JSON.parse(aesDecrypt(session.sek, encrypted)) as Record<string, unknown>
        : (body);
      return { ok: true, data: decoded, raw: redactRaw(body) };
    }

    const detail = extractErrorDetail(body);
    if (!isRetry && (response.status === 401 || detail.code === "238" || detail.code === "108")) {
      await this.sessions.invalidate("ewb", ctx);
      return this.request(ctx, operation, method, path, input, true);
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

function portalError(detail: PortalErrorDetail) {
  return {
    code: detail.code,
    message: detail.message,
    retryable: !isPermanentPortalError(detail.code),
    errors: detail.errors,
  };
}

/** The duplicate message embeds the existing number, e.g. "… EWB 123456789012". */
function extractExistingEwbNumber(detail: PortalErrorDetail): string | null {
  const match = /\b(\d{12})\b/.exec(detail.message);
  return match?.[1] ?? null;
}

/** EWB dates arrive as "dd/MM/yyyy hh:mm:ss AM" in IST. */
export function parseEwbDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i
    .exec(trimmed);
  if (!match) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  const [, d, mo, y, hh, mi, ss, meridiem] = match;
  let hours = Number(hh ?? 0);
  if (meridiem?.toUpperCase() === "PM" && hours < 12) hours += 12;
  if (meridiem?.toUpperCase() === "AM" && hours === 12) hours = 0;
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), hours, Number(mi ?? 0), Number(ss ?? 0))
    - 330 * 60_000,
  );
}

function redactRaw(body: Record<string, unknown>): Record<string, unknown> {
  const { data: _d, Data: _D, ...rest } = body;
  return rest;
}
