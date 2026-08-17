import { useState } from "react";
import { Link } from "react-router-dom";
import { financialYear } from "@traxac/shared";
import { useDashboard, useReport } from "../api/hooks.js";
import { get } from "../api/client.js";
import { Page, PageHeader } from "../components/shell.js";
import { TabBar } from "../components/forms.js";
import { EmptyState, ErrorNote, Spinner, useToast } from "../components/ui.js";
import { asText, formatDate, money, moneyCompact } from "../lib/format.js";

/**
 * Reports.
 *
 * Each one answers a question an accountant or a bank actually asks. Anything
 * more specific is better done in a spreadsheet from the CSV than in a report
 * builder nobody requested.
 *
 * Every table is server-generated and bounded; nothing loads a full history
 * into the browser.
 */
const TABS = [
  { key: "summary", label: "Summary" },
  { key: "sales", label: "Sales register" },
  { key: "customers", label: "By customer" },
  { key: "products", label: "By item" },
  { key: "hsn", label: "By HSN" },
  { key: "outstanding", label: "Outstanding" },
  { key: "payments", label: "Payments" },
  { key: "transport", label: "Transport" },
] as const;

export function ReportsPage() {
  const currentFy = financialYear(new Date());
  const [fy, setFy] = useState(currentFy);
  const [tab, setTab] = useState<string>("summary");
  const { toast, show } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const years = [0, 1, 2].map((offset) => {
    const startYear = Number(currentFy.slice(0, 4)) - offset;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  });

  const download = async (name: string): Promise<void> => {
    setDownloading(name);
    try {
      const blob = await get<Blob>(`/v1/reports/export/${name}.csv`, { fy });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${name}-${fy}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      show("Downloaded");
    } catch {
      show("The report could not be downloaded. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`Financial year ${fy}`}
        actions={
          <select
            className="field w-auto"
            value={fy}
            onChange={(event) => setFy(event.target.value)}
            aria-label="Financial year"
          >
            {years.map((year) => (
              <option key={year} value={year}>
                FY {year}
              </option>
            ))}
          </select>
        }
      >
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
      </PageHeader>

      <Page>
        {tab === "summary" && <Summary fy={fy} />}
        {tab === "sales" && (
          <ReportTable
            title="Sales register"
            description="Every issued document with its tax split, IRN and e-Way Bill number."
            endpoint="sales-register"
            fy={fy}
            exportName="sales-register"
            downloading={downloading}
            onDownload={download}
            columns={[
              { key: "invoiceNumber", label: "Invoice" },
              { key: "invoiceDate", label: "Date", format: "date" },
              { key: "buyerName", label: "Customer" },
              { key: "buyerGstin", label: "GSTIN", mono: true },
              { key: "taxableValue", label: "Taxable", format: "money", align: "right" },
              { key: "cgst", label: "CGST", format: "money", align: "right" },
              { key: "sgst", label: "SGST", format: "money", align: "right" },
              { key: "igst", label: "IGST", format: "money", align: "right" },
              { key: "grandTotal", label: "Total", format: "money", align: "right" },
              { key: "irn", label: "IRN", truncate: true },
            ]}
          />
        )}
        {tab === "customers" && (
          <ReportTable
            title="Sales by customer"
            description="Who you billed most this year."
            endpoint="top-customers"
            fy={fy}
            downloading={downloading}
            onDownload={download}
            columns={[
              {
                key: "name",
                label: "Customer",
                link: (row) =>
                  row["partyId"] ? `/customers/${asText(row["partyId"])}` : undefined,
              },
              { key: "gstin", label: "GSTIN", mono: true },
              { key: "invoiceCount", label: "Invoices", align: "right" },
              { key: "grandTotal", label: "Billed", format: "money", align: "right" },
            ]}
          />
        )}
        {tab === "products" && (
          <ReportTable
            title="Sales by item"
            description="What sold, and for how much."
            endpoint="hsn-summary"
            fy={fy}
            exportName="hsn-summary"
            downloading={downloading}
            onDownload={download}
            columns={[
              { key: "hsnSac", label: "HSN/SAC", mono: true },
              { key: "unit", label: "Unit" },
              { key: "quantity", label: "Quantity", align: "right" },
              { key: "gstRate", label: "Rate %", align: "right" },
              { key: "taxableValue", label: "Taxable", format: "money", align: "right" },
              { key: "total", label: "Total", format: "money", align: "right" },
            ]}
          />
        )}
        {tab === "hsn" && (
          <ReportTable
            title="HSN summary"
            description="Your sales grouped by HSN code and tax rate."
            endpoint="hsn-summary"
            fy={fy}
            exportName="hsn-summary"
            downloading={downloading}
            onDownload={download}
            columns={[
              { key: "hsnSac", label: "HSN/SAC", mono: true },
              { key: "gstRate", label: "Rate %", align: "right" },
              { key: "quantity", label: "Quantity", align: "right" },
              { key: "taxableValue", label: "Taxable", format: "money", align: "right" },
              { key: "cgst", label: "CGST", format: "money", align: "right" },
              { key: "sgst", label: "SGST", format: "money", align: "right" },
              { key: "igst", label: "IGST", format: "money", align: "right" },
              { key: "total", label: "Total", format: "money", align: "right" },
            ]}
          />
        )}
        {tab === "outstanding" && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Full ageing is on the{" "}
              <Link to="/reports/receivables" className="text-brand-700 hover:underline">
                outstanding page
              </Link>
              .
            </p>
            <ReportTable
              title="Outstanding by customer"
              description="Money billed and not yet received."
              endpoint="outstanding"
              fy={fy}
              downloading={downloading}
              onDownload={download}
              columns={[
                { key: "partyName", label: "Customer" },
                { key: "invoiceCount", label: "Invoices", align: "right" },
                { key: "oldestDueDate", label: "Oldest due", format: "date" },
                { key: "outstanding", label: "Outstanding", format: "money", align: "right" },
              ]}
            />
          </div>
        )}
        {tab === "payments" && (
          <ReportTable
            title="Payments received"
            description="Every payment recorded against an invoice."
            endpoint="../payments"
            fy={fy}
            downloading={downloading}
            onDownload={download}
            columns={[
              { key: "paidAt", label: "Date", format: "date" },
              { key: "customer", label: "Customer" },
              { key: "invoiceNumber", label: "Invoice" },
              { key: "method", label: "Method" },
              { key: "reference", label: "Reference" },
              { key: "amount", label: "Amount", format: "money", align: "right" },
            ]}
          />
        )}
        {tab === "transport" && (
          <ReportTable
            title="e-Way Bill register"
            description="Bills generated, their validity, vehicle and transporter."
            endpoint="ewb-register"
            fy={fy}
            exportName="ewb-register"
            downloading={downloading}
            onDownload={download}
            columns={[
              { key: "ewbNumber", label: "e-Way Bill", mono: true },
              { key: "status", label: "Status" },
              { key: "generatedAt", label: "Generated", format: "date" },
              { key: "validUntil", label: "Valid until", format: "date" },
              { key: "vehicleNo", label: "Vehicle", mono: true },
              { key: "transporterName", label: "Transporter" },
              { key: "invoiceNumber", label: "Invoice" },
              { key: "grandTotal", label: "Value", format: "money", align: "right" },
            ]}
          />
        )}
      </Page>
      {toast}
    </>
  );
}

function Summary({ fy }: { fy: string }) {
  const dashboard = useDashboard(fy);
  const data = dashboard.data;
  const monthly = data?.monthly ?? [];
  const peak = Math.max(1, ...monthly.map((m) => m.grandTotal));

  return (
    <>
      <ErrorNote error={dashboard.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invoices issued" value={String(data?.totals.invoiceCount ?? 0)} />
        <Stat
          label="Taxable value"
          value={moneyCompact(data?.totals.taxableValue ?? 0)}
          detail={money(data?.totals.taxableValue ?? 0)}
        />
        <Stat
          label="GST collected"
          value={moneyCompact(data?.totals.totalTax ?? 0)}
          detail={money(data?.totals.totalTax ?? 0)}
        />
        <Stat
          label="Outstanding"
          value={moneyCompact(data?.totals.outstanding ?? 0)}
          detail={money(data?.totals.outstanding ?? 0)}
          tone={data?.totals.outstanding ? "warn" : undefined}
        />
      </div>

      {monthly.length > 0 && (
        <section className="card mt-4 p-4">
          <h2 className="text-sm font-medium">Billed by month</h2>
          <div className="mt-4 flex h-40 items-stretch gap-1.5">
            {monthly.map((month) => (
              <div
                key={month.month}
                className="group flex h-full flex-1 flex-col items-center gap-1.5"
              >
                <div className="relative flex w-full max-w-24 flex-1 items-end self-center">
                  <div
                    className="w-full rounded-t bg-brand-500 transition-colors group-hover:bg-brand-600"
                    style={{ height: `${Math.max(2, (month.grandTotal / peak) * 100)}%` }}
                  />
                  <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white group-hover:block">
                    {moneyCompact(month.grandTotal)}
                  </span>
                </div>
                <span className="text-[10px] text-muted">{month.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

interface Column {
  key: string;
  label: string;
  format?: "money" | "date";
  align?: "right";
  mono?: boolean;
  truncate?: boolean;
  link?: (row: Record<string, unknown>) => string | undefined;
}

function ReportTable({
  title,
  description,
  endpoint,
  fy,
  columns,
  exportName,
  downloading,
  onDownload,
}: {
  title: string;
  description: string;
  endpoint: string;
  fy: string;
  columns: Column[];
  exportName?: string;
  downloading: string | null;
  onDownload: (name: string) => void;
}) {
  const report = useReport<{ items: Array<Record<string, unknown>> }>(endpoint, { fy });
  const rows = report.data?.items ?? [];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        {exportName && (
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={downloading === exportName}
            onClick={() => onDownload(exportName)}
          >
            {downloading === exportName ? <Spinner className="size-3" /> : null}
            Download CSV
          </button>
        )}
      </div>

      {report.isLoading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner className="size-6" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing in this period" description="Try a different financial year." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: `${columns.length * 110}px` }}>
              <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-4 py-2.5 font-medium ${column.align === "right" ? "text-right" : ""}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, 200).map((row, index) => (
                  <tr key={index} className="hover:bg-slate-50">
                    {columns.map((column) => {
                      const raw = row[column.key];
                      const href = column.link?.(row);
                      const value =
                        raw === null || raw === undefined || raw === ""
                          ? "—"
                          : column.format === "money"
                            ? money(Number(raw))
                            : column.format === "date"
                              ? formatDate(asText(raw))
                              : asText(raw, "—");
                      return (
                        <td
                          key={column.key}
                          className={`px-4 py-2.5 ${column.align === "right" ? "text-right" : ""} ${
                            column.mono ? "font-mono text-xs" : ""
                          } ${column.truncate ? "max-w-[140px] truncate" : ""}`}
                        >
                          {href ? (
                            <Link to={href} className="hover:underline">
                              {value}
                            </Link>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
              Showing the first 200 of {rows.length}. Download the CSV for the full period.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "warn";
}) {
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "warn" ? "text-amber-700" : ""}`}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-slate-400">{detail}</p>}
    </div>
  );
}
