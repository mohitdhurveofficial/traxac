import { Link, useNavigate } from "react-router-dom";
import { useDashboard, useReceivables } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { InvoiceStatus } from "../components/status.js";
import { GettingStarted } from "../components/getting-started.js";
import { formatDate, money, moneyCompact } from "../lib/format.js";

/**
 * The dashboard.
 *
 * Deliberately not a wall of numbers. It answers two questions and stops:
 * "how is business?" and "what needs me?". Anything a trader would only look
 * at monthly belongs in Reports, not here.
 *
 * The attention row is first because it is the only part that is urgent, and
 * it disappears entirely when there is nothing wrong — an empty dashboard is
 * a good dashboard.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const dashboard = useDashboard();
  const receivables = useReceivables();

  if (dashboard.isLoading) {
    return (
      <div className="grid place-items-center py-32 text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }

  const data = dashboard.data;
  const attention = data?.needsAttention;

  const alerts = [
    attention?.einvoiceFailed
      ? {
          label: `${attention.einvoiceFailed} e-Invoice failed`,
          to: "/invoices?status=failed",
          tone: "bad" as const,
        }
      : null,
    attention?.ewbExpiringSoon
      ? {
          label: `${attention.ewbExpiringSoon} e-Way Bill expiring`,
          to: "/invoices",
          tone: "warn" as const,
        }
      : null,
    attention?.ewbPending
      ? {
          label: `${attention.ewbPending} awaiting e-Way Bill`,
          to: "/invoices",
          tone: "warn" as const,
        }
      : null,
    attention?.overdue
      ? { label: `${attention.overdue} overdue`, to: "/reports/receivables", tone: "warn" as const }
      : null,
    attention?.drafts
      ? {
          label: `${attention.drafts} draft${attention.drafts > 1 ? "s" : ""}`,
          to: "/invoices?status=draft",
          tone: "muted" as const,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; to: string; tone: "bad" | "warn" | "muted" }>;

  const monthly = data?.monthly ?? [];
  const thisMonth = monthly[monthly.length - 1];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          data
            ? `Financial year ${new Date(data.window.from).getFullYear()}–${String((new Date(data.window.from).getFullYear() + 1) % 100).padStart(2, "0")}`
            : undefined
        }
        actions={
          <button type="button" className="btn-primary" onClick={() => navigate("/invoices/new")}>
            New invoice
          </button>
        }
      />

      <Page>
        <ErrorNote error={dashboard.error} onRetry={() => void dashboard.refetch()} />

        {/* Mounted only for an account that has never billed, so an
            established business does not pay for the extra queries. */}
        {data && data.totals.invoiceCount === 0 && <GettingStarted />}

        {alerts.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {alerts.map((alert) => (
              <Link
                key={alert.label}
                to={alert.to}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  alert.tone === "bad"
                    ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                    : alert.tone === "warn"
                      ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                      : "border-line bg-white text-muted hover:bg-slate-50"
                }`}
              >
                {alert.label} →
              </Link>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Billed this month"
            value={moneyCompact(thisMonth?.grandTotal ?? 0)}
            detail={money(thisMonth?.grandTotal ?? 0)}
          />
          <Stat
            label="Billed this year"
            value={moneyCompact(data?.totals.grandTotal ?? 0)}
            detail={`${data?.totals.invoiceCount ?? 0} invoices`}
          />
          <Stat
            label="Outstanding"
            value={moneyCompact(data?.totals.outstanding ?? 0)}
            detail={money(data?.totals.outstanding ?? 0)}
            tone={data?.totals.outstanding ? "warn" : undefined}
            to="/reports/receivables"
          />
          <Stat
            label="GST collected"
            value={moneyCompact(data?.totals.totalTax ?? 0)}
            detail={money(data?.totals.totalTax ?? 0)}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium">Recent invoices</h2>
              <Link to="/invoices" className="text-xs text-brand-700 hover:underline">
                See all
              </Link>
            </div>
            {(data?.recentInvoices.length ?? 0) === 0 ? (
              <EmptyState
                title="Nothing billed yet"
                description="Your most recent invoices will appear here."
                action={
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => navigate("/invoices/new")}
                  >
                    New invoice
                  </button>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {data?.recentInvoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      to={`/invoices/${invoice.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{invoice.buyerName}</p>
                        <p className="text-xs text-muted">
                          {invoice.invoiceNumber} · {formatDate(invoice.invoiceDate)}
                        </p>
                      </div>
                      <InvoiceStatus status={invoice.status} />
                      <p className="w-28 shrink-0 text-right text-sm font-medium">
                        {money(invoice.grandTotal)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Who owes you</h2>
              <Link to="/reports/receivables" className="text-xs text-brand-700 hover:underline">
                Details
              </Link>
            </div>
            {receivables.isLoading ? (
              <div className="grid place-items-center py-8">
                <Spinner />
              </div>
            ) : (receivables.data?.byParty.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted">Nothing outstanding.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {receivables.data?.byParty.slice(0, 6).map((row) => (
                  <li
                    key={row.partyId ?? row.name}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{row.name}</span>
                      {row.overdueDays > 0 && (
                        <span className="text-xs text-amber-700">
                          {row.overdueDays} days overdue
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-medium">{money(row.outstanding)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Page>
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
  to,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "warn";
  to?: string;
}) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "warn" ? "text-amber-700" : ""}`}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-slate-400">{detail}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="card p-4 transition-colors hover:border-brand-500">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}
