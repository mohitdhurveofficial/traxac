import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  gstr1RequestSchema,
  hsnUpsertSchema,
  importRequestSchema,
  paymentFilterSchema,
  paymentTermSchema,
  receivablesFilterSchema,
  reconciliationRequestSchema,
  taxSettingsSchema,
} from "@ewayvo/shared/contracts";
import { AppError } from "@ewayvo/shared";
import { UploadedDocumentSource } from "@ewayvo/core";
import { requireAuth } from "../context.js";

const idParam = z.object({ id: z.string().uuid() });
const gstinQuery = z.object({ gstinId: z.string().uuid().optional() });

/**
 * Commercial configuration, ledgers, returns and reconciliation.
 *
 * Grouped together because they share one property: they are all *derived
 * views* over the invoice data rather than new sources of truth.
 */
export async function commercialRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------- Payment terms --------------------------- */

  app.get("/payment-terms", async (request) => {
    const ctx = requireAuth(request);
    const { gstinId } = gstinQuery.parse(request.query);
    return { items: await request.container.commercial.listPaymentTerms(ctx, gstinId) };
  });

  app.post("/payment-terms", async (request, reply) => {
    const ctx = requireAuth(request);
    const { gstinId } = gstinQuery.parse(request.query);
    const input = paymentTermSchema.parse(request.body);
    return reply
      .status(201)
      .send(await request.container.commercial.createPaymentTerm(ctx, input, gstinId));
  });

  app.patch("/payment-terms/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.commercial.updatePaymentTerm(
      ctx,
      id,
      paymentTermSchema.partial().parse(request.body),
    );
  });

  app.delete("/payment-terms/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.commercial.archivePaymentTerm(ctx, id);
    return { ok: true };
  });

  /* ----------------------------- Tax settings -------------------------- */

  app.get("/gstins/:id/tax-settings", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.commercial.getTaxSettings(ctx, id);
  });

  app.put("/gstins/:id/tax-settings", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.commercial.saveTaxSettings(
      ctx,
      id,
      taxSettingsSchema.parse(request.body),
    );
  });

  /* ------------------------------ HSN master --------------------------- */

  app.post("/reference/hsn", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = hsnUpsertSchema.parse(request.body);
    return reply.status(201).send(await request.container.commercial.upsertHsn(ctx, input));
  });

  /* -------------------------------- Ledgers ---------------------------- */

  app.get("/parties/:id/ledger", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.ledgers.customerLedger(ctx, id);
  });

  app.get("/products/:id/history", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.ledgers.productHistory(ctx, id);
  });

  app.get("/transporters/:id/history", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.ledgers.transporterHistory(ctx, id);
  });

  app.get("/vehicles/:id/history", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.ledgers.vehicleHistory(ctx, id);
  });

  /* ----------------------------- Receivables --------------------------- */

  app.get("/receivables", async (request) => {
    const ctx = requireAuth(request);
    const query = receivablesFilterSchema.parse(request.query);
    return request.container.ledgers.receivables(ctx, {
      gstinId: query.gstinId,
      buckets: query.buckets,
    });
  });

  app.get("/payments", async (request) => {
    const ctx = requireAuth(request);
    return request.container.ledgers.paymentHistory(ctx, paymentFilterSchema.parse(request.query));
  });

  /* -------------------------------- GSTR-1 -----------------------------
   *
   * FROZEN AND OUT OF SCOPE — retained so existing data stays reachable, not
   * presented as a product capability. No UI calls these. Do not extend.
   */

  app.get("/gstr1", async (request) => {
    const ctx = requireAuth(request);
    const { gstinId } = gstinQuery.parse(request.query);
    return { items: await request.container.gstr1.list(ctx, gstinId) };
  });

  /** Prepare without saving — the preview the user checks before exporting. */
  app.post("/gstr1/preview", async (request) => {
    const ctx = requireAuth(request);
    const input = gstr1RequestSchema.parse(request.body);
    const prepared = await request.container.gstr1.prepare(ctx, input.gstinId, input.period);
    // The payload can be large; the preview reports shape, not contents.
    const { payload: _payload, ...summary } = prepared;
    return { ...summary, sections: Object.keys(prepared.payload) };
  });

  app.post("/gstr1/prepare", async (request) => {
    const ctx = requireAuth(request);
    const input = gstr1RequestSchema.parse(request.body);
    const saved = await request.container.gstr1.save(ctx, input.gstinId, input.period);
    const { payload: _payload, ...summary } = saved;
    return summary;
  });

  /** Download the return as the JSON the offline utility accepts. */
  app.get("/gstr1/export", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = gstr1RequestSchema.parse(request.query);
    const prepared = await request.container.gstr1.prepare(ctx, input.gstinId, input.period);
    return reply
      .header("content-type", "application/json")
      .header(
        "content-disposition",
        `attachment; filename="GSTR1-${prepared.gstin}-${input.period}.json"`,
      )
      .send(JSON.stringify(prepared.payload, null, 2));
  });

  /* --------------------------- Reconciliation -------------------------- */

  app.get("/reconciliation", async (request) => {
    const ctx = requireAuth(request);
    const { gstinId } = gstinQuery.parse(request.query);
    return { items: await request.container.reconciliation.listRuns(ctx, gstinId) };
  });

  app.get("/reconciliation/:id/items", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const { status } = z
      .object({
        status: z.enum(["matched", "mismatched", "missing_locally", "missing_remotely"]).optional(),
      })
      .parse(request.query);
    return { items: await request.container.reconciliation.listItems(ctx, id, status) };
  });

  /**
   * Run a comparison against documents the user supplies.
   *
   * There is no portal source: `source: "portal"` is rejected rather than
   * quietly reconciling against nothing, which would mark every document as
   * missing at the government end.
   */
  app.post("/reconciliation", async (request) => {
    const ctx = requireAuth(request);
    const input = reconciliationRequestSchema.parse(request.body);
    if (input.source === "portal") {
      throw new AppError(
        "INVALID_STATE",
        "Portal reconciliation is not connected yet. Upload the portal's own export instead.",
      );
    }

    const { documents } = z
      .object({
        documents: z
          .array(
            z.object({
              documentNumber: z.string().trim().min(1),
              documentDate: z.coerce.date(),
              counterpartyGstin: z.string().trim().optional().nullable(),
              value: z.coerce.number(),
              irn: z.string().trim().optional().nullable(),
              ewbNumber: z.string().trim().optional().nullable(),
            }),
          )
          .default([]),
      })
      .parse(request.body);

    return request.container.reconciliation.run(
      ctx,
      { gstinId: input.gstinId, scope: input.scope, period: input.period },
      new UploadedDocumentSource(
        documents.map((d) => ({ ...d, value: Math.round(d.value * 100) })),
      ),
    );
  });

  /* -------------------------------- Import ----------------------------- */

  app.post("/import", async (request) => {
    const ctx = requireAuth(request);
    const { gstinId } = gstinQuery.parse(request.query);
    const input = importRequestSchema.parse(request.body);
    return request.container.imports.run(ctx, input, gstinId);
  });
}
