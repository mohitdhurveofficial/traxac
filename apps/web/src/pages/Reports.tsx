import { useState } from "react";
import { financialYear } from "@traxac/shared";
import { useDashboard } from "../api/hooks.js";
import { get } from "../api/client.js";
import { Page, PageHeader } from "../components/shell.js";
import { ErrorNote, Spinner } from "../components/ui.js";
import { money, moneyCompact } from "../lib/format.js";

/**
 * Reports.
 *
 * Deliberately few: the numbers a trader is asked for by their accountant, and
 * a CSV of each. Anything more specific is better done in a spreadsheet from
 * the export than in a report builder nobody asked for.
 */
const REPORTS = [
  {
    key: "sales-register",
    title: "Sales register",
    description: "Every invoice with its tax split, IRN and e-Way Bill number.",
  },
  {
    key: "hsn-summary",
    title: "HSN summary",
    description: "Outward supplies grouped by HSN and rate — the GSTR-1 Table 12 shape.",
  },
  {
    key: "ewb-register",
    title: "e-Way Bill register",
    description: "Bills generated, their validity, vehicle and transporter.",
  },
] as const;

export function ReportsPage() {
  const currentFy = financialYear(new Date());
  const [fy, setFy] = useState(currentFy);
  const dashboard = useDashboard(fy);
  const [downloading, setDownloading] = useState<string | null>(null);

  const years = [0, 1, 2].map((offset) => {
    const startYear = Number(currentFy.slice(0, 4)) - offset;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  });

  const download = async (key: string): Promise<void> => {
    setDownloading(key);
    try {
      const blob = await get<Blob>(`/v1/reports/export/${key}.csv`, { fy });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${key}-${fy}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  const totals = dashboard.data?.totals;
  const monthly = dashboard.data?.monthly ?? [];
  const peak = Math.max(1, ...monthly.map((m) => m.grandTotal));

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
          >
            {years.map((year) => (
              <option key={year} value={year}>
                FY {year}
              </option>
            ))}
          </select>
        }
      />

      <Page>
        <ErrorNote error={dashboard.error} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Invoices issued" value={String(totals?.invoiceCount ?? 0)} />
          <Stat
            label="Taxable value"
            value={moneyCompact(totals?.taxableValue ?? 0)}
            detail={money(totals?.taxableValue ?? 0)}
          />
          <Stat
            label="GST collected"
            value={moneyCompact(totals?.totalTax ?? 0)}
            detail={money(totals?.totalTax ?? 0)}
          />
          <Stat
            label="Outstanding"
            value={moneyCompact(totals?.outstanding ?? 0)}
            detail={money(totals?.outstanding ?? 0)}
            tone={totals?.outstanding ? "warn" : undefined}
          />
        </div>

        {monthly.length > 0 && (
          <section className="card mt-4 p-4">
            <h2 className="text-sm font-medium">Billed by month</h2>
            {/*
             * `items-stretch` matters: with `items-end` the columns collapse
             * to their content height, leaving the bars nothing to fill and
             * rendering an empty chart.
             */}
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

        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          {REPORTS.map((report) => (
            <div key={report.key} className="card flex flex-col p-4">
              <h3 className="text-sm font-medium">{report.title}</h3>
              <p className="mt-1 flex-1 text-xs text-muted">{report.description}</p>
              <button
                type="button"
                className="btn-secondary mt-3"
                disabled={downloading === report.key}
                onClick={() => void download(report.key)}
              >
                {downloading === report.key ? <Spinner /> : null}
                Download CSV
              </button>
            </div>
          ))}
        </section>
      </Page>
    </>
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
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          tone === "warn" ? "text-amber-700" : ""
        }`}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-slate-400">{detail}</p>}
    </div>
  );
}
