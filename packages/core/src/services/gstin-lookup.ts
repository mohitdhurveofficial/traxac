import { eq } from "drizzle-orm";
import { gstinRegistry, type Database, requireScope } from "@traxac/database";
import { AppError, isValidGstin, isValidTransin, normaliseGstin } from "@traxac/shared";
import type {
  GatewayRegistry,
  GatewayRequestContext,
  GatewayResult,
  GstinDetails,
  TransporterDetails,
} from "@traxac/gst-gateway";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";
import type { CredentialService } from "../compliance/credentials.js";

/**
 * GSTIN and TRANSIN auto-fill.
 *
 * Three rules shape everything here.
 *
 * **Local validation is free; a portal call is not.** The checksum is verified
 * before any credential is touched, so a typo costs nothing and a business
 * with no GST integration still gets meaningful feedback.
 *
 * **Nothing is invented.** The service returns exactly the fields the portal
 * sent. A missing trade name stays missing. Neither register returns
 * jurisdiction, so jurisdiction is always null rather than guessed from the
 * state code — which would look authoritative and be wrong.
 *
 * **Provenance travels with the data.** Every result says where it came from
 * and when. A cached row is labelled as cached with its age; a row that came
 * from the portal in this request is labelled fresh. The caller can then tell
 * a user "confirmed with the GST portal 3 days ago" instead of implying it was
 * checked just now.
 */

/** How a result reached the caller. */
export type LookupOrigin =
  /** The portal answered during this request. */
  | "portal"
  /** Served from this tenant's cache without calling the portal. */
  | "cache"
  /** Nothing was looked up: no GST integration is connected. */
  | "not_connected";

export interface GstinLookupResult {
  identifier: string;
  kind: "gstin" | "transin";
  origin: LookupOrigin;
  /** Which register answered, when one did. */
  source: "irp" | "ewb" | null;
  /** When the portal actually answered. Null when never fetched. */
  fetchedAt: Date | null;
  /** True when the cached copy is older than the staleness window. */
  stale: boolean;
  details: GstinDetails | TransporterDetails | null;
  /**
   * Field names populated from the portal. The UI marks exactly these as
   * fetched and leaves everything else as user-entered.
   */
  fetchedFields: string[];
}

export interface GstinLookupDeps {
  database: Database;
  registry: GatewayRegistry;
  credentials: CredentialService;
  audit: AuditWriter;
  environment: "sandbox" | "production";
}

/**
 * How long a cached record is treated as current.
 *
 * A registration can be cancelled at any time, so this is a comfort window
 * rather than a correctness guarantee — which is why `stale` is surfaced to
 * the caller instead of silently triggering a refetch. Seven days matches how
 * often a trader would plausibly re-confirm a counterparty.
 */
export const REGISTRY_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export class GstinLookupService {
  constructor(private readonly deps: GstinLookupDeps) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  /**
   * Validate an identifier without touching the network.
   *
   * Always available, including for a business that has never connected to
   * the portal. This is what makes requirement "manual entry stays fully
   * usable" true rather than aspirational.
   */
  validate(
    identifier: string,
    kind: "gstin" | "transin" = "gstin",
  ): {
    valid: boolean;
    normalised: string;
    reason?: string;
  } {
    const normalised = normaliseGstin(identifier);
    if (!normalised) return { valid: false, normalised: "", reason: "Enter a number to check" };
    if (kind === "transin") {
      return isValidTransin(normalised)
        ? { valid: true, normalised }
        : {
            valid: false,
            normalised,
            reason: "That is not a valid 15-character transporter ID",
          };
    }
    return isValidGstin(normalised)
      ? { valid: true, normalised }
      : { valid: false, normalised, reason: "That GSTIN is not valid — check for a typo" };
  }

  /** Read the cached copy without contacting any portal. */
  async cached(
    ctx: AuthContext,
    identifier: string,
    kind: "gstin" | "transin" = "gstin",
  ): Promise<GstinLookupResult | null> {
    const normalised = normaliseGstin(identifier);
    const [row] = await this.db
      .select()
      .from(gstinRegistry)
      .where(
        scoped(
          ctx,
          gstinRegistry,
          eq(gstinRegistry.kind, kind),
          eq(gstinRegistry.identifier, normalised),
        ),
      )
      .limit(1);
    return row ? toResult(row, "cache") : null;
  }

  /**
   * Look up a taxpayer, preferring the cache.
   *
   * `force` bypasses the cache — the refresh action. A forced refresh that
   * cannot reach the portal returns the cached copy marked stale rather than
   * failing, because losing the details a user already had would be worse
   * than showing them with an honest age.
   */
  async lookupGstin(
    ctx: AuthContext,
    gstin: string,
    options: { force?: boolean } = {},
  ): Promise<GstinLookupResult> {
    requirePermission(ctx, "parties:read");
    const check = this.validate(gstin, "gstin");
    if (!check.valid) throw new AppError("VALIDATION_FAILED", check.reason ?? "Invalid GSTIN");
    const normalised = check.normalised;

    if (!options.force) {
      const hit = await this.cached(ctx, normalised, "gstin");
      if (hit && !hit.stale) return hit;
    }

    const provider = await this.pickGstinProvider(ctx);
    if (!provider) {
      // No integration. Manual entry continues to work; say so plainly.
      return (await this.cached(ctx, normalised, "gstin")) ?? notConnected(normalised, "gstin");
    }

    /*
     * A refresh must actually refresh. The plain lookup serves the IRP's own
     * copy of the register, so re-reading it returns the same answer that was
     * already cached. The sync operation makes the IRP re-read the Common
     * Portal, which is what a user pressing "refresh" means.
     */
    const result =
      options.force && provider.sync
        ? await provider.sync(normalised)
        : await provider.call(normalised);
    if (!result.ok) {
      const fallback = await this.cached(ctx, normalised, "gstin");
      if (fallback) return { ...fallback, stale: true };
      throw new AppError(
        result.error.code === "CREDENTIALS_MISSING" ? "CREDENTIALS_MISSING" : "GATEWAY_ERROR",
        result.error.message,
        { retryable: result.error.retryable },
      );
    }

    const saved = await this.persist(ctx, "gstin", normalised, provider.source, result.data);
    await this.deps.audit.record(ctx, {
      action: "gstin.fetched",
      entityType: "gstin_registry",
      entityId: saved.id,
      summary: `Fetched ${normalised} from the ${provider.source === "irp" ? "e-Invoice" : "e-Way Bill"} portal`,
      metadata: { status: result.data.status, source: provider.source },
    });
    return toResult(saved, "portal");
  }

  /**
   * Look up an enrolled transporter by TRANSIN.
   *
   * Deliberately a separate method against a separate register. A TRANSIN
   * response carries no registration status, so this can never be used to
   * answer "is this GSTIN active?".
   */
  async lookupTransporter(
    ctx: AuthContext,
    transin: string,
    options: { force?: boolean } = {},
  ): Promise<GstinLookupResult> {
    requirePermission(ctx, "logistics:read");
    const check = this.validate(transin, "transin");
    if (!check.valid) throw new AppError("VALIDATION_FAILED", check.reason ?? "Invalid TRANSIN");
    const normalised = check.normalised;

    if (!options.force) {
      const hit = await this.cached(ctx, normalised, "transin");
      if (hit && !hit.stale) return hit;
    }

    const credentials = await this.resolve(ctx, "ewb");
    if (!credentials) {
      return (await this.cached(ctx, normalised, "transin")) ?? notConnected(normalised, "transin");
    }

    const provider = this.deps.registry.ewb(this.deps.environment);
    const result = await provider.getTransporterDetails(credentials, normalised);
    if (!result.ok) {
      const fallback = await this.cached(ctx, normalised, "transin");
      if (fallback) return { ...fallback, stale: true };
      throw new AppError(
        result.error.code === "CREDENTIALS_MISSING" ? "CREDENTIALS_MISSING" : "GATEWAY_ERROR",
        result.error.message,
        { retryable: result.error.retryable },
      );
    }

    const saved = await this.persist(ctx, "transin", normalised, "ewb", result.data);
    await this.deps.audit.record(ctx, {
      action: "transin.fetched",
      entityType: "gstin_registry",
      entityId: saved.id,
      summary: `Fetched transporter ${normalised} from the e-Way Bill portal`,
      metadata: { source: "ewb" },
    });
    return toResult(saved, "portal");
  }

  /**
   * Choose a register.
   *
   * The IRP is preferred: it returns a richer address breakdown. The e-Way
   * Bill portal is the fallback for a business that only has EWB credentials,
   * which is common for a transporter-heavy operation.
   */
  private async pickGstinProvider(ctx: AuthContext): Promise<{
    source: "irp" | "ewb";
    call: (gstin: string) => Promise<GatewayResult<GstinDetails>>;
    /** Only the IRP can re-read the Common Portal; the EWB register cannot. */
    sync?: (gstin: string) => Promise<GatewayResult<GstinDetails>>;
  } | null> {
    const irp = await this.resolve(ctx, "einvoice");
    if (irp) {
      const provider = this.deps.registry.einvoice(this.deps.environment);
      return {
        source: "irp",
        call: (gstin) => provider.getGstinDetails(irp, gstin),
        // Only the IRP can reach the Common Portal; the e-Way Bill register
        // has no equivalent, so a refresh there is just another read.
        sync: (gstin) => provider.syncGstinDetails(irp, gstin),
      };
    }
    const ewb = await this.resolve(ctx, "ewb");
    if (ewb) {
      const provider = this.deps.registry.ewb(this.deps.environment);
      return { source: "ewb", call: (gstin) => provider.getGstinDetails(ewb, gstin) };
    }
    return null;
  }

  /**
   * Build a gateway context from the tenant's own credentials.
   *
   * The lookup is made with the *tenant's* authorised integration and its own
   * GSTIN as the requester, never with a shared or platform credential.
   */
  private async resolve(
    ctx: AuthContext,
    service: "einvoice" | "ewb",
  ): Promise<GatewayRequestContext | null> {
    const list = await this.deps.credentials.list(ctx);
    const usable = list.find(
      (c) => c.service === service && c.environment === this.deps.environment,
    );
    if (!usable) return null;
    try {
      const { credentials } = await this.deps.credentials.resolve(ctx, {
        gstin: usable.gstin,
        service,
        environment: this.deps.environment,
      });
      return {
        tenantId: ctx.tenantId,
        gstin: usable.gstin,
        environment: this.deps.environment,
        credentials,
        idempotencyKey: `master.lookup:${service}:${usable.gstin}`,
        requestId: ctx.requestId,
      };
    } catch {
      // A disabled or undecryptable credential is the same as none for a
      // lookup: fall back to manual entry rather than failing the screen.
      return null;
    }
  }

  private async persist(
    ctx: AuthContext,
    kind: "gstin" | "transin",
    identifier: string,
    source: "irp" | "ewb",
    details: GstinDetails | TransporterDetails,
  ) {
    const gstinShaped = "status" in details ? details : null;
    const now = new Date();
    const values = {
      tenantId: ctx.tenantId,
      kind,
      identifier,
      legalName: details.legalName ?? null,
      tradeName: details.tradeName ?? null,
      status: gstinShaped?.status ?? null,
      statusRaw: gstinShaped?.statusRaw ?? null,
      taxpayerType: gstinShaped?.taxpayerType ?? null,
      blockStatus: gstinShaped?.blockStatus ?? null,
      addressLine1: details.addressLine1 ?? null,
      addressLine2: details.addressLine2 ?? null,
      street: gstinShaped?.street ?? null,
      location: gstinShaped?.location ?? null,
      floorNumber: gstinShaped?.floorNumber ?? null,
      buildingNumber: gstinShaped?.buildingNumber ?? null,
      buildingName: gstinShaped?.buildingName ?? null,
      stateCode: details.stateCode ?? null,
      pincode: details.pincode ?? null,
      registeredOn: gstinShaped?.registeredOn ?? null,
      deregisteredOn: gstinShaped?.deregisteredOn ?? null,
      jurisdiction: gstinShaped?.jurisdiction ?? null,
      source,
      environment: this.deps.environment,
      raw: details as unknown as Record<string, unknown>,
      fetchedAt: now,
      updatedAt: now,
    };

    const [row] = await this.db
      .insert(gstinRegistry)
      .values(values)
      .onConflictDoUpdate({
        target: [gstinRegistry.tenantId, gstinRegistry.kind, gstinRegistry.identifier],
        set: values,
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the fetched details");
    return row;
  }

  /** Everything this tenant has ever looked up, newest first. */
  async list(ctx: AuthContext, kind?: "gstin" | "transin") {
    requirePermission(ctx, "parties:read");
    const rows = await this.db
      .select()
      .from(gstinRegistry)
      .where(
        kind
          ? scoped(ctx, gstinRegistry, eq(gstinRegistry.kind, kind))
          : scoped(ctx, gstinRegistry),
      );
    return rows.map((row) => toResult(row, "cache"));
  }
}

type RegistryRow = typeof gstinRegistry.$inferSelect;

function toResult(row: RegistryRow, origin: "cache" | "portal"): GstinLookupResult {
  const details =
    row.kind === "transin"
      ? ({
          transin: row.identifier,
          legalName: row.legalName,
          tradeName: row.tradeName,
          addressLine1: row.addressLine1,
          addressLine2: row.addressLine2,
          stateCode: row.stateCode,
          pincode: row.pincode,
        } satisfies TransporterDetails)
      : ({
          gstin: row.identifier,
          legalName: row.legalName,
          tradeName: row.tradeName,
          status: (row.status ?? "UNKNOWN") as GstinDetails["status"],
          statusRaw: row.statusRaw,
          taxpayerType: row.taxpayerType,
          blockStatus: (row.blockStatus ?? "unknown") as GstinDetails["blockStatus"],
          addressLine1: row.addressLine1,
          addressLine2: row.addressLine2,
          street: row.street,
          location: row.location,
          floorNumber: row.floorNumber,
          buildingNumber: row.buildingNumber,
          buildingName: row.buildingName,
          stateCode: row.stateCode,
          pincode: row.pincode,
          registeredOn: row.registeredOn,
          deregisteredOn: row.deregisteredOn,
          jurisdiction: row.jurisdiction,
        } satisfies GstinDetails);

  return {
    identifier: row.identifier,
    kind: row.kind as "gstin" | "transin",
    origin,
    source: row.source as "irp" | "ewb",
    fetchedAt: row.fetchedAt,
    stale: Date.now() - row.fetchedAt.getTime() > REGISTRY_STALE_AFTER_MS,
    details,
    fetchedFields: populatedFields(details),
  };
}

/** Exactly the fields the portal filled in — the basis for the UI's badges. */
function populatedFields(details: GstinDetails | TransporterDetails): string[] {
  return Object.entries(details)
    .filter(
      ([key, value]) => key !== "gstin" && key !== "transin" && value !== null && value !== "",
    )
    .map(([key]) => key);
}

function notConnected(identifier: string, kind: "gstin" | "transin"): GstinLookupResult {
  return {
    identifier,
    kind,
    origin: "not_connected",
    source: null,
    fetchedAt: null,
    stale: false,
    details: null,
    fetchedFields: [],
  };
}
