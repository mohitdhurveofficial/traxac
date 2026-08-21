import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@ewayvo/database";
import {
  einvoices,
  ewayBills,
  gstins,
  invoices,
  reconciliationItems,
  reconciliationRuns,
  requireScope,
} from "@ewayvo/database";
import { AppError } from "@ewayvo/shared";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";

/**
 * Reconciliation between our books and the government's records.
 *
 * The portal is the system of record for filed documents. Ours and theirs can
 * diverge — a document filed outside Ewayvo, one cancelled directly on the
 * portal, an amount amended. This service holds the comparison.
 *
 * **No live portal fetch exists yet.** `ExternalDocumentSource` is the seam a
 * future portal sync plugs into; today the only implementations are an upload
 * and a manual entry. Nothing here invents a government record.
 */

/** One document as the government sees it. */
export interface ExternalDocument {
  documentNumber: string;
  documentDate: Date;
  counterpartyGstin?: string | null;
  value: number;
  irn?: string | null;
  ewbNumber?: string | null;
  status?: string | null;
  raw?: unknown;
}

/**
 * Where external documents come from.
 *
 * Implement this against the portal once credentials exist; the comparison
 * logic below does not change.
 */
export interface ExternalDocumentSource {
  readonly id: string;
  /** Fetch what the government holds for a registration and period. */
  fetch(input: {
    gstin: string;
    period: string;
    scope: "einvoice" | "ewb" | "gstr1";
  }): Promise<ExternalDocument[]>;
}

/** An upload-driven source: the user gives us the portal's own export. */
export class UploadedDocumentSource implements ExternalDocumentSource {
  readonly id = "upload";
  constructor(private readonly documents: ExternalDocument[]) {}
  async fetch(): Promise<ExternalDocument[]> {
    return this.documents;
  }
}

export type MatchStatus = "matched" | "mismatched" | "missing_locally" | "missing_remotely";

export class ReconciliationService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  /**
   * Compare a period.
   *
   * `source` is required and has no default: there is no portal connection,
   * and silently reconciling against nothing would report every document as
   * missing remotely — worse than refusing.
   */
  async run(
    ctx: AuthContext,
    input: { gstinId: string; scope: "einvoice" | "ewb" | "gstr1"; period: string },
    source: ExternalDocumentSource,
  ) {
    requirePermission(ctx, "reports:read");

    const [gstin] = await this.db
      .select()
      .from(gstins)
      .where(scopedById(ctx, gstins, input.gstinId))
      .limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "GSTIN registration not found");

    const [run] = await this.db
      .insert(reconciliationRuns)
      .values({
        tenantId: ctx.tenantId,
        gstinId: input.gstinId,
        scope: input.scope,
        period: input.period,
        status: "running",
        source: source.id,
        startedAt: new Date(),
        createdByUserId: ctx.actor === "system" ? null : ctx.userId,
      })
      .onConflictDoUpdate({
        target: [
          reconciliationRuns.tenantId,
          reconciliationRuns.gstinId,
          reconciliationRuns.scope,
          reconciliationRuns.period,
        ],
        set: { status: "running", source: source.id, startedAt: new Date(), lastError: null },
      })
      .returning();
    if (!run) throw new AppError("INTERNAL", "Could not start the reconciliation");

    // A re-run replaces the previous comparison rather than appending to it.
    await this.db.delete(reconciliationItems).where(eq(reconciliationItems.runId, run.id));

    try {
      const external = await source.fetch({
        gstin: gstin.gstin,
        period: input.period,
        scope: input.scope,
      });
      const local = await this.localDocuments(ctx, input.gstinId, input.period, input.scope);

      const byNumber = new Map(
        external.map((doc) => [doc.documentNumber.trim().toUpperCase(), doc]),
      );
      const seen = new Set<string>();
      const rows: Array<typeof reconciliationItems.$inferInsert> = [];
      const tally = { matched: 0, mismatched: 0, missingLocally: 0, missingRemotely: 0 };

      for (const doc of local) {
        const key = doc.invoiceNumber.trim().toUpperCase();
        const remote = byNumber.get(key);
        if (!remote) {
          tally.missingRemotely += 1;
          rows.push({
            tenantId: ctx.tenantId,
            runId: run.id,
            invoiceId: doc.id,
            matchStatus: "missing_remotely",
            documentNumber: doc.invoiceNumber,
            documentDate: doc.invoiceDate,
            counterpartyGstin: doc.buyerGstin,
            ourValue: doc.grandTotal,
            irn: doc.irn,
            ewbNumber: doc.ewbNumber,
            errorDetail: "We have this document; the government record does not",
          });
          continue;
        }

        seen.add(key);
        const differences = compare(doc, remote);
        const status: MatchStatus = Object.keys(differences).length ? "mismatched" : "matched";
        if (status === "matched") tally.matched += 1;
        else tally.mismatched += 1;

        rows.push({
          tenantId: ctx.tenantId,
          runId: run.id,
          invoiceId: doc.id,
          matchStatus: status,
          differences: Object.keys(differences).length ? differences : null,
          documentNumber: doc.invoiceNumber,
          documentDate: doc.invoiceDate,
          counterpartyGstin: doc.buyerGstin,
          ourValue: doc.grandTotal,
          theirValue: remote.value,
          irn: doc.irn ?? remote.irn ?? null,
          ewbNumber: doc.ewbNumber ?? remote.ewbNumber ?? null,
          externalPayload: remote.raw ?? null,
        });
      }

      for (const [key, remote] of byNumber) {
        if (seen.has(key)) continue;
        tally.missingLocally += 1;
        rows.push({
          tenantId: ctx.tenantId,
          runId: run.id,
          matchStatus: "missing_locally",
          documentNumber: remote.documentNumber,
          documentDate: remote.documentDate,
          counterpartyGstin: remote.counterpartyGstin ?? null,
          theirValue: remote.value,
          irn: remote.irn ?? null,
          ewbNumber: remote.ewbNumber ?? null,
          externalPayload: remote.raw ?? null,
          errorDetail: "The government has this document; we have no record of it",
        });
      }

      if (rows.length) await this.db.insert(reconciliationItems).values(rows);

      const [completed] = await this.db
        .update(reconciliationRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          matched: String(tally.matched),
          mismatched: String(tally.mismatched),
          missingLocally: String(tally.missingLocally),
          missingRemotely: String(tally.missingRemotely),
          updatedAt: new Date(),
        })
        .where(eq(reconciliationRuns.id, run.id))
        .returning();

      await this.audit.record(ctx, {
        action: "reconciliation.completed",
        entityType: "gstin",
        entityId: input.gstinId,
        summary: `${input.scope} ${input.period}: ${tally.matched} matched, ${tally.mismatched} differ`,
        metadata: { ...tally, source: source.id },
      });

      return { run: completed, ...tally };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(reconciliationRuns)
        .set({ status: "failed", lastError: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(reconciliationRuns.id, run.id));
      throw err;
    }
  }

  async listRuns(ctx: AuthContext, gstinId?: string) {
    return this.db
      .select()
      .from(reconciliationRuns)
      .where(
        scoped(
          ctx,
          reconciliationRuns,
          gstinId ? eq(reconciliationRuns.gstinId, gstinId) : undefined,
        ),
      )
      .orderBy(desc(reconciliationRuns.createdAt))
      .limit(50);
  }

  async listItems(ctx: AuthContext, runId: string, status?: MatchStatus) {
    return this.db
      .select()
      .from(reconciliationItems)
      .where(
        scoped(
          ctx,
          reconciliationItems,
          eq(reconciliationItems.runId, runId),
          status ? eq(reconciliationItems.matchStatus, status) : undefined,
        ),
      )
      .orderBy(desc(reconciliationItems.reconciledAt))
      .limit(500);
  }

  /** Our side of the comparison. */
  private async localDocuments(ctx: AuthContext, gstinId: string, period: string, _scope: string) {
    const [year, month] = period.split("-").map(Number);
    const from = new Date(Date.UTC(year as number, (month as number) - 1, 1) - 330 * 60_000);
    const to = new Date(Date.UTC(year as number, month as number, 1) - 330 * 60_000 - 1);

    return this.db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        grandTotal: invoices.grandTotal,
        buyerGstin: sql<string>`${invoices.billTo}->>'gstin'`,
        irn: einvoices.irn,
        ewbNumber: ewayBills.ewbNumber,
      })
      .from(invoices)
      .leftJoin(einvoices, eq(einvoices.invoiceId, invoices.id))
      .leftJoin(ewayBills, eq(ewayBills.invoiceId, invoices.id))
      .where(
        scoped(
          ctx,
          invoices,
          eq(invoices.gstinId, gstinId),
          gte(invoices.invoiceDate, from),
          lte(invoices.invoiceDate, to),
          ne(invoices.status, "draft"),
        ),
      );
  }
}

/**
 * What differs between our record and theirs.
 *
 * Money is compared to the rupee: sub-rupee drift is rounding, not a
 * discrepancy worth showing a human.
 */
function compare(
  ours: { grandTotal: number; irn: string | null; ewbNumber: string | null },
  theirs: ExternalDocument,
): Record<string, [unknown, unknown]> {
  const differences: Record<string, [unknown, unknown]> = {};

  if (Math.abs(ours.grandTotal - theirs.value) >= 100) {
    differences["value"] = [ours.grandTotal, theirs.value];
  }
  if (theirs.irn && ours.irn && theirs.irn !== ours.irn) {
    differences["irn"] = [ours.irn, theirs.irn];
  }
  if (theirs.ewbNumber && ours.ewbNumber && theirs.ewbNumber !== ours.ewbNumber) {
    differences["ewbNumber"] = [ours.ewbNumber, theirs.ewbNumber];
  }
  return differences;
}

export { and };
