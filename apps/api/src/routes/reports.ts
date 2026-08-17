import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  financialYear,
  financialYearEnd,
  financialYearStart,
  toIsoDate,
  toRupees,
} from "@traxac/shared";
import { readActivity } from "@traxac/core";
import { requireAuth } from "../context.js";

const windowQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Convenience: "2026-27" expands to the whole financial year. */
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

function resolveWindow(query: z.infer<typeof windowQuery>): { from: Date; to: Date } {
  if (query.fy) {
    return { from: financialYearStart(query.fy), to: financialYearEnd(query.fy) };
  }
  const fy = financialYear(new Date());
  return {
    from: query.from ?? financialYearStart(fy),
    to: query.to ?? financialYearEnd(fy),
  };
}

/** Reports, plus CSV export of the same data for accountants. */
export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request) => {
    const ctx = requireAuth(request);
    const query = windowQuery.parse(request.query);
    return request.container.reports.dashboard(ctx, resolveWindow(query));
  });

  app.get("/hsn-summary", async (request) => {
    const ctx = requireAuth(request);
    const window = resolveWindow(windowQuery.parse(request.query));
    return { window, items: await request.container.reports.hsnSummary(ctx, window) };
  });

  app.get("/sales-register", async (request) => {
    const ctx = requireAuth(request);
    const window = resolveWindow(windowQuery.parse(request.query));
    return { window, items: await request.container.reports.salesRegister(ctx, window) };
  });

  app.get("/ewb-register", async (request) => {
    const ctx = requireAuth(request);
    const window = resolveWindow(windowQuery.parse(request.query));
    return { window, items: await request.container.reports.ewbRegister(ctx, window) };
  });

  app.get("/outstanding", async (request) => {
    const ctx = requireAuth(request);
    return { items: await request.container.reports.outstandingByParty(ctx) };
  });

  app.get("/top-customers", async (request) => {
    const ctx = requireAuth(request);
    const window = resolveWindow(windowQuery.parse(request.query));
    return { window, items: await request.container.reports.topCustomers(ctx, window) };
  });

  /** Tenant-wide activity feed. */
  app.get("/activity", async (request) => {
    const ctx = requireAuth(request);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.coerce.date().optional(),
        action: z.string().optional(),
        entityType: z.string().optional(),
      })
      .parse(request.query);
    return { items: await readActivity(request.container.database, ctx, query) };
  });

  /* -------------------------------- CSV -------------------------------- */

  app.get("/export/sales-register.csv", async (request, reply) => {
    const ctx = requireAuth(request);
    const window = resolveWindow(windowQuery.parse(request.query));
    const rows = await request.container.reports.salesRegister(ctx, window);
    const csv = toCsv(
      [
        "Invoice No",
        "Date",
        "Type",
        "Buyer",
        "Buyer GSTIN",
        "POS",
        "Taxable",
        "CGST",
        "SGST",
        "IGST",
        "Cess",
        "Total",
        "Status",
        "IRN",
        "Ack No",
        "EWB No",
      ],
      rows.map((r) => [
        r.invoiceNumber,
        toIsoDate(r.invoiceDate),
        r.docType,
        r.buyerName,
        r.buyerGstin ?? "",
        r.placeOfSupply,
        money(r.taxableValue),
        money(r.cgst),
        money(r.sgst),
        money(r.igst),
        money(r.cess),
        money(r.grandTotal),
        r.status,
        r.irn ?? "",
        r.ackNumber ?? "",
        r.ewbNumber ?? "",
      ]),
    );
    return sendCsv(
      reply,
      `sales-register-${toIsoDate(window.from)}-to-${toIsoDate(window.to)}.csv`,
      csv,
    );
  });

  app.get("/export/hsn-summary.csv", async (request, reply) => {
    const ctx = requireAuth(request);
    const window = resolveWindow(windowQuery.parse(request.query));
    const rows = await request.container.reports.hsnSummary(ctx, window);
    const csv = toCsv(
      ["HSN/SAC", "Unit", "Rate %", "Quantity", "Taxable", "CGST", "SGST", "IGST", "Cess", "Total"],
      rows.map((r) => [
        r.hsnSac,
        r.unit,
        r.gstRate,
        r.quantity,
        money(r.taxableValue),
        money(r.cgst),
        money(r.sgst),
        money(r.igst),
        money(r.cess),
        money(r.total),
      ]),
    );
    return sendCsv(
      reply,
      `hsn-summary-${toIsoDate(window.from)}-to-${toIsoDate(window.to)}.csv`,
      csv,
    );
  });

  app.get("/export/ewb-register.csv", async (request, reply) => {
    const ctx = requireAuth(request);
    const window = resolveWindow(windowQuery.parse(request.query));
    const rows = await request.container.reports.ewbRegister(ctx, window);
    const csv = toCsv(
      [
        "EWB No",
        "Status",
        "Generated",
        "Valid Until",
        "Distance km",
        "Vehicle",
        "Transporter",
        "Invoice No",
        "Invoice Date",
        "Buyer",
        "Value",
      ],
      rows.map((r) => [
        r.ewbNumber ?? "",
        r.status,
        r.generatedAt ? toIsoDate(r.generatedAt) : "",
        r.validUntil ? toIsoDate(r.validUntil) : "",
        r.distanceKm ?? "",
        r.vehicleNo ?? "",
        r.transporterName ?? "",
        r.invoiceNumber,
        toIsoDate(r.invoiceDate),
        r.buyerName,
        money(r.grandTotal),
      ]),
    );
    return sendCsv(
      reply,
      `eway-bills-${toIsoDate(window.from)}-to-${toIsoDate(window.to)}.csv`,
      csv,
    );
  });
}

/** Paise are exported as rupee decimals, which is what accounting tools expect. */
function money(paise: number | null | undefined): string {
  return toRupees(Number(paise ?? 0)).toFixed(2);
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (value: string | number): string => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

function sendCsv(reply: FastifyReply, filename: string, csv: string): FastifyReply {
  return (
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      // Byte-order mark so Excel reads the file as UTF-8.
      // eslint-disable-next-line no-irregular-whitespace -- U+FEFF is the BOM
      .send(`﻿${csv}`)
  );
}
