import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database, EwayBill, Einvoice } from "@traxac/database";
import {
  einvoices, ewayBills, ewbEvents, gstins, invoiceCharges, invoiceLines, invoices,
  transporters,
} from "@traxac/database";
import {
  AppError, canCancel, canCancelIrn, canExtend, computeValidity, toNicDate,
} from "@traxac/shared";
import type { GatewayRegistry, GatewayRequestContext } from "@traxac/gst-gateway";
import { actorLabel, requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";
import { payloadFingerprint } from "../infra/crypto.js";
import type { JobQueue } from "../infra/queue.js";
import type { CredentialService } from "./credentials.js";
import { buildEwbPayload, buildIrpPayload, withEwbDetails } from "./payload-builder.js";

export interface ComplianceDeps {
  database: Database;
  registry: GatewayRegistry;
  credentials: CredentialService;
  queue: JobQueue;
  audit: AuditWriter;
  defaultEnvironment: "sandbox" | "production";
}

export interface EwbGenerateOptions {
  distanceKm?: number;
  transporterId?: string | null;
  partB?: {
    transportMode: number;
    vehicleNo?: string;
    vehicleType?: "R" | "O";
    transportDocNo?: string;
    transportDocDate?: Date | null;
  };
}

/**
 * Compliance orchestration: everything that talks to the IRP or the EWB
 * portal, plus the local state machine that mirrors it.
 *
 * Design rules:
 *  - The portal is the source of truth. Local status only ever follows a
 *    portal response; it is never optimistically advanced.
 *  - Every mutating call carries an idempotency key derived from the document,
 *    so a retry is recognisably the same operation.
 *  - Nothing is fabricated. Absent credentials produce CREDENTIALS_MISSING.
 */
export class ComplianceService {
  constructor(private readonly deps: ComplianceDeps) {}

  private get db() {
    return this.deps.database.db;
  }

  /* ------------------------------ Queueing ----------------------------- */

  /** Queue IRN generation. Returns immediately; the worker does the call. */
  async queueEinvoice(ctx: AuthContext, invoiceId: string, withEwayBill = false) {
    requirePermission(ctx, "compliance:generate");
    const invoice = await this.loadInvoice(ctx, invoiceId);
    if (invoice.status === "draft") {
      throw new AppError("INVALID_STATE", "Finalize the invoice before generating the e-Invoice");
    }
    if (invoice.einvoiceStatus === "generated") {
      throw new AppError("CONFLICT", "This invoice already has an IRN");
    }
    await this.db.update(invoices)
      .set({ einvoiceStatus: "queued", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    const { job } = await this.deps.queue.enqueue({
      tenantId: ctx.tenantId,
      kind: "einvoice.generate",
      idempotencyKey: `einvoice.generate:${invoiceId}`,
      payload: { invoiceId, tenantId: ctx.tenantId, withEwayBill, actor: actorLabel(ctx) },
      priority: 10,
    });
    return job;
  }

  async queueEwb(ctx: AuthContext, invoiceId: string, options: EwbGenerateOptions = {}) {
    requirePermission(ctx, "compliance:generate");
    const invoice = await this.loadInvoice(ctx, invoiceId);
    if (invoice.status === "draft") {
      throw new AppError("INVALID_STATE", "Finalize the invoice before generating the e-Way Bill");
    }
    if (invoice.ewbStatus === "generated") {
      throw new AppError("CONFLICT", "This invoice already has an e-Way Bill");
    }
    await this.db.update(invoices)
      .set({ ewbStatus: "queued", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    const { job } = await this.deps.queue.enqueue({
      tenantId: ctx.tenantId,
      kind: "ewb.generate",
      idempotencyKey: `ewb.generate:${invoiceId}`,
      payload: { invoiceId, tenantId: ctx.tenantId, options, actor: actorLabel(ctx) },
      priority: 20,
    });
    return job;
  }

  /* --------------------------- e-Invoice (IRN) ------------------------- */

  /**
   * Generate the IRN. Called by the worker; safe to re-run because the portal
   * returns the existing IRN for a duplicate document, which is recorded as
   * success rather than retried.
   */
  async generateEinvoice(
    ctx: AuthContext,
    invoiceId: string,
    withEwayBill = false,
  ): Promise<Einvoice> {
    const bundle = await this.loadBundle(ctx, invoiceId);
    const { invoice } = bundle;

    const existing = await this.readEinvoice(ctx, invoiceId);
    if (existing?.status === "generated" && existing.irn) return existing;

    const [gstin] = await this.db.select().from(gstins)
      .where(scopedById(ctx, gstins, invoice.gstinId)).limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "Billing GSTIN not found");

    const environment = this.deps.defaultEnvironment;
    const { credential, credentials } = await this.deps.credentials.resolve(ctx, {
      gstin: gstin.gstin, service: "einvoice", environment,
    });

    let payload = buildIrpPayload(bundle);
    if (withEwayBill && invoice.ewbRequired) {
      const transporterName = await this.transporterName(ctx, invoice.transporterId);
      payload = withEwbDetails(payload, {
        transporterId: null,
        transporterName,
        distanceKm: invoice.distanceKm ?? 0,
        transportDocNo: invoice.transportDocNo,
        transportDocDate: invoice.transportDocDate,
        vehicleNo: invoice.vehicleNo,
        vehicleType: invoice.vehicleType,
        transportMode: invoice.transportMode,
      });
    }

    const record = await this.upsertEinvoice(ctx, invoiceId, {
      gstin: gstin.gstin,
      environment,
      status: "processing",
      requestPayload: payload,
    });

    const gatewayCtx = this.gatewayContext(ctx, gstin.gstin, environment, credentials,
      `einvoice:${invoiceId}:${payloadFingerprint(payload).slice(0, 16)}`);

    const result = await this.deps.registry.einvoice(environment).generateIrn(gatewayCtx, payload);
    await this.deps.credentials.markUsed(credential.id);

    if (!result.ok) {
      await this.deps.credentials.markFailed(
        credential.id, result.error.message, result.error.code === "CREDENTIALS_MISSING",
      );
      const [failed] = await this.db.update(einvoices).set({
        status: "failed",
        errorCode: result.error.code,
        lastError: result.error.message,
        attempts: sql`${einvoices.attempts} + 1`,
        responsePayload: (result.raw ?? null) as never,
        updatedAt: new Date(),
      }).where(eq(einvoices.id, record.id)).returning();

      await this.db.update(invoices)
        .set({ einvoiceStatus: "failed", status: "failed", updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
      await this.deps.audit.record(ctx, {
        action: "einvoice.failed",
        entityType: "invoice",
        entityId: invoiceId,
        summary: result.error.message,
        metadata: { code: result.error.code, retryable: result.error.retryable },
      });
      throw new AppError("GATEWAY_ERROR", result.error.message, {
        details: { code: result.error.code, errors: result.error.errors },
        retryable: result.error.retryable,
      });
    }

    const data = result.data;
    const [saved] = await this.db.update(einvoices).set({
      status: "generated",
      irn: data.irn,
      ackNumber: data.ackNumber,
      ackDate: data.ackDate,
      signedInvoice: data.signedInvoice,
      signedQrCode: data.signedQrCode,
      ewbNumber: data.ewbNumber ?? null,
      responsePayload: (result.raw ?? null) as never,
      errorCode: null,
      lastError: null,
      attempts: sql`${einvoices.attempts} + 1`,
      updatedAt: new Date(),
    }).where(eq(einvoices.id, record.id)).returning();

    await this.db.update(invoices).set({
      einvoiceStatus: "generated",
      status: "generated",
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId));
    await this.deps.credentials.markVerified(credential.id);

    // The IRP may have issued the e-Way Bill alongside the IRN.
    if (data.ewbNumber) {
      await this.recordIrpIssuedEwb(ctx, invoice.id, gstin.gstin, environment, data.ewbNumber, data.ewbValidUntil ?? null);
    }

    await this.deps.audit.record(ctx, {
      action: "einvoice.generated",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `IRN ${data.irn.slice(0, 12)}… (Ack ${data.ackNumber})`,
      metadata: { irn: data.irn, ackNumber: data.ackNumber, ewbNumber: data.ewbNumber ?? null },
    });

    await this.deps.queue.enqueue({
      tenantId: ctx.tenantId,
      kind: "invoice.render_pdf",
      idempotencyKey: `invoice.render_pdf:${invoiceId}:irn`,
      payload: { invoiceId, tenantId: ctx.tenantId },
      priority: 50,
    });

    return saved as Einvoice;
  }

  async cancelEinvoice(
    ctx: AuthContext,
    invoiceId: string,
    input: { reasonCode: string; remark: string },
  ): Promise<Einvoice> {
    requirePermission(ctx, "compliance:cancel");
    const record = await this.readEinvoice(ctx, invoiceId);
    if (!record?.irn) throw new AppError("NOT_FOUND", "This invoice has no IRN to cancel");
    if (record.status === "cancelled") return record;
    if (record.ackDate && !canCancelIrn(record.ackDate, new Date())) {
      throw new AppError("INVALID_STATE",
        "The 24-hour IRN cancellation window has closed. Issue a credit note instead.");
    }

    const { credential, credentials } = await this.deps.credentials.resolve(ctx, {
      gstin: record.gstin,
      service: "einvoice",
      environment: record.environment as "sandbox" | "production",
    });
    const gatewayCtx = this.gatewayContext(
      ctx, record.gstin, record.environment as "sandbox" | "production", credentials,
      `einvoice.cancel:${record.irn}`,
    );

    const result = await this.deps.registry
      .einvoice(record.environment as "sandbox" | "production")
      .cancelIrn(gatewayCtx, { irn: record.irn, reasonCode: input.reasonCode, remark: input.remark });
    await this.deps.credentials.markUsed(credential.id);

    if (!result.ok) {
      await this.db.update(einvoices).set({
        errorCode: result.error.code, lastError: result.error.message, updatedAt: new Date(),
      }).where(eq(einvoices.id, record.id));
      throw new AppError("GATEWAY_ERROR", result.error.message, {
        details: { code: result.error.code }, retryable: result.error.retryable,
      });
    }

    const [saved] = await this.db.update(einvoices).set({
      status: "cancelled",
      cancelledAt: result.data.cancelDate,
      cancelReasonCode: input.reasonCode,
      cancelRemark: input.remark,
      cancelResponse: (result.raw ?? null) as never,
      updatedAt: new Date(),
    }).where(eq(einvoices.id, record.id)).returning();

    await this.db.update(invoices).set({
      einvoiceStatus: "cancelled", updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId));

    await this.deps.audit.record(ctx, {
      action: "einvoice.cancelled",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `${input.reasonCode}: ${input.remark}`,
      metadata: { irn: record.irn },
    });
    return saved as Einvoice;
  }

  /* ---------------------------- e-Way Bill ----------------------------- */

  async generateEwb(
    ctx: AuthContext,
    invoiceId: string,
    options: EwbGenerateOptions = {},
  ): Promise<EwayBill> {
    const bundle = await this.loadBundle(ctx, invoiceId);
    const { invoice } = bundle;

    const existing = await this.readEwb(ctx, invoiceId);
    if (existing?.status === "generated" && existing.ewbNumber) return existing;

    const distanceKm = options.distanceKm ?? invoice.distanceKm ?? 0;
    const [gstin] = await this.db.select().from(gstins)
      .where(scopedById(ctx, gstins, invoice.gstinId)).limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "Billing GSTIN not found");

    // Part-B is optional at generation, but without it the bill is incomplete
    // and the goods cannot legally move.
    const hasPartB = Boolean(options.partB?.vehicleNo || invoice.vehicleNo
      || options.partB?.transportDocNo || invoice.transportDocNo);

    if (options.partB) {
      await this.db.update(invoices).set({
        transportMode: options.partB.transportMode,
        vehicleNo: options.partB.vehicleNo ?? invoice.vehicleNo,
        vehicleType: options.partB.vehicleType ?? invoice.vehicleType,
        transportDocNo: options.partB.transportDocNo ?? invoice.transportDocNo,
        transportDocDate: options.partB.transportDocDate ?? invoice.transportDocDate,
        distanceKm,
        updatedAt: new Date(),
      }).where(eq(invoices.id, invoiceId));
      Object.assign(invoice, {
        transportMode: options.partB.transportMode,
        vehicleNo: options.partB.vehicleNo ?? invoice.vehicleNo,
        vehicleType: options.partB.vehicleType ?? invoice.vehicleType,
        transportDocNo: options.partB.transportDocNo ?? invoice.transportDocNo,
        transportDocDate: options.partB.transportDocDate ?? invoice.transportDocDate,
        distanceKm,
      });
    }

    const transporterRow = options.transporterId ?? invoice.transporterId
      ? (await this.db.select().from(transporters)
          .where(scopedById(ctx, transporters, (options.transporterId ?? invoice.transporterId) as string))
          .limit(1))[0]
      : undefined;

    const environment = this.deps.defaultEnvironment;
    const { credential, credentials } = await this.deps.credentials.resolve(ctx, {
      gstin: gstin.gstin, service: "ewb", environment,
    });

    const payload = buildEwbPayload({
      ...bundle,
      transporterId: transporterRow?.transporterId ?? null,
      transporterName: transporterRow?.name ?? null,
      distanceKm,
    });

    const record = await this.upsertEwb(ctx, invoiceId, {
      gstin: gstin.gstin,
      environment,
      status: "processing",
      distanceKm,
      requestPayload: payload,
      transporterId: transporterRow?.transporterId ?? null,
      transporterName: transporterRow?.name ?? null,
    });

    const gatewayCtx = this.gatewayContext(ctx, gstin.gstin, environment, credentials,
      `ewb:${invoiceId}:${payloadFingerprint(payload).slice(0, 16)}`);

    const result = await this.deps.registry.ewb(environment).generate(gatewayCtx, payload);
    await this.deps.credentials.markUsed(credential.id);

    if (!result.ok) {
      await this.deps.credentials.markFailed(
        credential.id, result.error.message, result.error.code === "CREDENTIALS_MISSING",
      );
      await this.db.update(ewayBills).set({
        status: "failed",
        errorCode: result.error.code,
        lastError: result.error.message,
        attempts: sql`${ewayBills.attempts} + 1`,
        responsePayload: (result.raw ?? null) as never,
        updatedAt: new Date(),
      }).where(eq(ewayBills.id, record.id));
      await this.db.update(invoices)
        .set({ ewbStatus: "failed", updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
      await this.recordEwbEvent(ctx, record.id, "failed", payload, result.raw, result.error.message);
      throw new AppError("GATEWAY_ERROR", result.error.message, {
        details: { code: result.error.code, errors: result.error.errors },
        retryable: result.error.retryable,
      });
    }

    const data = result.data;
    const [saved] = await this.db.update(ewayBills).set({
      ewbNumber: data.ewbNumber,
      status: hasPartB ? "generated" : "part_b_pending",
      generatedAt: data.generatedAt,
      validFrom: data.generatedAt,
      validUntil: data.validUntil,
      responsePayload: (result.raw ?? null) as never,
      errorCode: null,
      lastError: null,
      attempts: sql`${ewayBills.attempts} + 1`,
      transactionType: invoice.ewbTransactionType,
      subSupplyType: invoice.subSupplyType,
      transportMode: invoice.transportMode,
      vehicleNo: invoice.vehicleNo,
      vehicleType: invoice.vehicleType,
      transportDocNo: invoice.transportDocNo,
      transportDocDate: invoice.transportDocDate,
      updatedAt: new Date(),
    }).where(eq(ewayBills.id, record.id)).returning();

    await this.db.update(invoices).set({
      ewbStatus: hasPartB ? "generated" : "part_b_pending",
      status: "generated",
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId));

    await this.recordEwbEvent(ctx, record.id, "generated", payload, result.raw);
    await this.deps.audit.record(ctx, {
      action: "ewb.generated",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `e-Way Bill ${data.ewbNumber}, valid to ${toNicDate(data.validUntil)}`,
      metadata: { ewbNumber: data.ewbNumber, validUntil: data.validUntil.toISOString(), distanceKm },
    });

    return saved as EwayBill;
  }

  async updatePartB(ctx: AuthContext, invoiceId: string, input: {
    transportMode: number;
    vehicleNo?: string;
    vehicleType?: "R" | "O";
    transportDocNo?: string;
    transportDocDate?: Date | null;
    fromPlace: string;
    fromStateCode: string;
    reasonCode: string;
    reasonRemark: string;
  }): Promise<EwayBill> {
    requirePermission(ctx, "compliance:generate");
    const record = await this.requireLiveEwb(ctx, invoiceId);
    const { credential, credentials } = await this.deps.credentials.resolve(ctx, {
      gstin: record.gstin, service: "ewb",
      environment: record.environment as "sandbox" | "production",
    });

    const payload = {
      ewbNo: Number(record.ewbNumber),
      vehicleNo: input.vehicleNo,
      fromPlace: input.fromPlace,
      fromState: Number(input.fromStateCode),
      reasonCode: input.reasonCode,
      reasonRem: input.reasonRemark,
      transDocNo: input.transportDocNo,
      transDocDate: input.transportDocDate ? toNicDate(input.transportDocDate) : undefined,
      transMode: String(input.transportMode),
      vehicleType: input.vehicleType ?? "R",
    };

    const result = await this.deps.registry
      .ewb(record.environment as "sandbox" | "production")
      .updatePartB(this.gatewayContext(
        ctx, record.gstin, record.environment as "sandbox" | "production", credentials,
        `ewb.partb:${record.ewbNumber}:${payloadFingerprint(payload).slice(0, 12)}`,
      ), payload);
    await this.deps.credentials.markUsed(credential.id);

    if (!result.ok) {
      await this.recordEwbEvent(ctx, record.id, "failed", payload, result.raw, result.error.message);
      throw new AppError("GATEWAY_ERROR", result.error.message, {
        details: { code: result.error.code }, retryable: result.error.retryable,
      });
    }

    const [saved] = await this.db.update(ewayBills).set({
      status: "generated",
      validUntil: result.data.validUntil,
      vehicleNo: input.vehicleNo ?? record.vehicleNo,
      vehicleType: input.vehicleType ?? record.vehicleType,
      transportMode: input.transportMode,
      transportDocNo: input.transportDocNo ?? record.transportDocNo,
      transportDocDate: input.transportDocDate ?? record.transportDocDate,
      updatedAt: new Date(),
    }).where(eq(ewayBills.id, record.id)).returning();

    await this.db.update(invoices).set({ ewbStatus: "generated", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await this.recordEwbEvent(ctx, record.id, "part_b_updated", payload, result.raw);
    await this.deps.audit.record(ctx, {
      action: "ewb.part_b_updated", entityType: "invoice", entityId: invoiceId,
      summary: `Vehicle ${input.vehicleNo ?? "—"}`,
    });
    return saved as EwayBill;
  }

  async updateEwbTransporter(
    ctx: AuthContext,
    invoiceId: string,
    transporterGstin: string,
  ): Promise<EwayBill> {
    requirePermission(ctx, "compliance:generate");
    const record = await this.requireLiveEwb(ctx, invoiceId);
    const { credentials } = await this.deps.credentials.resolve(ctx, {
      gstin: record.gstin, service: "ewb",
      environment: record.environment as "sandbox" | "production",
    });
    const payload = { ewbNo: Number(record.ewbNumber), transporterId: transporterGstin };

    const result = await this.deps.registry
      .ewb(record.environment as "sandbox" | "production")
      .updateTransporter(this.gatewayContext(
        ctx, record.gstin, record.environment as "sandbox" | "production", credentials,
        `ewb.transporter:${record.ewbNumber}:${transporterGstin}`,
      ), payload);

    if (!result.ok) {
      await this.recordEwbEvent(ctx, record.id, "failed", payload, result.raw, result.error.message);
      throw new AppError("GATEWAY_ERROR", result.error.message, {
        details: { code: result.error.code }, retryable: result.error.retryable,
      });
    }

    const [saved] = await this.db.update(ewayBills)
      .set({ transporterId: transporterGstin, updatedAt: new Date() })
      .where(eq(ewayBills.id, record.id)).returning();
    await this.recordEwbEvent(ctx, record.id, "transporter_updated", payload, result.raw);
    await this.deps.audit.record(ctx, {
      action: "ewb.transporter_updated", entityType: "invoice", entityId: invoiceId,
      summary: transporterGstin,
    });
    return saved as EwayBill;
  }

  async extendEwb(ctx: AuthContext, invoiceId: string, input: {
    remainingDistanceKm: number;
    reasonCode: string;
    reasonRemark: string;
    currentPlace: string;
    currentStateCode: string;
    currentPincode: string;
    transitType: string;
    partB?: {
      transportMode: number;
      vehicleNo?: string;
      transportDocNo?: string;
      transportDocDate?: Date | null;
    };
  }): Promise<EwayBill> {
    requirePermission(ctx, "compliance:generate");
    const record = await this.requireLiveEwb(ctx, invoiceId);
    if (!record.validUntil || !canExtend(record.validUntil, new Date())) {
      throw new AppError("INVALID_STATE",
        "Extension is only allowed from 8 hours before to 8 hours after expiry");
    }

    const { credentials } = await this.deps.credentials.resolve(ctx, {
      gstin: record.gstin, service: "ewb",
      environment: record.environment as "sandbox" | "production",
    });

    const payload = {
      ewbNo: Number(record.ewbNumber),
      vehicleNo: input.partB?.vehicleNo ?? record.vehicleNo ?? undefined,
      fromPlace: input.currentPlace,
      fromState: Number(input.currentStateCode),
      remainingDistance: String(input.remainingDistanceKm),
      transDocNo: input.partB?.transportDocNo ?? record.transportDocNo ?? undefined,
      transDocDate: input.partB?.transportDocDate
        ? toNicDate(input.partB.transportDocDate)
        : undefined,
      transMode: String(input.partB?.transportMode ?? record.transportMode ?? 1),
      extnRsnCode: input.reasonCode,
      extnRemarks: input.reasonRemark,
      consignmentStatus: input.transitType === "1" ? "T" : "M",
      transitType: input.transitType,
      addressLine1: input.currentPlace,
      addressLine3: input.currentPincode,
    };

    const result = await this.deps.registry
      .ewb(record.environment as "sandbox" | "production")
      .extend(this.gatewayContext(
        ctx, record.gstin, record.environment as "sandbox" | "production", credentials,
        `ewb.extend:${record.ewbNumber}:${record.extensionCount + 1}`,
      ), payload);

    if (!result.ok) {
      await this.recordEwbEvent(ctx, record.id, "failed", payload, result.raw, result.error.message);
      throw new AppError("GATEWAY_ERROR", result.error.message, {
        details: { code: result.error.code }, retryable: result.error.retryable,
      });
    }

    const [saved] = await this.db.update(ewayBills).set({
      validUntil: result.data.validUntil,
      status: "generated",
      extensionCount: record.extensionCount + 1,
      distanceKm: input.remainingDistanceKm,
      updatedAt: new Date(),
    }).where(eq(ewayBills.id, record.id)).returning();

    await this.db.update(invoices).set({ ewbStatus: "generated", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await this.recordEwbEvent(ctx, record.id, "extended", payload, result.raw);
    await this.deps.audit.record(ctx, {
      action: "ewb.extended",
      entityType: "invoice",
      entityId: invoiceId,
      summary: `Extended to ${toNicDate(result.data.validUntil)}`,
      metadata: { reasonCode: input.reasonCode, remainingDistanceKm: input.remainingDistanceKm },
    });
    return saved as EwayBill;
  }

  async cancelEwb(ctx: AuthContext, invoiceId: string, input: {
    reasonCode: string; remark: string;
  }): Promise<EwayBill> {
    requirePermission(ctx, "compliance:cancel");
    const record = await this.requireLiveEwb(ctx, invoiceId);
    if (record.generatedAt && !canCancel(record.generatedAt, new Date())) {
      throw new AppError("INVALID_STATE",
        "An e-Way Bill can only be cancelled within 24 hours of generation");
    }

    const { credentials } = await this.deps.credentials.resolve(ctx, {
      gstin: record.gstin, service: "ewb",
      environment: record.environment as "sandbox" | "production",
    });
    const payload = {
      ewbNo: Number(record.ewbNumber),
      cancelRsnCode: Number(input.reasonCode),
      cancelRmrk: input.remark,
    };

    const result = await this.deps.registry
      .ewb(record.environment as "sandbox" | "production")
      .cancel(this.gatewayContext(
        ctx, record.gstin, record.environment as "sandbox" | "production", credentials,
        `ewb.cancel:${record.ewbNumber}`,
      ), payload);

    if (!result.ok) {
      await this.recordEwbEvent(ctx, record.id, "failed", payload, result.raw, result.error.message);
      throw new AppError("GATEWAY_ERROR", result.error.message, {
        details: { code: result.error.code }, retryable: result.error.retryable,
      });
    }

    const [saved] = await this.db.update(ewayBills).set({
      status: "cancelled",
      cancelledAt: result.data.cancelledAt,
      cancelReasonCode: input.reasonCode,
      cancelRemark: input.remark,
      updatedAt: new Date(),
    }).where(eq(ewayBills.id, record.id)).returning();

    await this.db.update(invoices).set({ ewbStatus: "cancelled", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await this.recordEwbEvent(ctx, record.id, "cancelled", payload, result.raw);
    await this.deps.audit.record(ctx, {
      action: "ewb.cancelled", entityType: "invoice", entityId: invoiceId,
      summary: `${input.reasonCode}: ${input.remark}`,
    });
    return saved as EwayBill;
  }

  /** Mark bills whose validity has lapsed. Run by the maintenance job. */
  async expireLapsedEwbs(): Promise<number> {
    const rows = await this.db.update(ewayBills)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(
        eq(ewayBills.status, "generated"),
        lt(ewayBills.validUntil, new Date()),
        isNull(ewayBills.cancelledAt),
      ))
      .returning({ id: ewayBills.id, invoiceId: ewayBills.invoiceId });
    for (const row of rows) {
      await this.db.update(invoices).set({ ewbStatus: "expired", updatedAt: new Date() })
        .where(eq(invoices.id, row.invoiceId));
    }
    return rows.length;
  }

  /** Bills expiring inside the window, for the alerts feed. */
  async ewbsExpiringWithin(hours: number) {
    const cutoff = new Date(Date.now() + hours * 3_600_000);
    return this.db
      .select({
        ewayBill: ewayBills,
        invoiceNumber: invoices.invoiceNumber,
        tenantId: ewayBills.tenantId,
      })
      .from(ewayBills)
      .innerJoin(invoices, eq(invoices.id, ewayBills.invoiceId))
      .where(and(
        eq(ewayBills.status, "generated"),
        lt(ewayBills.validUntil, cutoff),
        isNull(ewayBills.cancelledAt),
      ));
  }

  /* --------------------------- Internal helpers ------------------------ */

  private gatewayContext(
    ctx: AuthContext,
    gstin: string,
    environment: "sandbox" | "production",
    credentials: GatewayRequestContext["credentials"],
    idempotencyKey: string,
  ): GatewayRequestContext {
    return {
      tenantId: ctx.tenantId,
      gstin,
      environment,
      credentials,
      idempotencyKey,
      requestId: ctx.requestId,
    };
  }

  private async loadInvoice(ctx: AuthContext, invoiceId: string) {
    const [invoice] = await this.db.select().from(invoices)
      .where(scopedById(ctx, invoices, invoiceId)).limit(1);
    if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found");
    return invoice;
  }

  private async loadBundle(ctx: AuthContext, invoiceId: string) {
    const invoice = await this.loadInvoice(ctx, invoiceId);
    const [lines, charges] = await Promise.all([
      this.db.select().from(invoiceLines)
        .where(scoped(ctx, invoiceLines, eq(invoiceLines.invoiceId, invoiceId)))
        .orderBy(invoiceLines.position),
      this.db.select().from(invoiceCharges)
        .where(scoped(ctx, invoiceCharges, eq(invoiceCharges.invoiceId, invoiceId)))
        .orderBy(invoiceCharges.position),
    ]);
    if (lines.length === 0) {
      throw new AppError("VALIDATION_FAILED", "The invoice has no items");
    }
    return { invoice, lines, charges };
  }

  async readEinvoice(ctx: AuthContext, invoiceId: string): Promise<Einvoice | null> {
    const [row] = await this.db.select().from(einvoices)
      .where(scoped(ctx, einvoices, eq(einvoices.invoiceId, invoiceId))).limit(1);
    return row ?? null;
  }

  async readEwb(ctx: AuthContext, invoiceId: string): Promise<EwayBill | null> {
    const [row] = await this.db.select().from(ewayBills)
      .where(scoped(ctx, ewayBills, eq(ewayBills.invoiceId, invoiceId)))
      .orderBy(desc(ewayBills.createdAt)).limit(1);
    return row ?? null;
  }

  async readEwbEvents(ctx: AuthContext, ewayBillId: string) {
    return this.db.select().from(ewbEvents)
      .where(scoped(ctx, ewbEvents, eq(ewbEvents.ewayBillId, ewayBillId)))
      .orderBy(desc(ewbEvents.occurredAt));
  }

  private async requireLiveEwb(ctx: AuthContext, invoiceId: string): Promise<EwayBill> {
    const record = await this.readEwb(ctx, invoiceId);
    if (!record?.ewbNumber) throw new AppError("NOT_FOUND", "This invoice has no e-Way Bill");
    if (record.status === "cancelled") {
      throw new AppError("INVALID_STATE", "This e-Way Bill is already cancelled");
    }
    return record;
  }

  private async upsertEinvoice(ctx: AuthContext, invoiceId: string, values: {
    gstin: string;
    environment: string;
    status: string;
    requestPayload: unknown;
  }): Promise<Einvoice> {
    const [row] = await this.db.insert(einvoices).values({
      tenantId: ctx.tenantId,
      invoiceId,
      gstin: values.gstin,
      environment: values.environment,
      status: values.status,
      requestPayload: values.requestPayload as never,
    }).onConflictDoUpdate({
      target: einvoices.invoiceId,
      set: {
        status: values.status,
        requestPayload: values.requestPayload as never,
        gstin: values.gstin,
        environment: values.environment,
        updatedAt: new Date(),
      },
    }).returning();
    return row as Einvoice;
  }

  private async upsertEwb(ctx: AuthContext, invoiceId: string, values: {
    gstin: string;
    environment: string;
    status: string;
    distanceKm: number;
    requestPayload: unknown;
    transporterId: string | null;
    transporterName: string | null;
  }): Promise<EwayBill> {
    const existing = await this.readEwb(ctx, invoiceId);
    if (existing && existing.status !== "cancelled") {
      const [row] = await this.db.update(ewayBills).set({
        status: values.status,
        distanceKm: values.distanceKm,
        requestPayload: values.requestPayload as never,
        transporterId: values.transporterId,
        transporterName: values.transporterName,
        updatedAt: new Date(),
      }).where(eq(ewayBills.id, existing.id)).returning();
      return row as EwayBill;
    }
    const [row] = await this.db.insert(ewayBills).values({
      tenantId: ctx.tenantId,
      invoiceId,
      gstin: values.gstin,
      environment: values.environment,
      status: values.status,
      distanceKm: values.distanceKm,
      requestPayload: values.requestPayload as never,
      transporterId: values.transporterId,
      transporterName: values.transporterName,
    }).returning();
    return row as EwayBill;
  }

  /** Record an EWB the IRP generated alongside the IRN. */
  private async recordIrpIssuedEwb(
    ctx: AuthContext,
    invoiceId: string,
    gstin: string,
    environment: string,
    ewbNumber: string,
    validUntil: Date | null,
  ): Promise<void> {
    const now = new Date();
    const derived = validUntil
      ?? computeValidity({ distanceKm: 0, generatedAt: now }).validUntil;
    const record = await this.upsertEwb(ctx, invoiceId, {
      gstin, environment, status: "generated", distanceKm: 0,
      requestPayload: { source: "irp" }, transporterId: null, transporterName: null,
    });
    await this.db.update(ewayBills).set({
      ewbNumber, status: "generated", generatedAt: now, validFrom: now, validUntil: derived,
      updatedAt: now,
    }).where(eq(ewayBills.id, record.id));
    await this.db.update(invoices).set({ ewbStatus: "generated", updatedAt: now })
      .where(eq(invoices.id, invoiceId));
    await this.recordEwbEvent(ctx, record.id, "generated", { source: "irp" }, { ewbNumber });
  }

  private async recordEwbEvent(
    ctx: AuthContext,
    ewayBillId: string,
    eventType: string,
    requestPayload: unknown,
    responsePayload: unknown,
    note?: string,
  ): Promise<void> {
    await this.db.insert(ewbEvents).values({
      tenantId: ctx.tenantId,
      ewayBillId,
      eventType,
      requestPayload: (requestPayload ?? null) as never,
      responsePayload: (responsePayload ?? null) as never,
      note: note ?? null,
      actorUserId: ctx.actor === "system" ? null : ctx.userId,
      actorLabel: actorLabel(ctx),
    }).catch(() => undefined);
  }

  private async transporterName(ctx: AuthContext, transporterId: string | null): Promise<string | null> {
    if (!transporterId) return null;
    const [row] = await this.db.select({ name: transporters.name }).from(transporters)
      .where(scopedById(ctx, transporters, transporterId)).limit(1);
    return row?.name ?? null;
  }
}
