import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@traxac/database";
import {
  gstins,
  parties,
  paymentTerms,
  taxSettings,
  hsnCodes,
  requireScope,
} from "@traxac/database";
import { AppError } from "@traxac/shared";
import type { PaymentTermInput, TaxSettingsInput } from "@traxac/shared/contracts";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";

/**
 * Commercial configuration: payment terms, per-registration tax settings and
 * the HSN master. Small surface, but it is what stops the invoice form asking
 * the same questions on every sale.
 */
export class CommercialService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  /* --------------------------- Payment terms --------------------------- */

  async listPaymentTerms(ctx: AuthContext, gstinId?: string) {
    return this.db
      .select()
      .from(paymentTerms)
      .where(
        scoped(
          ctx,
          paymentTerms,
          eq(paymentTerms.isActive, true),
          // Terms with no registration are shared by all of them.
          gstinId
            ? sql`(${paymentTerms.gstinId} = ${gstinId} OR ${paymentTerms.gstinId} IS NULL)`
            : undefined,
        ),
      )
      .orderBy(desc(paymentTerms.isDefault), asc(paymentTerms.creditDays));
  }

  async createPaymentTerm(ctx: AuthContext, input: PaymentTermInput, gstinId?: string) {
    requirePermission(ctx, "settings:write");
    const [row] = await this.db
      .insert(paymentTerms)
      .values({
        tenantId: ctx.tenantId,
        gstinId: gstinId ?? null,
        name: input.name,
        creditDays: input.creditDays,
        description: input.description || null,
        isDefault: input.isDefault,
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not save the payment terms");

    // Only one default per tenant, or the invoice form has to guess.
    if (input.isDefault) await this.clearOtherDefaults(ctx, row.id);

    await this.audit.record(ctx, {
      action: "payment_terms.created",
      entityType: "payment_terms",
      entityId: row.id,
      summary: `${row.name} (${row.creditDays} days)`,
    });
    return row;
  }

  async updatePaymentTerm(ctx: AuthContext, id: string, input: Partial<PaymentTermInput>) {
    requirePermission(ctx, "settings:write");
    const [row] = await this.db
      .update(paymentTerms)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        updatedAt: new Date(),
      })
      .where(scopedById(ctx, paymentTerms, id))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Payment terms not found");
    if (input.isDefault) await this.clearOtherDefaults(ctx, id);
    await this.audit.record(ctx, {
      action: "payment_terms.updated",
      entityType: "payment_terms",
      entityId: id,
    });
    return row;
  }

  async archivePaymentTerm(ctx: AuthContext, id: string) {
    requirePermission(ctx, "settings:write");
    await this.db
      .update(paymentTerms)
      .set({ isActive: false, updatedAt: new Date() })
      .where(scopedById(ctx, paymentTerms, id));
    await this.audit.record(ctx, {
      action: "payment_terms.archived",
      entityType: "payment_terms",
      entityId: id,
    });
  }

  private async clearOtherDefaults(ctx: AuthContext, keepId: string): Promise<void> {
    await this.db
      .update(paymentTerms)
      .set({ isDefault: false })
      .where(and(eq(paymentTerms.tenantId, ctx.tenantId), ne(paymentTerms.id, keepId)));
  }

  /* ---------------------------- Tax settings --------------------------- */

  async getTaxSettings(ctx: AuthContext, gstinId: string) {
    const [row] = await this.db
      .select()
      .from(taxSettings)
      .where(and(eq(taxSettings.tenantId, ctx.tenantId), eq(taxSettings.gstinId, gstinId)))
      .limit(1);
    return (
      row ?? {
        gstinId,
        tenantId: ctx.tenantId,
        tcsEnabled: false,
        tcsRate: "0.1",
        tcsSection: "206C(1H)",
        roundOffEnabled: true,
        igstOnIntraDefault: false,
      }
    );
  }

  async saveTaxSettings(ctx: AuthContext, gstinId: string, input: TaxSettingsInput) {
    requirePermission(ctx, "settings:write");
    // Ownership check: the registration must belong to this tenant.
    const [gstin] = await this.db
      .select({ id: gstins.id })
      .from(gstins)
      .where(scopedById(ctx, gstins, gstinId))
      .limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "GSTIN registration not found");

    const values = {
      gstinId,
      tenantId: ctx.tenantId,
      tcsEnabled: input.tcsEnabled,
      tcsRate: String(input.tcsRate),
      tcsSection: input.tcsSection,
      roundOffEnabled: input.roundOffEnabled,
      igstOnIntraDefault: input.igstOnIntraDefault,
      updatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(taxSettings)
      .values(values)
      .onConflictDoUpdate({ target: taxSettings.gstinId, set: values })
      .returning();

    await this.audit.record(ctx, {
      action: "tax_settings.updated",
      entityType: "gstin",
      entityId: gstinId,
      summary: input.tcsEnabled ? `TCS on at ${input.tcsRate}%` : "TCS off",
    });
    return row;
  }

  /* ----------------------------- HSN master ---------------------------- */

  /**
   * HSN codes are global reference data, not tenant data — the code for mill
   * scale is the same for everyone. Tenants may add codes the seed list is
   * missing, which then benefit every tenant.
   */
  async upsertHsn(
    ctx: AuthContext,
    input: { code: string; description: string; defaultGstRate?: number; isService: boolean },
  ) {
    requirePermission(ctx, "products:write");
    const [row] = await this.db
      .insert(hsnCodes)
      .values({
        code: input.code,
        description: input.description,
        defaultGstRate: input.defaultGstRate !== undefined ? String(input.defaultGstRate) : null,
        isService: input.isService,
      })
      .onConflictDoUpdate({
        target: hsnCodes.code,
        set: { description: input.description, isService: input.isService },
      })
      .returning();
    return row;
  }

  /* ------------------------- Party payment terms ------------------------ */

  async setPartyPaymentTerms(ctx: AuthContext, partyId: string, paymentTermsId: string | null) {
    requirePermission(ctx, "parties:write");
    const [row] = await this.db
      .update(parties)
      .set({ paymentTermsId, updatedAt: new Date() })
      .where(scopedById(ctx, parties, partyId))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Customer not found");
    return row;
  }
}
