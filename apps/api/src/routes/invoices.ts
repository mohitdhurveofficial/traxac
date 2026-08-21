import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  cancelInvoiceSchema,
  createInvoiceSchema,
  finalizeInvoiceSchema,
  invoiceListQuerySchema,
  previewInvoiceSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
} from "@ewayvo/shared/contracts";
import { AppError, financialYear } from "@ewayvo/shared";
import { readTimeline } from "@ewayvo/core";
import { requireAuth } from "../context.js";

const idParam = z.object({ id: z.string().uuid() });

/**
 * Invoice endpoints.
 *
 * The finalize call is the interesting one: it allocates the document number
 * and then, if asked, queues the IRN and e-Way Bill work. Queuing rather than
 * calling inline means a slow portal never blocks the person at the counter.
 */
export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request) => {
    const ctx = requireAuth(request);
    const query = invoiceListQuerySchema.parse(request.query);
    return request.container.invoices.list(ctx, query);
  });

  app.get("/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const detail = await request.container.invoices.get(ctx, id);
    const documents = await request.container.documents.listFor(ctx, "invoice", id);
    return { ...detail, documents };
  });

  /** Full history: who did what, when, and what the portal answered. */
  app.get("/:id/timeline", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const { database, compliance } = request.container;
    const entries = await readTimeline(database, ctx, "invoice", id);
    const ewb = await compliance.readEwb(ctx, id);
    const ewbHistory = ewb ? await compliance.readEwbEvents(ctx, ewb.id) : [];
    return { entries, ewbHistory };
  });

  /** Live tax preview — nothing is written. */
  app.post("/preview", async (request) => {
    const ctx = requireAuth(request);
    const input = previewInvoiceSchema.parse(request.body);
    return request.container.invoices.preview(ctx, input);
  });

  /** The number the next invoice in this series will receive. */
  app.get("/next-number", async (request) => {
    const ctx = requireAuth(request);
    const query = z
      .object({
        gstinId: z.string().uuid(),
        docType: z.string().default("invoice"),
        series: z.string().optional(),
        invoiceDate: z.coerce.date().default(() => new Date()),
      })
      .parse(request.query);
    const invoiceNumber = await request.container.numbering.peek(ctx, {
      gstinId: query.gstinId,
      docType: query.docType as never,
      series: query.series,
      invoiceDate: query.invoiceDate,
    });
    return { invoiceNumber, financialYear: financialYear(query.invoiceDate) };
  });

  app.post("/", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = createInvoiceSchema.parse(request.body);
    const created = await request.container.invoices.createDraft(ctx, input);
    await rememberTransport(request, ctx, input);
    return reply.status(201).send(created);
  });

  app.put("/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = updateInvoiceSchema.parse(request.body);
    const updated = await request.container.invoices.updateDraft(ctx, id, input);
    await rememberTransport(request, ctx, input);
    return updated;
  });

  app.post("/:id/finalize", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const options = finalizeInvoiceSchema.parse(request.body ?? {});
    const { invoices, compliance, queue, credentials } = request.container;

    const invoice = await invoices.finalize(ctx, id);

    // Every issued invoice gets a PDF, connected to the portal or not. It was
    // previously only rendered after an IRN came back, which left a business
    // without GST credentials unable to print anything it had billed.
    await queue.enqueue({
      tenantId: ctx.tenantId,
      kind: "invoice.render_pdf",
      idempotencyKey: `invoice.render_pdf:${id}:issued`,
      payload: { invoiceId: id, tenantId: ctx.tenantId },
      priority: 30,
    });

    // Portal work is only queued when there is a login to make it with.
    // Otherwise the invoice stays "pending", which is what the compliance
    // panel already reports as "GST portal not connected" — far better than a
    // job that fails on every retry and leaves a red mark on the account.
    const gstin = invoice.billFrom.gstin ?? "";
    const environment = request.container.config.GST_ENVIRONMENT;
    const [einvoiceReady, ewbReady] = await Promise.all([
      credentials.exists(ctx, { gstin, service: "einvoice", environment }),
      credentials.exists(ctx, { gstin, service: "ewb", environment }),
    ]);
    const connected = { einvoice: einvoiceReady, ewb: ewbReady };

    const queued: string[] = [];
    if (options.generateEinvoice !== false && invoice.einvoiceStatus === "pending") {
      if (connected.einvoice) {
        await compliance.queueEinvoice(ctx, id, options.generateEwb === true);
        queued.push("einvoice");
      }
    }
    // Only queue the EWB separately when the IRP is not issuing it for us.
    if (options.generateEwb && invoice.ewbRequired && !queued.includes("einvoice")) {
      if (connected.ewb) {
        await compliance.queueEwb(ctx, id);
        queued.push("ewb");
      }
    }
    return { invoice, queued, portalConnected: connected };
  });

  app.post("/:id/cancel", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = cancelInvoiceSchema.parse(request.body);
    return request.container.invoices.cancel(ctx, id, `${input.reasonCode}: ${input.remark}`);
  });

  app.post("/:id/duplicate", async (request, reply) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return reply.status(201).send(await request.container.invoices.duplicate(ctx, id));
  });

  app.post("/:id/payments", async (request, reply) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = recordPaymentSchema.parse(request.body);
    return reply.status(201).send(await request.container.invoices.recordPayment(ctx, id, input));
  });

  /** Queue a PDF re-render (e.g. after the logo changes). */
  app.post("/:id/pdf", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.invoices.get(ctx, id);
    const { job } = await request.container.queue.enqueue({
      tenantId: ctx.tenantId,
      kind: "invoice.render_pdf",
      idempotencyKey: `invoice.render_pdf:${id}:${Date.now()}`,
      payload: { invoiceId: id, tenantId: ctx.tenantId },
      priority: 40,
    });
    return { jobId: job.id, status: job.status };
  });

  app.get("/:id/pdf", async (request, reply) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const document = await request.container.documents.findByKind(
      ctx,
      "invoice_pdf",
      "invoice",
      id,
    );
    if (!document) {
      throw new AppError("NOT_FOUND", "The PDF is still being prepared. Try again in a moment.");
    }
    const { body } = await request.container.documents.download(ctx, document.id);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="${document.filename}"`)
      .send(body);
  });
}

/**
 * Quietly remember the vehicle used on an invoice so it autocompletes next
 * time. A failure here must never fail the invoice.
 */
async function rememberTransport(
  request: FastifyRequest,
  ctx: ReturnType<typeof requireAuth>,
  input: {
    transport?: { vehicleNo?: string | undefined; vehicleType?: string | null } | undefined;
  },
): Promise<void> {
  const vehicleNo = input.transport?.vehicleNo;
  if (!vehicleNo) return;
  await request.container.masters
    .rememberVehicle(ctx, vehicleNo, input.transport?.vehicleType ?? "R")
    .catch(() => undefined);
}
