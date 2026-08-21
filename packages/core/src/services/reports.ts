import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@traxac/database";
import {
  einvoices,
  ewayBills,
  invoiceLines,
  invoices,
  parties,
  requireScope,
} from "@traxac/database";
import { financialYear, financialYearStart, financialYearEnd } from "@traxac/shared";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped } from "../auth/tenant-guard.js";
import { countExpr } from "./query.js";

export interface DateWindow {
  from: Date;
  to: Date;
}

/** Everything on the home screen, in one round trip. */
export interface DashboardSummary {
  window: DateWindow;
  totals: {
    invoiceCount: number;
    taxableValue: number;
    totalTax: number;
    grandTotal: number;
    outstanding: number;
  };
  needsAttention: {
    drafts: number;
    einvoicePending: number;
    einvoiceFailed: number;
    ewbPending: number;
    ewbFailed: number;
    ewbExpiringSoon: number;
    overdue: number;
  };
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: Date;
    buyerName: string;
    grandTotal: number;
    status: string;
    einvoiceStatus: string;
    ewbStatus: string;
  }>;
  monthly: Array<{ month: string; taxableValue: number; totalTax: number; grandTotal: number }>;
}

/**
 * Reporting. Queries are written against the invoice header, whose totals are
 * denormalised at write time, so a dashboard never has to re-run the tax
 * engine over every line.
 */
export class ReportService {
  constructor(private readonly database: Database) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  private defaultWindow(): DateWindow {
    const fy = financialYear(new Date());
    return { from: financialYearStart(fy), to: financialYearEnd(fy) };
  }

  async dashboard(ctx: AuthContext, window?: Partial<DateWindow>): Promise<DashboardSummary> {
    const range: DateWindow = {
      from: window?.from ?? this.defaultWindow().from,
      to: window?.to ?? this.defaultWindow().to,
    };
    const inWindow = scoped(
      ctx,
      invoices,
      gte(invoices.invoiceDate, range.from),
      lte(invoices.invoiceDate, range.to),
      ne(invoices.status, "cancelled"),
      ne(invoices.status, "draft"),
    );

    const soon = new Date(Date.now() + 24 * 3_600_000);

    const [totals, attention, recent, monthly] = await Promise.all([
      this.db
        .select({
          invoiceCount: countExpr,
          taxableValue: sql<number>`COALESCE(SUM(${invoices.taxableValue}), 0)::bigint`,
          totalTax: sql<number>`COALESCE(SUM(${invoices.totalTax}), 0)::bigint`,
          grandTotal: sql<number>`COALESCE(SUM(${invoices.grandTotal}), 0)::bigint`,
          outstanding: sql<number>`COALESCE(SUM(${invoices.grandTotal} - ${invoices.amountPaid}), 0)::bigint`,
        })
        .from(invoices)
        .where(inWindow),

      this.db
        .select({
          drafts: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} = 'draft')::int`,
          einvoicePending: sql<number>`COUNT(*) FILTER (WHERE ${invoices.einvoiceStatus} IN ('pending','queued','processing'))::int`,
          einvoiceFailed: sql<number>`COUNT(*) FILTER (WHERE ${invoices.einvoiceStatus} = 'failed')::int`,
          ewbPending: sql<number>`COUNT(*) FILTER (WHERE ${invoices.ewbStatus} IN ('pending','queued','processing','part_b_pending'))::int`,
          ewbFailed: sql<number>`COUNT(*) FILTER (WHERE ${invoices.ewbStatus} = 'failed')::int`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${invoices.dueDate} < now() AND ${invoices.amountPaid} < ${invoices.grandTotal} AND ${invoices.status} NOT IN ('cancelled','draft'))::int`,
        })
        .from(invoices)
        .where(scoped(ctx, invoices)),

      this.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          buyerName: sql<string>`${invoices.billTo}->>'name'`,
          grandTotal: invoices.grandTotal,
          status: invoices.status,
          einvoiceStatus: invoices.einvoiceStatus,
          ewbStatus: invoices.ewbStatus,
        })
        .from(invoices)
        .where(scoped(ctx, invoices))
        .orderBy(desc(invoices.createdAt))
        .limit(8),

      this.db
        .select({
          month: sql<string>`to_char(${invoices.invoiceDate} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`,
          taxableValue: sql<number>`COALESCE(SUM(${invoices.taxableValue}), 0)::bigint`,
          totalTax: sql<number>`COALESCE(SUM(${invoices.totalTax}), 0)::bigint`,
          grandTotal: sql<number>`COALESCE(SUM(${invoices.grandTotal}), 0)::bigint`,
        })
        .from(invoices)
        .where(inWindow)
        .groupBy(sql`to_char(${invoices.invoiceDate} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`)
        .orderBy(asc(sql`to_char(${invoices.invoiceDate} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`)),
    ]);

    const [expiring] = await this.db
      .select({ n: countExpr })
      .from(ewayBills)
      .where(
        scoped(ctx, ewayBills, eq(ewayBills.status, "generated"), lte(ewayBills.validUntil, soon)),
      );

    const t = totals[0];
    const a = attention[0];
    return {
      window: range,
      totals: {
        invoiceCount: Number(t?.invoiceCount ?? 0),
        taxableValue: Number(t?.taxableValue ?? 0),
        totalTax: Number(t?.totalTax ?? 0),
        grandTotal: Number(t?.grandTotal ?? 0),
        outstanding: Number(t?.outstanding ?? 0),
      },
      needsAttention: {
        drafts: a?.drafts ?? 0,
        einvoicePending: a?.einvoicePending ?? 0,
        einvoiceFailed: a?.einvoiceFailed ?? 0,
        ewbPending: a?.ewbPending ?? 0,
        ewbFailed: a?.ewbFailed ?? 0,
        ewbExpiringSoon: expiring?.n ?? 0,
        overdue: a?.overdue ?? 0,
      },
      recentInvoices: recent.map((r) => ({ ...r, grandTotal: Number(r.grandTotal) })),
      monthly: monthly.map((m) => ({
        month: m.month,
        taxableValue: Number(m.taxableValue),
        totalTax: Number(m.totalTax),
        grandTotal: Number(m.grandTotal),
      })),
    };
  }

  /** HSN-wise outward supply summary — the shape GSTR-1 Table 12 needs. */
  async hsnSummary(ctx: AuthContext, window: DateWindow) {
    requirePermission(ctx, "reports:read");
    const rows = await this.db
      .select({
        hsnSac: invoiceLines.hsnSac,
        unit: invoiceLines.unit,
        gstRate: invoiceLines.gstRate,
        quantity: sql<string>`COALESCE(SUM(${invoiceLines.quantity}), 0)`,
        taxableValue: sql<number>`COALESCE(SUM(${invoiceLines.taxableValue}), 0)::bigint`,
        cgst: sql<number>`COALESCE(SUM(${invoiceLines.cgst}), 0)::bigint`,
        sgst: sql<number>`COALESCE(SUM(${invoiceLines.sgst}), 0)::bigint`,
        igst: sql<number>`COALESCE(SUM(${invoiceLines.igst}), 0)::bigint`,
        cess: sql<number>`COALESCE(SUM(${invoiceLines.cess} + ${invoiceLines.cessNonAdvol}), 0)::bigint`,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(
        and(
          eq(invoiceLines.tenantId, ctx.tenantId),
          gte(invoices.invoiceDate, window.from),
          lte(invoices.invoiceDate, window.to),
          ne(invoices.status, "cancelled"),
          ne(invoices.status, "draft"),
        ),
      )
      .groupBy(invoiceLines.hsnSac, invoiceLines.unit, invoiceLines.gstRate)
      .orderBy(asc(invoiceLines.hsnSac));

    return rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      taxableValue: Number(r.taxableValue),
      cgst: Number(r.cgst),
      sgst: Number(r.sgst),
      igst: Number(r.igst),
      cess: Number(r.cess),
      total:
        Number(r.taxableValue) + Number(r.cgst) + Number(r.sgst) + Number(r.igst) + Number(r.cess),
    }));
  }

  /** B2B outward supplies with IRN and EWB references — the sales register. */
  async salesRegister(ctx: AuthContext, window: DateWindow) {
    requirePermission(ctx, "reports:read");
    const rows = await this.db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        docType: invoices.docType,
        buyerName: sql<string>`${invoices.billTo}->>'name'`,
        buyerGstin: sql<string>`${invoices.billTo}->>'gstin'`,
        placeOfSupply: invoices.placeOfSupply,
        taxableValue: invoices.taxableValue,
        cgst: invoices.cgst,
        sgst: invoices.sgst,
        igst: invoices.igst,
        cess: invoices.cess,
        grandTotal: invoices.grandTotal,
        status: invoices.status,
        irn: einvoices.irn,
        ackNumber: einvoices.ackNumber,
        ewbNumber: ewayBills.ewbNumber,
      })
      .from(invoices)
      .leftJoin(einvoices, eq(einvoices.invoiceId, invoices.id))
      .leftJoin(ewayBills, eq(ewayBills.invoiceId, invoices.id))
      .where(
        scoped(
          ctx,
          invoices,
          gte(invoices.invoiceDate, window.from),
          lte(invoices.invoiceDate, window.to),
          ne(invoices.status, "draft"),
        ),
      )
      .orderBy(asc(invoices.invoiceDate), asc(invoices.invoiceNumber));
    return rows;
  }

  /** Who owes what, oldest first. */
  async outstandingByParty(ctx: AuthContext) {
    requirePermission(ctx, "reports:read");
    return this.db
      .select({
        partyId: invoices.buyerPartyId,
        partyName: sql<string>`${invoices.billTo}->>'name'`,
        invoiceCount: countExpr,
        outstanding: sql<number>`SUM(${invoices.grandTotal} - ${invoices.amountPaid})::bigint`,
        oldestDueDate: sql<Date>`MIN(${invoices.dueDate})`,
      })
      .from(invoices)
      .where(
        scoped(
          ctx,
          invoices,
          ne(invoices.status, "cancelled"),
          ne(invoices.status, "draft"),
          sql`${invoices.amountPaid} < ${invoices.grandTotal}`,
        ),
      )
      .groupBy(invoices.buyerPartyId, sql`${invoices.billTo}->>'name'`)
      .orderBy(desc(sql`SUM(${invoices.grandTotal} - ${invoices.amountPaid})`));
  }

  /** e-Way Bill register with validity, for the transport desk. */
  async ewbRegister(ctx: AuthContext, window: DateWindow) {
    requirePermission(ctx, "reports:read");
    return this.db
      .select({
        ewbNumber: ewayBills.ewbNumber,
        status: ewayBills.status,
        generatedAt: ewayBills.generatedAt,
        validUntil: ewayBills.validUntil,
        distanceKm: ewayBills.distanceKm,
        vehicleNo: ewayBills.vehicleNo,
        transporterName: ewayBills.transporterName,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        buyerName: sql<string>`${invoices.billTo}->>'name'`,
        grandTotal: invoices.grandTotal,
      })
      .from(ewayBills)
      .innerJoin(invoices, eq(invoices.id, ewayBills.invoiceId))
      .where(
        scoped(
          ctx,
          ewayBills,
          gte(ewayBills.createdAt, window.from),
          lte(ewayBills.createdAt, window.to),
        ),
      )
      .orderBy(desc(ewayBills.generatedAt));
  }

  /** Top customers by turnover in the window. */
  async topCustomers(ctx: AuthContext, window: DateWindow, limit = 10) {
    return this.db
      .select({
        partyId: invoices.buyerPartyId,
        name: sql<string>`${invoices.billTo}->>'name'`,
        gstin: sql<string>`${invoices.billTo}->>'gstin'`,
        invoiceCount: countExpr,
        grandTotal: sql<number>`SUM(${invoices.grandTotal})::bigint`,
      })
      .from(invoices)
      .where(
        scoped(
          ctx,
          invoices,
          gte(invoices.invoiceDate, window.from),
          lte(invoices.invoiceDate, window.to),
          ne(invoices.status, "cancelled"),
          ne(invoices.status, "draft"),
        ),
      )
      .groupBy(
        invoices.buyerPartyId,
        sql`${invoices.billTo}->>'name'`,
        sql`${invoices.billTo}->>'gstin'`,
      )
      .orderBy(desc(sql`SUM(${invoices.grandTotal})`))
      .limit(limit);
  }
}

export { parties };
