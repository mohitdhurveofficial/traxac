import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createBranchSchema, createGstinSchema, createPartyAddressSchema, createPartySchema,
  createProductSchema, createTransporterSchema, createVehicleSchema,
  updateBranchSchema, updateGstinSchema, updatePartySchema, updateProductSchema,
  updateTransporterSchema, updateVehicleSchema,
} from "@traxac/shared/contracts";
import { GST_STATE_CODES, UQC_UNITS } from "@traxac/shared";
import { requireAuth } from "../context.js";

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  page: z.coerce.number().int().min(1).default(1),
  includeInactive: z.coerce.boolean().default(false),
  partyType: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

/**
 * Master data endpoints. These are what make repeat billing fast: the client
 * searches customers, products and vehicles here and the invoice form fills
 * itself from the result.
 */
export async function masterRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ GSTINs ------------------------------- */

  app.get("/gstins", async (request) => {
    const ctx = requireAuth(request);
    return { items: await request.container.masters.listGstins(ctx) };
  });

  app.post("/gstins", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = createGstinSchema.parse(request.body);
    return reply.status(201).send(await request.container.masters.createGstin(ctx, input));
  });

  app.patch("/gstins/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = updateGstinSchema.parse(request.body);
    return request.container.masters.updateGstin(ctx, id, input);
  });

  /* ------------------------------ Branches ----------------------------- */

  app.get("/branches", async (request) => {
    const ctx = requireAuth(request);
    const { gstinId } = z.object({ gstinId: z.string().uuid().optional() }).parse(request.query);
    return { items: await request.container.masters.listBranches(ctx, gstinId) };
  });

  app.post("/branches", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = createBranchSchema.parse(request.body);
    return reply.status(201).send(await request.container.masters.createBranch(ctx, input));
  });

  app.patch("/branches/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.masters.updateBranch(ctx, id, updateBranchSchema.parse(request.body));
  });

  app.delete("/branches/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.masters.deleteBranch(ctx, id);
    return { ok: true };
  });

  /* ------------------------------ Parties ------------------------------ */

  app.get("/parties", async (request) => {
    const ctx = requireAuth(request);
    const query = listQuery.parse(request.query);
    return request.container.masters.listParties(ctx, query);
  });

  app.get("/parties/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.masters.getPartyWithAddresses(ctx, id);
  });

  app.post("/parties", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = createPartySchema.parse(request.body);
    return reply.status(201).send(await request.container.masters.createParty(ctx, input));
  });

  app.patch("/parties/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.masters.updateParty(ctx, id, updatePartySchema.parse(request.body));
  });

  app.delete("/parties/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.masters.archiveParty(ctx, id);
    return { ok: true };
  });

  app.post("/parties/:id/addresses", async (request, reply) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    const input = createPartyAddressSchema.parse(request.body);
    return reply.status(201).send(await request.container.masters.addPartyAddress(ctx, id, input));
  });

  app.delete("/party-addresses/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.masters.deletePartyAddress(ctx, id);
    return { ok: true };
  });

  /* ------------------------------ Products ----------------------------- */

  app.get("/products", async (request) => {
    const ctx = requireAuth(request);
    return request.container.masters.listProducts(ctx, listQuery.parse(request.query));
  });

  app.get("/products/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.masters.getProduct(ctx, id);
  });

  app.post("/products", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = createProductSchema.parse(request.body);
    return reply.status(201).send(await request.container.masters.createProduct(ctx, input));
  });

  app.patch("/products/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.masters.updateProduct(ctx, id, updateProductSchema.parse(request.body));
  });

  app.delete("/products/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.masters.archiveProduct(ctx, id);
    return { ok: true };
  });

  /* ---------------------------- Transporters --------------------------- */

  app.get("/transporters", async (request) => {
    const ctx = requireAuth(request);
    return request.container.masters.listTransporters(ctx, listQuery.parse(request.query));
  });

  app.post("/transporters", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = createTransporterSchema.parse(request.body);
    return reply.status(201).send(await request.container.masters.createTransporter(ctx, input));
  });

  app.patch("/transporters/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.masters.updateTransporter(
      ctx, id, updateTransporterSchema.parse(request.body),
    );
  });

  app.delete("/transporters/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.masters.archiveTransporter(ctx, id);
    return { ok: true };
  });

  /* ------------------------------ Vehicles ----------------------------- */

  app.get("/vehicles", async (request) => {
    const ctx = requireAuth(request);
    return request.container.masters.listVehicles(ctx, listQuery.parse(request.query));
  });

  app.post("/vehicles", async (request, reply) => {
    const ctx = requireAuth(request);
    const input = createVehicleSchema.parse(request.body);
    return reply.status(201).send(await request.container.masters.createVehicle(ctx, input));
  });

  app.patch("/vehicles/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    return request.container.masters.updateVehicle(ctx, id, updateVehicleSchema.parse(request.body));
  });

  app.delete("/vehicles/:id", async (request) => {
    const ctx = requireAuth(request);
    const { id } = idParam.parse(request.params);
    await request.container.masters.archiveVehicle(ctx, id);
    return { ok: true };
  });

  /* --------------------------- Reference data -------------------------- */

  app.get("/reference/states", async () => ({
    items: Object.entries(GST_STATE_CODES).map(([code, name]) => ({ code, name })),
  }));

  app.get("/reference/units", async () => ({ items: UQC_UNITS }));

  app.get("/reference/hsn", async (request) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(60) }).parse(request.query);
    return { items: await request.container.masters.searchHsn(q) };
  });

  /** HSNs this business already uses — the most useful suggestions. */
  app.get("/reference/hsn/recent", async (request) => {
    const ctx = requireAuth(request);
    return { items: await request.container.masters.recentHsn(ctx) };
  });
}
