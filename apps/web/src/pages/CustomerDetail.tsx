import { Link, useNavigate, useParams } from "react-router-dom";
import { GST_STATE_CODES } from "@traxac/shared";
import { useCustomerLedger } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { InvoiceStatus, PaymentStatus } from "../components/status.js";
import { EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { formatDate, money, moneyCompact } from "../lib/format.js";

/**
 * Customer detail — the ledger a trader actually opens before a phone call.
 *
 * Ordered by what gets asked first: what do they owe, what have they bought,
 * what did they last pay for it. Everything is aggregated server-side, so
 * this stays fast for a customer with a thousand invoices.
 */
export function CustomerDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ledger = useCustomerLedger(id);

  if (ledger.isLoading) {
    return (
      <div className="grid place-items-center py-32 text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!ledger.data) {
    return (
      <Page>
        <ErrorNote error={ledger.error ?? new Error("Customer not found")} />
      </Page>
    );
  }

  const { party, totals, recentInvoices, topProducts, payments } = ledger.data;

  return (
    <>
      <PageHeader
        title={party.name}
        subtitle={[party.gstin, party.city].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => navigate("/customers")}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate(`/invoices/new?customer=${party.id}`)}
            >
              New invoice
            </button>
          </>
        }
      />

      <Page>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total billed"
            value={moneyCompact(totals.totalSales)}
            detail={money(totals.totalSales)}
          />
          <Stat
            label="Received"
            value={moneyCompact(totals.totalPaid)}
            detail={money(totals.totalPaid)}
          />
          <Stat
            label="Outstanding"
            value={moneyCompact(totals.outstanding)}
            detail={money(totals.outstanding)}
            tone={totals.outstanding ? "warn" : undefined}
          />
          <Stat
            label="Overdue"
            value={moneyCompact(totals.overdue)}
            detail={totals.overdue ? money(totals.overdue) : "Nothing overdue"}
            tone={totals.overdue ? "bad" : undefined}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-4">
            <section className="card overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-medium">Invoices</h2>
              </div>
              {recentInvoices.length === 0 ? (
                <EmptyState
                  title="No invoices yet"
                  description="Nothing has been billed to this customer."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {recentInvoices.map((invoice) => (
                    <li key={invoice.id}>
                      <Link
                        to={`/invoices/${invoice.id}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50"
                      >
                        <span className="text-sm font-medium">{invoice.invoiceNumber}</span>
                        <span className="text-xs text-muted">
                          {formatDate(invoice.invoiceDate)}
                        </span>
                        <span className="ml-auto flex items-center gap-2">
                          <InvoiceStatus status={invoice.status} />
                          <PaymentStatus total={invoice.grandTotal} paid={invoice.amountPaid} />
                          <span className="w-28 text-right text-sm font-medium">
                            {money(invoice.grandTotal)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-medium">What they buy</h2>
                <p className="text-xs text-muted">
                  The last price each item went out at — useful before quoting again.
                </p>
              </div>
              {topProducts.length === 0 ? (
                <EmptyState title="Nothing billed yet" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Item</th>
                        <th className="px-4 py-2.5 font-medium">HSN</th>
                        <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                        <th className="px-4 py-2.5 text-right font-medium">Last price</th>
                        <th className="px-4 py-2.5 text-right font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {topProducts.map((item) => (
                        <tr key={`${item.name}-${item.hsnSac}`}>
                          <td className="px-4 py-2.5">{item.name}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted">
                            {item.hsnSac}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {item.quantity} {item.unit}
                          </td>
                          <td className="px-4 py-2.5 text-right">{money(item.lastPrice)}</td>
                          <td className="px-4 py-2.5 text-right font-medium">
                            {money(item.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="card p-4">
              <h2 className="text-sm font-medium">Details</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="GSTIN" value={party.gstin ?? "Unregistered"} mono />
                <Row
                  label="Address"
                  value={
                    [
                      party.addressLine1,
                      party.city,
                      party.pincode,
                      party.stateCode ? GST_STATE_CODES[party.stateCode] : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Not set"
                  }
                />
                <Row label="Phone" value={party.phone ?? "—"} />
                <Row label="Email" value={party.email ?? "—"} />
                <Row
                  label="Billing since"
                  value={totals.firstInvoice ? formatDate(totals.firstInvoice) : "—"}
                />
              </dl>
            </section>

            <section className="card p-4">
              <h2 className="text-sm font-medium">Recent payments</h2>
              {payments.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Nothing received yet.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {payments.slice(0, 8).map((payment) => (
                    <li key={payment.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-muted">
                          {payment.invoiceNumber} · {payment.method.toUpperCase()}
                        </span>
                        <span className="text-xs text-slate-400">{formatDate(payment.paidAt)}</span>
                      </span>
                      <span className="shrink-0 font-medium">{money(payment.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
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
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : ""
        }`}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-slate-400">{detail}</p>}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
