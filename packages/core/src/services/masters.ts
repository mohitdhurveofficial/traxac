import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@ewayvo/database";
import {
  branches,
  gstins,
  parties,
  partyAddresses,
  products,
  transporters,
  vehicles,
  hsnCodes,
  units,
  requireScope,
} from "@ewayvo/database";
import { AppError, gstinStateCode, normaliseVehicleNo, toPaise } from "@ewayvo/shared";
import type {
  CreateBranchInput,
  CreateGstinInput,
  CreatePartyAddressInput,
  CreatePartyInput,
  CreateProductInput,
  CreateTransporterInput,
  CreateVehicleInput,
} from "@ewayvo/shared/contracts";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById, scopedToGstin } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";
import { diffRecords } from "../infra/audit.js";
import { compact, countExpr, paginate, searchAcross } from "./query.js";

export interface ListOptions {
  q?: string | undefined;
  limit?: number;
  page?: number;
  includeInactive?: boolean;
}

const blankToNull = (v: string | undefined | null): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Master data services. Everything a trader reuses on the next invoice —
 * customers, products, HSNs, transporters, vehicles — lives here, and every
 * query is tenant-scoped through `scoped()`/`scopedById()`.
 */
export class MastersService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  /* ------------------------------ GSTINs ------------------------------- */

  async listGstins(ctx: AuthContext) {
    return this.db
      .select()
      .from(gstins)
      .where(scoped(ctx, gstins))
      .orderBy(desc(gstins.isPrimary), asc(gstins.tradeName));
  }

  async getGstin(ctx: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(gstins)
      .where(scopedById(ctx, gstins, id))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "GSTIN registration not found");
    return row;
  }

  async createGstin(ctx: AuthContext, input: CreateGstinInput) {
    requirePermission(ctx, "settings:write");
    if (gstinStateCode(input.gstin) !== input.stateCode) {
      throw new AppError(
        "VALIDATION_FAILED",
        "The GSTIN's state code does not match the selected state",
        {
          details: { gstinStateCode: gstinStateCode(input.gstin), stateCode: input.stateCode },
        },
      );
    }
    const existing = await this.db
      .select({ id: gstins.id })
      .from(gstins)
      .where(scoped(ctx, gstins, eq(gstins.gstin, input.gstin)))
      .limit(1);
    if (existing.length) throw new AppError("CONFLICT", "This GSTIN is already registered");

    const isFirst =
      (await this.db.select({ n: countExpr }).from(gstins).where(scoped(ctx, gstins)))[0]?.n === 0;

    return this.db.transaction(async (tx) => {
      if (input.isPrimary || isFirst) {
        await tx.update(gstins).set({ isPrimary: false }).where(eq(gstins.tenantId, ctx.tenantId));
      }
      const [row] = await tx
        .insert(gstins)
        .values({
          tenantId: ctx.tenantId,
          gstin: input.gstin,
          legalName: input.legalName,
          tradeName: input.tradeName,
          registrationType: input.registrationType,
          addressLine1: input.addressLine1,
          addressLine2: blankToNull(input.addressLine2),
          city: input.city,
          stateCode: input.stateCode,
          pincode: input.pincode,
          phone: blankToNull(input.phone),
          email: blankToNull(input.email),
          einvoiceEnabled: input.einvoiceEnabled,
          ewbEnabled: input.ewbEnabled,
          isPrimary: input.isPrimary || isFirst,
        })
        .returning();
      if (!row) throw new AppError("INTERNAL", "Could not save the GSTIN");
      await this.audit.record(ctx, {
        action: "gstin.created",
        entityType: "gstin",
        entityId: row.id,
        summary: `${row.tradeName} (${row.gstin})`,
      });
      return row;
    });
  }

  async updateGstin(
    ctx: AuthContext,
    id: string,
    input: Partial<CreateGstinInput> & { isActive?: boolean },
  ) {
    requirePermission(ctx, "settings:write");
    const before = await this.getGstin(ctx, id);
    const [row] = await this.db
      .update(gstins)
      .set({ ...stripUndefined(input), updatedAt: new Date() })
      .where(scopedById(ctx, gstins, id))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "GSTIN registration not found");
    if (input.isPrimary) {
      await this.db
        .update(gstins)
        .set({ isPrimary: false })
        .where(and(eq(gstins.tenantId, ctx.tenantId), ne(gstins.id, id)));
    }
    await this.audit.record(ctx, {
      action: "gstin.updated",
      entityType: "gstin",
      entityId: id,
      diff: diffRecords(before, row),
    });
    return row;
  }

  /* ------------------------------ Branches ----------------------------- */

  async listBranches(ctx: AuthContext, gstinId?: string) {
    return this.db
      .select()
      .from(branches)
      .where(scoped(ctx, branches, gstinId ? eq(branches.gstinId, gstinId) : undefined))
      .orderBy(desc(branches.isDefault), asc(branches.name));
  }

  async createBranch(ctx: AuthContext, input: CreateBranchInput) {
    requirePermission(ctx, "settings:write");
    await this.getGstin(ctx, input.gstinId); // tenant ownership check
    const [row] = await this.db
      .insert(branches)
      .values({
        tenantId: ctx.tenantId,
        gstinId: input.gstinId,
        code: blankToNull(input.code),
        name: input.name,
        kind: input.kind,
        addressLine1: input.addressLine1,
        addressLine2: blankToNull(input.addressLine2),
        city: input.city,
        stateCode: input.stateCode,
        pincode: input.pincode,
        phone: blankToNull(input.phone),
        isDefault: input.isDefault,
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the branch");
    if (input.isDefault) {
      await this.db
        .update(branches)
        .set({ isDefault: false })
        .where(
          and(
            eq(branches.tenantId, ctx.tenantId),
            eq(branches.gstinId, input.gstinId),
            ne(branches.id, row.id),
          ),
        );
    }
    await this.audit.record(ctx, {
      action: "branch.created",
      entityType: "branch",
      entityId: row.id,
      summary: row.name,
    });
    return row;
  }

  async updateBranch(
    ctx: AuthContext,
    id: string,
    input: Partial<CreateBranchInput> & { isActive?: boolean },
  ) {
    requirePermission(ctx, "settings:write");
    const [row] = await this.db
      .update(branches)
      .set({ ...stripUndefined(input), updatedAt: new Date() })
      .where(scopedById(ctx, branches, id))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Branch not found");
    await this.audit.record(ctx, { action: "branch.updated", entityType: "branch", entityId: id });
    return row;
  }

  async deleteBranch(ctx: AuthContext, id: string) {
    requirePermission(ctx, "settings:write");
    await this.db
      .update(branches)
      .set({ isActive: false, updatedAt: new Date() })
      .where(scopedById(ctx, branches, id));
    await this.audit.record(ctx, { action: "branch.archived", entityType: "branch", entityId: id });
  }

  /* ------------------------------- Parties ----------------------------- */

  async listParties(ctx: AuthContext, options: ListOptions & { partyType?: string } = {}) {
    const limit = options.limit ?? 25;
    const page = options.page ?? 1;
    const where = scoped(
      ctx,
      parties,
      scopedToGstin(ctx, parties.gstinId),
      options.includeInactive ? undefined : eq(parties.isActive, true),
      options.partyType && options.partyType !== "both"
        ? sql`(${parties.partyType} = ${options.partyType} OR ${parties.partyType} = 'both')`
        : undefined,
      searchAcross(
        [
          parties.name,
          parties.legalName,
          parties.gstin,
          parties.city,
          parties.phone,
          parties.email,
        ],
        options.q,
      ),
    );
    const [rows, [count]] = await Promise.all([
      this.db
        .select()
        .from(parties)
        .where(where)
        .orderBy(asc(parties.name))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ n: countExpr }).from(parties).where(where),
    ]);
    return paginate(rows, count?.n ?? 0, limit, page);
  }

  async getParty(ctx: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(parties)
      .where(scopedById(ctx, parties, id))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Customer not found");
    return row;
  }

  async getPartyWithAddresses(ctx: AuthContext, id: string) {
    const party = await this.getParty(ctx, id);
    const addresses = await this.db
      .select()
      .from(partyAddresses)
      .where(
        scoped(
          ctx,
          partyAddresses,
          eq(partyAddresses.partyId, id),
          eq(partyAddresses.isActive, true),
        ),
      )
      .orderBy(desc(partyAddresses.isDefault), asc(partyAddresses.label));
    return { ...party, addresses };
  }

  async createParty(ctx: AuthContext, input: CreatePartyInput) {
    requirePermission(ctx, "parties:write");
    if (input.gstin && input.stateCode && gstinStateCode(input.gstin) !== input.stateCode) {
      throw new AppError("VALIDATION_FAILED", "The GSTIN's state does not match the address state");
    }
    const [row] = await this.db
      .insert(parties)
      .values({
        tenantId: ctx.tenantId,
        // Belongs to the registration the user is working in; null means
        // shared across all of them.
        gstinId: ctx.activeGstinId ?? null,
        name: input.name,
        legalName: blankToNull(input.legalName),
        partyType: input.partyType,
        gstin: blankToNull(input.gstin),
        pan: blankToNull(input.pan) ?? (input.gstin ? input.gstin.slice(2, 12) : null),
        registrationType: input.registrationType,
        email: blankToNull(input.email),
        phone: blankToNull(input.phone),
        addressLine1: blankToNull(input.addressLine1),
        addressLine2: blankToNull(input.addressLine2),
        city: blankToNull(input.city),
        stateCode: blankToNull(input.stateCode),
        pincode: blankToNull(input.pincode),
        country: input.country,
        defaultPlaceOfSupply:
          blankToNull(input.defaultPlaceOfSupply) ?? blankToNull(input.stateCode),
        creditDays: input.creditDays !== undefined ? String(input.creditDays) : null,
        notes: blankToNull(input.notes),
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the customer");
    await this.audit.record(ctx, {
      action: "party.created",
      entityType: "party",
      entityId: row.id,
      summary: row.name,
    });
    return row;
  }

  async updateParty(ctx: AuthContext, id: string, input: Record<string, unknown>) {
    requirePermission(ctx, "parties:write");
    const before = await this.getParty(ctx, id);
    const [row] = await this.db
      .update(parties)
      .set({ ...stripUndefined(input), updatedAt: new Date() })
      .where(scopedById(ctx, parties, id))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Customer not found");
    await this.audit.record(ctx, {
      action: "party.updated",
      entityType: "party",
      entityId: id,
      diff: diffRecords(before, row),
    });
    return row;
  }

  async archiveParty(ctx: AuthContext, id: string) {
    requirePermission(ctx, "parties:write");
    await this.db
      .update(parties)
      .set({ isActive: false, updatedAt: new Date() })
      .where(scopedById(ctx, parties, id));
    await this.audit.record(ctx, { action: "party.archived", entityType: "party", entityId: id });
  }

  async addPartyAddress(ctx: AuthContext, partyId: string, input: CreatePartyAddressInput) {
    requirePermission(ctx, "parties:write");
    await this.getParty(ctx, partyId);
    const [row] = await this.db
      .insert(partyAddresses)
      .values({
        tenantId: ctx.tenantId,
        partyId,
        label: input.label,
        kind: input.kind,
        gstin: blankToNull(input.gstin),
        name: input.name,
        addressLine1: input.addressLine1,
        addressLine2: blankToNull(input.addressLine2),
        city: input.city,
        stateCode: input.stateCode,
        pincode: input.pincode,
        phone: blankToNull(input.phone),
        isDefault: input.isDefault,
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the address");
    if (input.isDefault) {
      await this.db
        .update(partyAddresses)
        .set({ isDefault: false })
        .where(
          and(
            eq(partyAddresses.tenantId, ctx.tenantId),
            eq(partyAddresses.partyId, partyId),
            eq(partyAddresses.kind, input.kind),
            ne(partyAddresses.id, row.id),
          ),
        );
    }
    return row;
  }

  async deletePartyAddress(ctx: AuthContext, id: string) {
    requirePermission(ctx, "parties:write");
    await this.db
      .update(partyAddresses)
      .set({ isActive: false })
      .where(scopedById(ctx, partyAddresses, id));
  }

  /* ------------------------------ Products ----------------------------- */

  async listProducts(ctx: AuthContext, options: ListOptions = {}) {
    const limit = options.limit ?? 25;
    const page = options.page ?? 1;
    const where = scoped(
      ctx,
      products,
      scopedToGstin(ctx, products.gstinId),
      options.includeInactive ? undefined : eq(products.isActive, true),
      searchAcross([products.name, products.sku, products.hsnSac, products.description], options.q),
    );
    const [rows, [count]] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(where)
        .orderBy(asc(products.name))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ n: countExpr }).from(products).where(where),
    ]);
    return paginate(rows, count?.n ?? 0, limit, page);
  }

  async getProduct(ctx: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(products)
      .where(scopedById(ctx, products, id))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Product not found");
    return row;
  }

  async createProduct(ctx: AuthContext, input: CreateProductInput) {
    requirePermission(ctx, "products:write");
    const clash = await this.db
      .select({ id: products.id })
      .from(products)
      .where(scoped(ctx, products, eq(products.name, input.name)))
      .limit(1);
    if (clash.length) throw new AppError("CONFLICT", "A product with this name already exists");
    const [row] = await this.db
      .insert(products)
      .values({
        tenantId: ctx.tenantId,
        gstinId: ctx.activeGstinId ?? null,
        name: input.name,
        description: blankToNull(input.description),
        sku: blankToNull(input.sku),
        hsnSac: input.hsnSac,
        isService: input.isService,
        gstRate: String(input.gstRate),
        cessRate: String(input.cessRate),
        unit: input.unit,
        unitPrice: toPaise(input.unitPrice),
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the product");
    await this.audit.record(ctx, {
      action: "product.created",
      entityType: "product",
      entityId: row.id,
      summary: row.name,
    });
    return row;
  }

  async updateProduct(ctx: AuthContext, id: string, input: Record<string, unknown>) {
    requirePermission(ctx, "products:write");
    const before = await this.getProduct(ctx, id);
    const values = stripUndefined(input);
    if (values["unitPrice"] !== undefined) {
      values["unitPrice"] = toPaise(values["unitPrice"] as number | string);
    }
    // numeric columns are stored as strings by the driver; only coerce scalars
    for (const key of ["gstRate", "cessRate"]) {
      const rate = values[key];
      if (typeof rate === "number" || typeof rate === "string") values[key] = String(rate);
    }
    const [row] = await this.db
      .update(products)
      .set({ ...values, updatedAt: new Date() })
      .where(scopedById(ctx, products, id))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Product not found");
    await this.audit.record(ctx, {
      action: "product.updated",
      entityType: "product",
      entityId: id,
      diff: diffRecords(before, row),
    });
    return row;
  }

  async archiveProduct(ctx: AuthContext, id: string) {
    requirePermission(ctx, "products:write");
    await this.db
      .update(products)
      .set({ isActive: false, updatedAt: new Date() })
      .where(scopedById(ctx, products, id));
    await this.audit.record(ctx, {
      action: "product.archived",
      entityType: "product",
      entityId: id,
    });
  }

  /* ---------------------------- Transporters --------------------------- */

  async listTransporters(ctx: AuthContext, options: ListOptions = {}) {
    const limit = options.limit ?? 50;
    const page = options.page ?? 1;
    const where = scoped(
      ctx,
      transporters,
      scopedToGstin(ctx, transporters.gstinId),
      options.includeInactive ? undefined : eq(transporters.isActive, true),
      searchAcross([transporters.name, transporters.transporterId, transporters.phone], options.q),
    );
    const [rows, [count]] = await Promise.all([
      this.db
        .select()
        .from(transporters)
        .where(where)
        .orderBy(asc(transporters.name))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ n: countExpr }).from(transporters).where(where),
    ]);
    return paginate(rows, count?.n ?? 0, limit, page);
  }

  async getTransporter(ctx: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(transporters)
      .where(scopedById(ctx, transporters, id))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Transporter not found");
    return row;
  }

  async createTransporter(ctx: AuthContext, input: CreateTransporterInput) {
    requirePermission(ctx, "logistics:write");
    const [row] = await this.db
      .insert(transporters)
      .values({
        tenantId: ctx.tenantId,
        gstinId: ctx.activeGstinId ?? null,
        name: input.name,
        transporterId: blankToNull(input.transporterId),
        phone: blankToNull(input.phone),
        email: blankToNull(input.email),
        addressLine1: blankToNull(input.addressLine1),
        city: blankToNull(input.city),
        stateCode: blankToNull(input.stateCode),
        pincode: blankToNull(input.pincode),
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the transporter");
    await this.audit.record(ctx, {
      action: "transporter.created",
      entityType: "transporter",
      entityId: row.id,
      summary: row.name,
    });
    return row;
  }

  async updateTransporter(ctx: AuthContext, id: string, input: Record<string, unknown>) {
    requirePermission(ctx, "logistics:write");
    const [row] = await this.db
      .update(transporters)
      .set({ ...stripUndefined(input), updatedAt: new Date() })
      .where(scopedById(ctx, transporters, id))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Transporter not found");
    return row;
  }

  async archiveTransporter(ctx: AuthContext, id: string) {
    requirePermission(ctx, "logistics:write");
    await this.db
      .update(transporters)
      .set({ isActive: false, updatedAt: new Date() })
      .where(scopedById(ctx, transporters, id));
  }

  /* ------------------------------ Vehicles ----------------------------- */

  async listVehicles(ctx: AuthContext, options: ListOptions = {}) {
    const limit = options.limit ?? 50;
    const page = options.page ?? 1;
    const where = scoped(
      ctx,
      vehicles,
      scopedToGstin(ctx, vehicles.gstinId),
      options.includeInactive ? undefined : eq(vehicles.isActive, true),
      searchAcross([vehicles.vehicleNo, vehicles.driverName, vehicles.driverPhone], options.q),
    );
    const [rows, [count]] = await Promise.all([
      this.db
        .select()
        .from(vehicles)
        .where(where)
        .orderBy(desc(vehicles.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ n: countExpr }).from(vehicles).where(where),
    ]);
    return paginate(rows, count?.n ?? 0, limit, page);
  }

  async createVehicle(ctx: AuthContext, input: CreateVehicleInput) {
    requirePermission(ctx, "logistics:write");
    const vehicleNo = normaliseVehicleNo(input.vehicleNo);
    const [existing] = await this.db
      .select()
      .from(vehicles)
      .where(scoped(ctx, vehicles, eq(vehicles.vehicleNo, vehicleNo)))
      .limit(1);
    if (existing) return existing;
    const [row] = await this.db
      .insert(vehicles)
      .values({
        tenantId: ctx.tenantId,
        gstinId: ctx.activeGstinId ?? null,
        vehicleNo,
        vehicleType: input.vehicleType,
        transporterId: input.transporterId ?? null,
        driverName: blankToNull(input.driverName),
        driverPhone: blankToNull(input.driverPhone),
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the vehicle");
    return row;
  }

  /**
   * Remember a vehicle seen on an invoice so it autocompletes next time.
   * Called from the invoice flow; never fails the parent operation.
   */
  async rememberVehicle(ctx: AuthContext, vehicleNo: string, vehicleType = "R"): Promise<void> {
    const normalised = normaliseVehicleNo(vehicleNo);
    if (!normalised) return;
    await this.db
      .insert(vehicles)
      .values({
        tenantId: ctx.tenantId,
        gstinId: ctx.activeGstinId ?? null,
        vehicleNo: normalised,
        vehicleType,
      })
      .onConflictDoNothing()
      .catch(() => undefined);
  }

  async updateVehicle(ctx: AuthContext, id: string, input: Record<string, unknown>) {
    requirePermission(ctx, "logistics:write");
    const values = stripUndefined(input);
    if (typeof values["vehicleNo"] === "string") {
      values["vehicleNo"] = normaliseVehicleNo(values["vehicleNo"]);
    }
    const [row] = await this.db
      .update(vehicles)
      .set(values)
      .where(scopedById(ctx, vehicles, id))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Vehicle not found");
    return row;
  }

  async archiveVehicle(ctx: AuthContext, id: string) {
    requirePermission(ctx, "logistics:write");
    await this.db
      .update(vehicles)
      .set({ isActive: false })
      .where(scopedById(ctx, vehicles, id));
  }

  /* --------------------------- Global masters -------------------------- */

  /** HSN/SAC lookup used by the product form's autocomplete. */
  async searchHsn(term: string, limit = 20) {
    const q = term.trim();
    if (!q) return [];
    const pattern = `${q}%`;
    return this.db
      .select()
      .from(hsnCodes)
      .where(sql`${hsnCodes.code} LIKE ${pattern} OR ${hsnCodes.description} ILIKE ${`%${q}%`}`)
      .orderBy(asc(hsnCodes.code))
      .limit(limit);
  }

  async listUnits() {
    return this.db.select().from(units).orderBy(asc(units.code));
  }

  /** HSN codes this tenant has actually used, ranked by frequency. */
  async recentHsn(ctx: AuthContext, limit = 10) {
    return this.db
      .select({ hsnSac: products.hsnSac, gstRate: products.gstRate, uses: countExpr })
      .from(products)
      .where(scoped(ctx, products))
      .groupBy(products.hsnSac, products.gstRate)
      .orderBy(desc(countExpr))
      .limit(limit);
  }
}

/** Drop `undefined` keys so a partial update never nulls a column by accident. */
function stripUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

export { compact };
