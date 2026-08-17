import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  cancelEinvoiceSchema,
  cancelEwbSchema,
  extendEwbSchema,
  generateEinvoiceSchema,
  generateEwbSchema,
  partBSchema,
  saveCredentialSchema,
  updateEwbTransporterSchema,
} from "@traxac/shared/contracts";
import { AppError, computeValidity, canExtend, canCancel } from "@traxac/shared";
import { requireAuth } from "../context.js";

const idParam = z.object({ id: z.string().uuid() });

/**
 * Compliance endpoints.
 *
 * Generation is queued so the UI stays responsive when the portal is slow;
 * lifecycle actions (cancel, extend, Part-B) run inline because the user is
 * waiting on a yes/no answer and the window for them is time-bound.
 */
export async function complianceRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ e-Invoice ---------------------------- */

  app.post("/invoices/:id/einvoice", async (request, reply) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = generateEinvoiceSchema.parse(request.body ?? {});
    const job = await request.container.compliance.queueEinvoice(ctx, id, input.withEwayBill);
    return reply.status(202).send({ jobId: job.id, status: job.status });
  });

  app.get("/invoices/:id/einvoice", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const record = await request.container.compliance.readEinvoice(ctx, id);
    if (!record) throw new AppError("NOT_FOUND", "No e-Invoice record for this invoice");
    // The request/response payloads are large; the detail view fetches them
    // separately when the user opens the technical panel.
    const { requestPayload: _q, responsePayload: _r, ...summary } = record;
    return summary;
  });

  /** Raw portal exchange, for support and dispute resolution. */
  app.get("/invoices/:id/einvoice/payload", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const record = await request.container.compliance.readEinvoice(ctx, id);
    if (!record) throw new AppError("NOT_FOUND", "No e-Invoice record for this invoice");
    return { request: record.requestPayload, response: record.responsePayload };
  });

  app.post("/invoices/:id/einvoice/cancel", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = cancelEinvoiceSchema.parse(request.body);
    return request.container.compliance.cancelEinvoice(ctx, id, input);
  });

  /* ----------------------------- e-Way Bill ---------------------------- */

  app.post("/invoices/:id/ewb", async (request, reply) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = generateEwbSchema.parse(request.body ?? {});
    const job = await request.container.compliance.queueEwb(ctx, id, {
      distanceKm: input.distanceKm,
      transporterId: input.transporterId,
      partB: input.partB
        ? {
            transportMode: input.partB.transportMode,
            vehicleNo: input.partB.vehicleNo || undefined,
            vehicleType: input.partB.vehicleType,
            transportDocNo: input.partB.transportDocNo || undefined,
            transportDocDate: input.partB.transportDocDate,
          }
        : undefined,
    });
    return reply.status(202).send({ jobId: job.id, status: job.status });
  });

  app.get("/invoices/:id/ewb", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const record = await request.container.compliance.readEwb(ctx, id);
    if (!record) throw new AppError("NOT_FOUND", "No e-Way Bill for this invoice");
    const events = await request.container.compliance.readEwbEvents(ctx, record.id);
    const { requestPayload: _q, responsePayload: _r, ...summary } = record;
    const now = new Date();
    return {
      ...summary,
      events,
      // What the user is actually allowed to do right now.
      actions: {
        canExtend:
          Boolean(record.validUntil) &&
          record.status === "generated" &&
          canExtend(record.validUntil as Date, now),
        canCancel:
          Boolean(record.generatedAt) &&
          record.status !== "cancelled" &&
          canCancel(record.generatedAt as Date, now),
        canUpdatePartB: record.status === "generated" || record.status === "part_b_pending",
      },
    };
  });

  app.post("/invoices/:id/ewb/part-b", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = partBSchema.parse(request.body);
    if (!input.fromPlace || !input.fromStateCode) {
      throw new AppError(
        "VALIDATION_FAILED",
        "The place and state the vehicle starts from are required for Part-B",
      );
    }
    return request.container.compliance.updatePartB(ctx, id, {
      transportMode: input.transportMode,
      vehicleNo: input.vehicleNo || undefined,
      vehicleType: input.vehicleType,
      transportDocNo: input.transportDocNo || undefined,
      transportDocDate: input.transportDocDate,
      fromPlace: input.fromPlace,
      fromStateCode: input.fromStateCode,
      reasonCode: input.reasonCode || "1",
      reasonRemark: input.reasonRemark || "Vehicle details updated",
    });
  });

  app.post("/invoices/:id/ewb/transporter", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = updateEwbTransporterSchema.parse(request.body);
    return request.container.compliance.updateEwbTransporter(ctx, id, input.transporterGstin);
  });

  app.post("/invoices/:id/ewb/extend", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = extendEwbSchema.parse(request.body);
    return request.container.compliance.extendEwb(ctx, id, {
      remainingDistanceKm: input.remainingDistanceKm,
      reasonCode: input.reasonCode,
      reasonRemark: input.reasonRemark,
      currentPlace: input.currentPlace,
      currentStateCode: input.currentStateCode,
      currentPincode: input.currentPincode,
      transitType: input.transitType,
      partB: input.partB
        ? {
            transportMode: input.partB.transportMode,
            vehicleNo: input.partB.vehicleNo || undefined,
            transportDocNo: input.partB.transportDocNo || undefined,
            transportDocDate: input.partB.transportDocDate,
          }
        : undefined,
    });
  });

  app.post("/invoices/:id/ewb/cancel", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = cancelEwbSchema.parse(request.body);
    return request.container.compliance.cancelEwb(ctx, id, input);
  });

  /** Preview validity before generating, so the user knows the deadline. */
  app.get("/ewb/validity-preview", async (request) => {
    const query = z
      .object({
        distanceKm: z.coerce.number().int().min(0).max(4000),
        vehicleType: z.enum(["R", "O"]).default("R"),
      })
      .parse(request.query);
    const { days, validUntil } = computeValidity({
      distanceKm: query.distanceKm,
      generatedAt: new Date(),
      vehicleType: query.vehicleType,
    });
    return { days, validUntil };
  });

  /* ----------------------------- Credentials --------------------------- */

  app.get("/credentials", async (request) => {
    const ctx = requireAuth(request);
    return { items: await request.container.credentials.list(ctx) };
  });

  app.post("/credentials", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = saveCredentialSchema.parse(request.body);
    const saved = await request.container.credentials.save(ctx, {
      gstinId: input.gstinId,
      provider: input.provider,
      environment: input.environment,
      service: input.service,
      username: input.username,
      password: input.password,
      clientId: input.clientId || undefined,
      clientSecret: input.clientSecret || undefined,
      baseUrl: input.baseUrl || undefined,
    });
    return reply.status(201).send(saved);
  });

  app.delete("/credentials/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.credentials.remove(ctx, id);
    return { ok: true };
  });

  /**
   * Verify credentials by authenticating against the portal. This is the only
   * honest way to answer "are these right?" — there is no offline check.
   */
  app.post("/credentials/:id/test", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const { credentials, registry, config } = request.container;

    const all = await credentials.list(ctx);
    const summary = all.find((c) => c.id === id);
    if (!summary) throw new AppError("NOT_FOUND", "Credentials not found");

    const resolved = await credentials.resolve(ctx, {
      gstin: summary.gstin,
      service: summary.service as "einvoice" | "ewb",
      environment: summary.environment as "sandbox" | "production",
    });

    const provider =
      summary.service === "einvoice"
        ? registry.einvoice(summary.environment as "sandbox" | "production")
        : registry.ewb(summary.environment as "sandbox" | "production");

    const result = await provider.verify({
      tenantId: ctx.tenantId,
      gstin: summary.gstin,
      environment: summary.environment as "sandbox" | "production",
      credentials: resolved.credentials,
      idempotencyKey: `verify:${id}:${Date.now()}`,
      requestId: ctx.requestId,
    });

    if (!result.ok) {
      await credentials.markFailed(id, result.error.message, true);
      return {
        ok: false,
        environment: summary.environment,
        gateway: config.GST_ENVIRONMENT,
        error: { code: result.error.code, message: result.error.message },
      };
    }
    await credentials.markVerified(id);
    return { ok: true, verifiedAt: result.data.verifiedAt, environment: summary.environment };
  });
}
