import type { FastifyInstance } from "fastify";
import "@fastify/multipart";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { tenantSettings, tenants } from "@traxac/database";
import { AppError, DEFAULT_EWB_THRESHOLD_PAISE, toPaise, toRupees } from "@traxac/shared";
import { requireAuth } from "../context.js";
import { API_PREFIX } from "../plugins/auth.js";

const idParam = z.object({ id: z.string().uuid() });

/** Documents, notifications, settings, number series and job status. */
export async function miscRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ Documents ---------------------------- */

  app.get("/documents/:id", async (request, reply) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const { document, body } = await request.container.documents.download(ctx, id);
    return reply
      .header("content-type", document.contentType)
      .header("content-disposition", `inline; filename="${document.filename}"`)
      .send(body);
  });

  /**
   * Where to fetch a document from. Returns a presigned storage URL when the
   * driver supports one, otherwise the authenticated API route above.
   */
  app.get("/documents/:id/link", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.documents.accessUrl(ctx, id, { apiPrefix: API_PREFIX });
  });

  app.post("/documents", async (request, reply) => {
    const ctx = requireAuth(request);
    const file = await request.file();
    if (!file) throw new AppError("VALIDATION_FAILED", "Attach a file to upload");
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const entityType = fields["entityType"]?.value ?? "invoice";
    const entityId = fields["entityId"]?.value;
    if (!entityId) throw new AppError("VALIDATION_FAILED", "entityId is required");

    const stored = await request.container.documents.store(ctx, {
      kind: "attachment",
      entityType: entityType as "invoice",
      entityId,
      filename: file.filename,
      contentType: file.mimetype,
      body: await file.toBuffer(),
    });
    return reply.status(201).send(stored);
  });

  app.delete("/documents/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.documents.remove(ctx, id);
    return { ok: true };
  });

  /* ---------------------------- Notifications -------------------------- */

  app.get("/notifications", async (request) => {
    const ctx = requireAuth(request);
    const query = z
      .object({
        unreadOnly: z.coerce.boolean().default(false),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    const [items, unread] = await Promise.all([
      request.container.notifications.list(ctx, query),
      request.container.notifications.unreadCount(ctx),
    ]);
    return { items, unread };
  });

  app.post("/notifications/:id/read", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.notifications.markRead(ctx, id);
    return { ok: true };
  });

  app.post("/notifications/read-all", async (request) => {
    const ctx = requireAuth(request);
    await request.container.notifications.markAllRead(ctx);
    return { ok: true };
  });

  /* ------------------------------ Settings ----------------------------- */

  app.get("/settings", async (request) => {
    const ctx = requireAuth(request);
    const { database } = request.container;
    const [[tenant], [settings]] = await Promise.all([
      database.db.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1),
      database.db
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, ctx.tenantId))
        .limit(1),
    ]);
    if (!tenant) throw new AppError("NOT_FOUND", "Business not found");
    return {
      business: { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan },
      settings: settings
        ? {
            ...settings,
            ewbThresholdRupees: toRupees(
              settings.ewbThreshold?.paise ?? DEFAULT_EWB_THRESHOLD_PAISE,
            ),
          }
        : null,
    };
  });

  app.patch("/settings", async (request) => {
    const ctx = requireAuth(request);
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new AppError("FORBIDDEN", "Only owners and admins can change settings");
    }
    const input = z
      .object({
        businessName: z.string().trim().min(2).max(200).optional(),
        autoGenerateEinvoice: z.boolean().optional(),
        autoGenerateEwb: z.boolean().optional(),
        ewbThresholdRupees: z.coerce.number().min(0).optional(),
        defaultTerms: z.string().max(2000).optional(),
        defaultNotes: z.string().max(2000).optional(),
        defaultGstinId: z.string().uuid().optional(),
      })
      .parse(request.body);

    const { database } = request.container;
    if (input.businessName) {
      await database.db
        .update(tenants)
        .set({ name: input.businessName, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId));
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.autoGenerateEinvoice !== undefined)
      patch["autoGenerateEinvoice"] = input.autoGenerateEinvoice;
    if (input.autoGenerateEwb !== undefined) patch["autoGenerateEwb"] = input.autoGenerateEwb;
    if (input.ewbThresholdRupees !== undefined) {
      patch["ewbThreshold"] = { paise: toPaise(input.ewbThresholdRupees) };
    }
    if (input.defaultTerms !== undefined) patch["defaultTerms"] = input.defaultTerms;
    if (input.defaultNotes !== undefined) patch["defaultNotes"] = input.defaultNotes;
    if (input.defaultGstinId !== undefined) patch["defaultGstinId"] = input.defaultGstinId;

    await database.db
      .insert(tenantSettings)
      .values({ tenantId: ctx.tenantId, ...patch })
      .onConflictDoUpdate({ target: tenantSettings.tenantId, set: patch });

    await request.container.audit.record(ctx, {
      action: "settings.updated",
      entityType: "tenant",
      entityId: ctx.tenantId,
    });
    return { ok: true };
  });

  /* --------------------------- Number series --------------------------- */

  app.get("/number-series", async (request) => {
    const ctx = requireAuth(request);
    return { items: await request.container.numbering.listSeries(ctx) };
  });

  app.patch("/number-series/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = z
      .object({
        prefix: z.string().max(10).optional(),
        suffix: z.string().max(10).optional(),
        padding: z.coerce.number().int().min(1).max(10).optional(),
        nextNumber: z.coerce.number().int().min(1).optional(),
      })
      .parse(request.body);
    return request.container.numbering.configureSeries(ctx, id, input);
  });

  /* ------------------------------- Jobs -------------------------------- */

  /** Poll a queued compliance job — how the UI shows "generating…". */
  app.get("/jobs/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const { database } = request.container;
    const rows = await database.client<
      Array<{
        id: string;
        kind: string;
        status: string;
        attempts: number;
        last_error: string | null;
        result: unknown;
        tenant_id: string | null;
      }>
    >`SELECT id, kind, status, attempts, last_error, result, tenant_id
        FROM jobs WHERE id = ${id} LIMIT 1`;
    const job = rows[0];
    if (!job || job.tenant_id !== ctx.tenantId) throw new AppError("NOT_FOUND", "Job not found");
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      attempts: job.attempts,
      error: job.last_error,
      result: job.result,
    };
  });
}
