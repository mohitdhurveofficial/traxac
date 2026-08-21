import { eq } from "drizzle-orm";
import type { Database } from "@ewayvo/database";
import { parties, products, transporters, vehicles, requireScope } from "@ewayvo/database";
import {
  AppError,
  isValidGstin,
  isValidHsn,
  isValidPincode,
  isValidUqc,
  isValidVehicleNo,
  normaliseVehicleNo,
  toPaise,
  isValidStateCode,
  gstinStateCode,
} from "@ewayvo/shared";
import type { ImportKind, ImportResult, ImportRowResult } from "@ewayvo/shared/contracts";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";

/**
 * Bulk import from a spreadsheet.
 *
 * Two decisions shape this:
 *
 *  - **Rows are independent.** One bad PIN code must not reject the other 499
 *    rows. Every row gets its own verdict and its own message, indexed by the
 *    line number the user sees in their file.
 *  - **Import is idempotent by natural key.** Re-importing the same file
 *    updates rather than duplicating, because people fix one cell and upload
 *    the whole sheet again.
 *
 * `dryRun` validates and reports without writing, which is what the UI shows
 * before asking the user to confirm.
 */

/** Column aliases, so a user's own headings usually just work. */
const ALIASES: Record<string, string[]> = {
  name: ["name", "customer", "customer name", "party", "party name", "supplier", "item", "product"],
  gstin: ["gstin", "gst", "gst no", "gstin no", "gst number"],
  phone: ["phone", "mobile", "contact", "phone no"],
  email: ["email", "e-mail", "email id"],
  addressLine1: ["address", "address1", "address line 1", "street"],
  city: ["city", "town", "place"],
  stateCode: ["state code", "statecode", "state"],
  pincode: ["pincode", "pin", "pin code", "postal code", "zip"],
  hsnSac: ["hsn", "sac", "hsn code", "hsn/sac", "hsn sac"],
  gstRate: ["gst rate", "gst%", "gst", "tax rate", "rate%"],
  unit: ["unit", "uqc", "uom"],
  unitPrice: ["price", "rate", "unit price", "selling price"],
  sku: ["sku", "code", "item code", "product code"],
  transporterId: ["transporter id", "transin", "transporter gstin"],
  vehicleNo: ["vehicle", "vehicle no", "vehicle number", "truck", "lorry"],
};

/** Pick a value from a row using any of the known aliases for a field. */
function pick(row: Record<string, string>, field: string): string {
  const wanted = ALIASES[field] ?? [field];
  for (const [key, value] of Object.entries(row)) {
    const normalised = key.trim().toLowerCase();
    if (wanted.includes(normalised)) return (value ?? "").trim();
  }
  return "";
}

export class ImportService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  async run(
    ctx: AuthContext,
    input: { kind: ImportKind; rows: Array<Record<string, string>>; dryRun: boolean },
    gstinId?: string,
  ): Promise<ImportResult> {
    requirePermission(ctx, input.kind === "products" ? "products:write" : "parties:write");

    const results: ImportRowResult[] = [];
    for (const [index, row] of input.rows.entries()) {
      // +2: spreadsheets are 1-indexed and row 1 is the header.
      const rowNumber = index + 2;
      try {
        const outcome = await this.importRow(ctx, input.kind, row, input.dryRun, gstinId);
        results.push({ row: rowNumber, ...outcome });
      } catch (err) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof AppError ? err.message : "Could not import this row",
        });
      }
    }

    const summary: ImportResult = {
      kind: input.kind,
      dryRun: input.dryRun,
      total: results.length,
      created: results.filter((r) => r.status === "created").length,
      updated: results.filter((r) => r.status === "updated").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };

    if (!input.dryRun) {
      await this.audit.record(ctx, {
        action: `import.${input.kind}`,
        entityType: "import",
        entityId: input.kind,
        summary: `${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`,
        metadata: { total: summary.total, failed: summary.failed },
      });
    }
    return summary;
  }

  private async importRow(
    ctx: AuthContext,
    kind: ImportKind,
    row: Record<string, string>,
    dryRun: boolean,
    gstinId?: string,
  ): Promise<Omit<ImportRowResult, "row">> {
    switch (kind) {
      case "customers":
      case "suppliers":
        return this.importParty(
          ctx,
          row,
          kind === "suppliers" ? "supplier" : "customer",
          dryRun,
          gstinId,
        );
      case "products":
        return this.importProduct(ctx, row, dryRun, gstinId);
      case "transporters":
        return this.importTransporter(ctx, row, dryRun, gstinId);
      case "vehicles":
        return this.importVehicle(ctx, row, dryRun, gstinId);
      default:
        throw new AppError("VALIDATION_FAILED", "Unknown import type");
    }
  }

  private async importParty(
    ctx: AuthContext,
    row: Record<string, string>,
    partyType: "customer" | "supplier",
    dryRun: boolean,
    gstinId?: string,
  ): Promise<Omit<ImportRowResult, "row">> {
    const name = pick(row, "name");
    if (!name) return { status: "failed", message: "Name is required" };

    const gstin = pick(row, "gstin").toUpperCase();
    if (gstin && !isValidGstin(gstin)) {
      return { status: "failed", name, message: `GSTIN ${gstin} is not valid` };
    }

    let stateCode = pick(row, "stateCode");
    // A GSTIN already encodes the state; trust it over a typed column.
    if (gstin) stateCode = gstinStateCode(gstin);
    if (stateCode && !isValidStateCode(stateCode)) {
      return { status: "failed", name, message: `State code ${stateCode} is not valid` };
    }

    const pincode = pick(row, "pincode");
    if (pincode && !isValidPincode(pincode)) {
      return { status: "failed", name, message: `PIN code ${pincode} is not valid` };
    }

    const existing = await this.db
      .select({ id: parties.id })
      .from(parties)
      .where(scoped(ctx, parties, gstin ? eq(parties.gstin, gstin) : eq(parties.name, name)))
      .limit(1);

    if (dryRun) {
      return { status: existing.length ? "updated" : "created", name };
    }

    const values = {
      tenantId: ctx.tenantId,
      gstinId: gstinId ?? null,
      name,
      partyType,
      gstin: gstin || null,
      registrationType: gstin ? "regular" : "unregistered",
      email: pick(row, "email") || null,
      phone: pick(row, "phone") || null,
      addressLine1: pick(row, "addressLine1") || null,
      city: pick(row, "city") || null,
      stateCode: stateCode || null,
      pincode: pincode || null,
      country: "IN",
      defaultPlaceOfSupply: stateCode || null,
      updatedAt: new Date(),
    };

    if (existing[0]) {
      await this.db.update(parties).set(values).where(eq(parties.id, existing[0].id));
      return { status: "updated", id: existing[0].id, name };
    }
    const [created] = await this.db.insert(parties).values(values).returning({ id: parties.id });
    return { status: "created", id: created?.id, name };
  }

  private async importProduct(
    ctx: AuthContext,
    row: Record<string, string>,
    dryRun: boolean,
    gstinId?: string,
  ): Promise<Omit<ImportRowResult, "row">> {
    const name = pick(row, "name");
    if (!name) return { status: "failed", message: "Item name is required" };

    const hsnSac = pick(row, "hsnSac");
    if (!hsnSac || !isValidHsn(hsnSac)) {
      return { status: "failed", name, message: `HSN/SAC "${hsnSac}" must be 4, 6 or 8 digits` };
    }

    const unit = (pick(row, "unit") || "NOS").toUpperCase();
    if (!isValidUqc(unit)) {
      return { status: "failed", name, message: `Unit "${unit}" is not a valid UQC code` };
    }

    const gstRate = Number(pick(row, "gstRate").replace("%", "") || 0);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
      return { status: "failed", name, message: "GST rate must be between 0 and 100" };
    }

    const existing = await this.db
      .select({ id: products.id })
      .from(products)
      .where(scoped(ctx, products, eq(products.name, name)))
      .limit(1);

    if (dryRun) return { status: existing.length ? "updated" : "created", name };

    const values = {
      tenantId: ctx.tenantId,
      gstinId: gstinId ?? null,
      name,
      sku: pick(row, "sku") || null,
      hsnSac,
      unit,
      gstRate: String(gstRate),
      unitPrice: toPaise(pick(row, "unitPrice") || 0),
      isService: hsnSac.startsWith("99"),
      updatedAt: new Date(),
    };

    if (existing[0]) {
      await this.db.update(products).set(values).where(eq(products.id, existing[0].id));
      return { status: "updated", id: existing[0].id, name };
    }
    const [created] = await this.db.insert(products).values(values).returning({ id: products.id });
    return { status: "created", id: created?.id, name };
  }

  private async importTransporter(
    ctx: AuthContext,
    row: Record<string, string>,
    dryRun: boolean,
    gstinId?: string,
  ): Promise<Omit<ImportRowResult, "row">> {
    const name = pick(row, "name");
    if (!name) return { status: "failed", message: "Transporter name is required" };

    const transporterId = pick(row, "transporterId").toUpperCase();
    if (transporterId && transporterId.length !== 15) {
      return { status: "failed", name, message: "Transporter ID must be 15 characters" };
    }

    const existing = await this.db
      .select({ id: transporters.id })
      .from(transporters)
      .where(scoped(ctx, transporters, eq(transporters.name, name)))
      .limit(1);
    if (dryRun) return { status: existing.length ? "updated" : "created", name };
    if (existing[0])
      return { status: "skipped", id: existing[0].id, name, message: "Already exists" };

    const [created] = await this.db
      .insert(transporters)
      .values({
        tenantId: ctx.tenantId,
        gstinId: gstinId ?? null,
        name,
        transporterId: transporterId || null,
        phone: pick(row, "phone") || null,
        city: pick(row, "city") || null,
      })
      .returning({ id: transporters.id });
    return { status: "created", id: created?.id, name };
  }

  private async importVehicle(
    ctx: AuthContext,
    row: Record<string, string>,
    dryRun: boolean,
    gstinId?: string,
  ): Promise<Omit<ImportRowResult, "row">> {
    const raw = pick(row, "vehicleNo");
    if (!raw) return { status: "failed", message: "Vehicle number is required" };
    const vehicleNo = normaliseVehicleNo(raw);
    if (!isValidVehicleNo(vehicleNo)) {
      return { status: "failed", name: raw, message: `"${raw}" is not a valid vehicle number` };
    }

    const existing = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(scoped(ctx, vehicles, eq(vehicles.vehicleNo, vehicleNo)))
      .limit(1);
    if (dryRun) return { status: existing.length ? "skipped" : "created", name: vehicleNo };
    if (existing[0]) {
      return { status: "skipped", id: existing[0].id, name: vehicleNo, message: "Already exists" };
    }

    const [created] = await this.db
      .insert(vehicles)
      .values({ tenantId: ctx.tenantId, gstinId: gstinId ?? null, vehicleNo, vehicleType: "R" })
      .returning({ id: vehicles.id });
    return { status: "created", id: created?.id, name: vehicleNo };
  }
}
