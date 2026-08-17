import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDashboard, useInvoices } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { EinvoiceStatus, EwbStatus, InvoiceStatus, PaymentStatus } from "../components/status.js";
import { EmptyState, ErrorNote, SearchInput, Spinner } from "../components/ui.js";
import { formatDate, money, moneyCompact } from "../lib/format.js";

/**
 * The home screen.
 *
 * A trader opening Traxac has one of two questions: "what have I billed?" and
 * "what needs me right now?". The attention strip answers the second in one
 * line; the list answers the first. Nothing else competes for space.
 */
const FILTERS = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "pending", label: "Issued" },
  { key: "failed", label: "Needs attention" },
  { key: "completed", label: "Paid" },
] as const;

export function InvoicesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";

  const dashboard = useDashboard();
  const invoices = useInvoices({ q, status: status || undefined, page, limit: 25 });

  const setParam = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  const attention = dashboard.data?.needsAttention;
  const alerts = [
    attention?.einvoiceFailed
      ? { label: `${attention.einvoiceFailed} e-Invoice failed`, to: "/invoices?status=failed", tone: "bad" as const }
      : null,
    attention?.ewbExpiringSoon
      ? { label: `${attention.ewbExpiringSoon} e-Way Bill expiring`, to: "/invoices?ewbStatus=generated", tone: "warn" as const }
      : null,
    attention?.ewbPending
      ? { label: `${attention.ewbPending} awaiting e-Way Bill`, to: "/invoices?ewbStatus=pending", tone: "warn" as const }
      : null,
    attention?.overdue
      ? { label: `${attention.overdue} overdue payment${attention.overdue > 1 ? "s" : ""}`, to: "/reports", tone: "warn" as const }
      : null,
  ].filter(Boolean) as Array<{ label: string; to: string; tone: "bad" | "warn" }>;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={dashboard.data
          ? `${dashboard.data.totals.invoiceCount} issued this year · ${moneyCompact(dashboard.data.totals.grandTotal)} billed`
          : undefined}
        actions={
          <button type="button" className="btn-primary hidden lg:inline-flex"
            onClick={() => navigate("/invoices/new")}>
            New invoice
          </button>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:max-w-xs sm:flex-1">
            <SearchInput
              value={q}
              onChange={(next) => setParam("q", next)}
              placeholder="Invoice no, customer, GSTIN, IRN…"
            />
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setParam("status", filter.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  status === filter.key
                    ? "bg-ink text-white"
                    : "bg-slate-100 text-muted hover:bg-slate-200"
                }`}
              >
                {filter.label}
                {filter.key === "draft" && attention?.drafts
                  ? ` (${attention.drafts})` : ""}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <Page>
        {alerts.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {alerts.map((alert) => (
              <Link key={alert.label} to={alert.to}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  alert.tone === "bad"
                    ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                    : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                }`}>
                {alert.label} →
              </Link>
            ))}
          </div>
        )}

        <ErrorNote error={invoices.error} />

        {invoices.isLoading ? (
          <div className="grid place-items-center py-24 text-muted"><Spinner className="size-6" /></div>
        ) : (invoices.data?.items.length ?? 0) === 0 ? (
          <div className="card">
            <EmptyState
              title={q || status ? "No invoices match this" : "No invoices yet"}
              description={q || status
                ? "Try a different search or clear the filter."
                : "Create your first invoice — it takes about a minute."}
              action={!q && !status && (
                <button type="button" className="btn-primary" onClick={() => navigate("/invoices/new")}>
                  New invoice
                </button>
              )}
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="card hidden overflow-hidden lg:block">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Compliance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invoices.data?.items.map((invoice) => (
                    <tr key={invoice.id}
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                      className="cursor-pointer hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className="font-medium">{invoice.invoiceNumber}</span>
                        {invoice.docType !== "invoice" && (
                          <span className="ml-1.5 text-xs text-muted capitalize">
                            {invoice.docType.replace("_", " ")}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3">
                        {invoice.billTo.name}
                        {invoice.billTo.gstin && invoice.billTo.gstin !== "URP" && (
                          <span className="block font-mono text-[11px] text-muted">{invoice.billTo.gstin}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(invoice.invoiceDate)}</td>
                      <td className="px-4 py-3 text-right font-medium">{money(invoice.grandTotal)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <InvoiceStatus status={invoice.status} />
                          <PaymentStatus total={invoice.grandTotal} paid={invoice.amountPaid} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <EinvoiceStatus status={invoice.einvoiceStatus} />
                          <EwbStatus status={invoice.ewbStatus} validUntil={invoice.ewbValidUntil} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="space-y-2 lg:hidden">
              {invoices.data?.items.map((invoice) => (
                <li key={invoice.id}>
                  <Link to={`/invoices/${invoice.id}`} className="card block p-3.5 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{invoice.billTo.name}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {invoice.invoiceNumber} · {formatDate(invoice.invoiceDate)}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold">{money(invoice.grandTotal)}</p>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <InvoiceStatus status={invoice.status} />
                      <EinvoiceStatus status={invoice.einvoiceStatus} />
                      <EwbStatus status={invoice.ewbStatus} validUntil={invoice.ewbValidUntil} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {(invoices.data?.total ?? 0) > (invoices.data?.limit ?? 25) && (
              <div className="mt-4 flex items-center justify-between text-sm">
                <p className="text-muted">
                  {(page - 1) * (invoices.data?.limit ?? 25) + 1}–
                  {Math.min(page * (invoices.data?.limit ?? 25), invoices.data?.total ?? 0)} of{" "}
                  {invoices.data?.total}
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <button type="button" className="btn-secondary" disabled={!invoices.data?.hasMore}
                    onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </Page>
    </>
  );
}
