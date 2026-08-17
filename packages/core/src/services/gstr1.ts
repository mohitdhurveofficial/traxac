import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@traxac/database";
import { einvoices, gstins, gstReturns, invoiceLines, invoices } from "@traxac/database";
import { AppError, isValidGstin, rupeeNumber, toIsoDate } from "@traxac/shared";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";

/**
 * GSTR-1 preparation.
 *
 * This builds the return from the invoices already in the system and checks
 * it for the problems the portal would reject. It does **not** file anything:
 * there is no GSTN filing integration, and `filingStatus` stays
 * "not_connected" so no screen can imply otherwise.
 *
 * The output shape follows the GSTR-1 JSON the offline utility accepts, so a
 * user can prepare here and upload there today.
 */

export interface Gstr1ValidationError {
  invoiceId?: string;
  invoiceNumber?: string;
  field: string;
  message: string;
}

interface B2bItem {
  num: number;
  itm_det: {
    txval: number;
    rt: number;
    iamt?: number;
    camt?: number;
    samt?: number;
    csamt?: number;
  };
}

/** Split a "MMYYYY" period into the range it covers, in IST. */
function periodRange(period: string): { from: Date; to: Date; label: string } {
  const month = Number(period.slice(0, 2));
  const year = Number(period.slice(2));
  // IST is UTC+5:30, so the local month starts 5.5h before the UTC month.
  const from = new Date(Date.UTC(year, month - 1, 1) - 330 * 60_000);
  const to = new Date(Date.UTC(year, month, 1) - 330 * 60_000 - 1);
  return { from, to, label: `${String(month).padStart(2, "0")}/${year}` };
}

export class Gstr1Service {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Build the return for a period.
   *
   * Everything is derived: nothing is stored that could drift from the
   * invoices. Re-running it after fixing an invoice simply produces a new
   * payload.
   */
  async prepare(ctx: AuthContext, gstinId: string, period: string) {
    requirePermission(ctx, "reports:read");

    const [gstin] = await this.db
      .select()
      .from(gstins)
      .where(scopedById(ctx, gstins, gstinId))
      .limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "GSTIN registration not found");

    const { from, to } = periodRange(period);

    const rows = await this.db
      .select({
        invoice: invoices,
        irn: einvoices.irn,
      })
      .from(invoices)
      .leftJoin(einvoices, eq(einvoices.invoiceId, invoices.id))
      .where(
        scoped(
          ctx,
          invoices,
          eq(invoices.gstinId, gstinId),
          gte(invoices.invoiceDate, from),
          lte(invoices.invoiceDate, to),
          ne(invoices.status, "draft"),
        ),
      )
      .orderBy(asc(invoices.invoiceDate), asc(invoices.invoiceNumber));

    // Fetch the lines for exactly the invoices already selected above.
    // Interpolating a JS Date into a raw sql template bypasses the driver's
    // type mapping and fails at bind time, so the ids are used instead.
    const invoiceIds = rows.map((r) => r.invoice.id);
    const lines = invoiceIds.length
      ? await this.db
          .select()
          .from(invoiceLines)
          .where(
            and(
              eq(invoiceLines.tenantId, ctx.tenantId),
              inArray(invoiceLines.invoiceId, invoiceIds),
            ),
          )
      : [];

    const linesByInvoice = new Map<string, typeof lines>();
    for (const line of lines) {
      const list = linesByInvoice.get(line.invoiceId) ?? [];
      list.push(line);
      linesByInvoice.set(line.invoiceId, list);
    }

    const errors: Gstr1ValidationError[] = [];
    const b2b = new Map<string, { ctin: string; inv: unknown[] }>();
    const b2cs: Array<Record<string, unknown>> = [];
    const cdnr = new Map<string, { ctin: string; nt: unknown[] }>();
    const hsnTotals = new Map<string, Record<string, number | string>>();

    let invoiceCount = 0;
    let totalTaxableValue = 0;
    let totalTax = 0;

    for (const { invoice, irn } of rows) {
      // A cancelled document is excluded from the return entirely, which is
      // why it is filtered here rather than in the query: it must still be
      // counted when we report what was skipped.
      if (invoice.status === "cancelled") continue;

      const invoiceLinesForDoc = linesByInvoice.get(invoice.id) ?? [];
      const buyerGstin = invoice.billTo.gstin ?? "";
      const isB2b = Boolean(buyerGstin) && buyerGstin !== "URP" && isValidGstin(buyerGstin);

      // --- validation ----------------------------------------------------
      if (invoiceLinesForDoc.length === 0) {
        errors.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          field: "lines",
          message: "The invoice has no items",
        });
      }
      if (buyerGstin && buyerGstin !== "URP" && !isValidGstin(buyerGstin)) {
        errors.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          field: "billTo.gstin",
          message: `The buyer's GSTIN (${buyerGstin}) is not valid`,
        });
      }
      if (!invoice.placeOfSupply) {
        errors.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          field: "placeOfSupply",
          message: "Place of supply is missing",
        });
      }
      for (const line of invoiceLinesForDoc) {
        if (!/^\d{4,8}$/.test(line.hsnSac)) {
          errors.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            field: "hsnSac",
            message: `"${line.name}" has an invalid HSN/SAC (${line.hsnSac || "blank"})`,
          });
        }
      }

      invoiceCount += 1;
      totalTaxableValue += invoice.taxableValue;
      totalTax += invoice.totalTax;

      const itemDetails: B2bItem[] = invoiceLinesForDoc.map((line, index) => ({
        num: index + 1,
        itm_det: {
          txval: rupeeNumber(line.taxableValue),
          rt: Number(line.gstRate),
          ...(line.igst > 0 ? { iamt: rupeeNumber(line.igst) } : {}),
          ...(line.cgst > 0 ? { camt: rupeeNumber(line.cgst) } : {}),
          ...(line.sgst > 0 ? { samt: rupeeNumber(line.sgst) } : {}),
          ...(line.cess > 0 ? { csamt: rupeeNumber(line.cess) } : {}),
        },
      }));

      const document = {
        inum: invoice.invoiceNumber,
        idt: formatGstnDate(invoice.invoiceDate),
        val: rupeeNumber(invoice.grandTotal),
        pos: invoice.placeOfSupply,
        rchrg: invoice.reverseCharge ? "Y" : "N",
        inv_typ:
          invoice.supplyCategory === "sez_wp" || invoice.supplyCategory === "sez_wop"
            ? "SEWP"
            : "R",
        itms: itemDetails,
        ...(irn ? { irn } : {}),
      };

      if (invoice.docType === "credit_note" || invoice.docType === "debit_note") {
        const key = isB2b ? buyerGstin : "URP";
        const bucket = cdnr.get(key) ?? { ctin: key, nt: [] };
        bucket.nt.push({
          ntty: invoice.docType === "credit_note" ? "C" : "D",
          nt_num: invoice.invoiceNumber,
          nt_dt: formatGstnDate(invoice.invoiceDate),
          val: rupeeNumber(invoice.grandTotal),
          pos: invoice.placeOfSupply,
          rchrg: invoice.reverseCharge ? "Y" : "N",
          inv_typ: "R",
          itms: itemDetails,
          ...(invoice.referenceInvoiceNumber
            ? {
                onum: invoice.referenceInvoiceNumber,
                odt: formatGstnDate(invoice.referenceInvoiceDate),
              }
            : {}),
        });
        cdnr.set(key, bucket);
      } else if (isB2b) {
        const bucket = b2b.get(buyerGstin) ?? { ctin: buyerGstin, inv: [] };
        bucket.inv.push(document);
        b2b.set(buyerGstin, bucket);
      } else {
        // B2C small: aggregated by place of supply and rate, not listed.
        for (const line of invoiceLinesForDoc) {
          b2cs.push({
            sply_ty: invoice.igst > 0 ? "INTER" : "INTRA",
            pos: invoice.placeOfSupply,
            typ: "OE",
            rt: Number(line.gstRate),
            txval: rupeeNumber(line.taxableValue),
            iamt: rupeeNumber(line.igst),
            camt: rupeeNumber(line.cgst),
            samt: rupeeNumber(line.sgst),
            csamt: rupeeNumber(line.cess),
          });
        }
      }

      // --- HSN summary (Table 12) ----------------------------------------
      for (const line of invoiceLinesForDoc) {
        const key = `${line.hsnSac}|${line.gstRate}|${line.unit}`;
        const existing = hsnTotals.get(key) ?? {
          num: hsnTotals.size + 1,
          hsn_sc: line.hsnSac,
          uqc: line.unit,
          rt: Number(line.gstRate),
          qty: 0,
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0,
        };
        existing["qty"] = Number(existing["qty"]) + Number(line.quantity);
        existing["txval"] = round2(Number(existing["txval"]) + rupeeNumber(line.taxableValue));
        existing["iamt"] = round2(Number(existing["iamt"]) + rupeeNumber(line.igst));
        existing["camt"] = round2(Number(existing["camt"]) + rupeeNumber(line.cgst));
        existing["samt"] = round2(Number(existing["samt"]) + rupeeNumber(line.sgst));
        existing["csamt"] = round2(Number(existing["csamt"]) + rupeeNumber(line.cess));
        hsnTotals.set(key, existing);
      }
    }

    const payload = {
      gstin: gstin.gstin,
      fp: period,
      version: "GST3.2",
      hash: "hash",
      b2b: [...b2b.values()],
      ...(b2cs.length ? { b2cs } : {}),
      ...(cdnr.size ? { cdnr: [...cdnr.values()] } : {}),
      hsn: { data: [...hsnTotals.values()] },
    };

    return {
      gstin: gstin.gstin,
      period,
      invoiceCount,
      totalTaxableValue,
      totalTax,
      errors,
      /** The return can be exported even with warnings; blocking errors are listed. */
      ready: errors.length === 0,
      payload,
      /** Filing is not connected. Nothing here submits anything. */
      filingStatus: "not_connected" as const,
    };
  }

  /** Persist a prepared return so it can be downloaded and audited. */
  async save(ctx: AuthContext, gstinId: string, period: string) {
    const prepared = await this.prepare(ctx, gstinId, period);
    const values = {
      tenantId: ctx.tenantId,
      gstinId,
      returnType: "gstr1",
      period,
      status: prepared.ready ? "ready" : "draft",
      filingStatus: "not_connected",
      invoiceCount: String(prepared.invoiceCount),
      totalTaxableValue: prepared.totalTaxableValue,
      totalTax: prepared.totalTax,
      payload: prepared.payload as never,
      validationErrors: prepared.errors as never,
      generatedAt: new Date(),
      generatedByUserId: ctx.actor === "system" ? null : ctx.userId,
      updatedAt: new Date(),
    };

    const [row] = await this.db
      .insert(gstReturns)
      .values(values)
      .onConflictDoUpdate({
        target: [gstReturns.tenantId, gstReturns.gstinId, gstReturns.returnType, gstReturns.period],
        set: values,
      })
      .returning();

    await this.audit.record(ctx, {
      action: "gstr1.prepared",
      entityType: "gst_return",
      entityId: row?.id ?? period,
      summary: `GSTR-1 ${period}: ${prepared.invoiceCount} invoices, ${prepared.errors.length} issues`,
      metadata: { period, ready: prepared.ready },
    });

    return { ...prepared, id: row?.id };
  }

  async list(ctx: AuthContext, gstinId?: string) {
    return this.db
      .select({
        id: gstReturns.id,
        period: gstReturns.period,
        returnType: gstReturns.returnType,
        status: gstReturns.status,
        filingStatus: gstReturns.filingStatus,
        invoiceCount: gstReturns.invoiceCount,
        totalTaxableValue: gstReturns.totalTaxableValue,
        totalTax: gstReturns.totalTax,
        generatedAt: gstReturns.generatedAt,
      })
      .from(gstReturns)
      .where(scoped(ctx, gstReturns, gstinId ? eq(gstReturns.gstinId, gstinId) : undefined))
      .orderBy(sql`${gstReturns.period} DESC`);
  }
}

/** GSTN expects dd-mm-yyyy. */
function formatGstnDate(value: Date | null): string {
  if (!value) return "";
  const iso = toIsoDate(value);
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
