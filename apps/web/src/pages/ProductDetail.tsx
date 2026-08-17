import { Link, useNavigate, useParams } from "react-router-dom";
import { useProductHistory } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { formatDate, money, moneyCompact } from "../lib/format.js";

/**
 * Item history.
 *
 * The question this page exists to answer is "what has this been going out
 * at?" — so the price range and the per-customer last price come before
 * anything else. A trader about to quote needs that, not a chart.
 */
export function ProductDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const history = useProductHistory(id);

  if (history.isLoading) {
    return (
      <div className="grid place-items-center py-32 text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!history.data) {
    return (
      <Page>
        <ErrorNote error={history.error ?? new Error("Item not found")} />
      </Page>
    );
  }

  const { product, totals, customers, recentSales } = history.data;
  const priceSpread = totals.maxPrice - totals.minPrice;

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={`HSN ${product.hsnSac} · ${Number(product.gstRate)}% GST · ${product.unit}`}
        actions={
          <button type="button" className="btn-ghost" onClick={() => navigate("/items")}>
            Back
          </button>
        }
      />

      <Page>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Current price"
            value={money(product.unitPrice)}
            detail="Default on new invoices"
          />
          <Stat
            label="Sold"
            value={`${totals.quantity.toLocaleString("en-IN")} ${product.unit}`}
            detail={`across ${totals.invoiceCount} invoices`}
          />
          <Stat label="Revenue" value={moneyCompact(totals.value)} detail={money(totals.value)} />
          <Stat
            label="Price range"
            value={
              totals.invoiceCount ? `${money(totals.minPrice)} – ${money(totals.maxPrice)}` : "—"
            }
            detail={
              priceSpread > 0
                ? `Average ${money(totals.averagePrice)}`
                : totals.invoiceCount
                  ? "Always the same price"
                  : "Not sold yet"
            }
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
          <section className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium">Who buys it</h2>
              <p className="text-xs text-muted">And what they last paid.</p>
            </div>
            {customers.length === 0 ? (
              <EmptyState title="Not sold yet" />
            ) : (
              <ul className="divide-y divide-line">
                {customers.map((customer) => (
                  <li key={`${customer.partyId ?? customer.customer}`} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      {customer.partyId ? (
                        <Link
                          to={`/customers/${customer.partyId}`}
                          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                        >
                          {customer.customer}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {customer.customer}
                        </span>
                      )}
                      <span className="shrink-0 text-sm font-medium">
                        {money(customer.lastPrice)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {customer.quantity.toLocaleString("en-IN")} {product.unit} ·{" "}
                      {money(customer.value)} · last {formatDate(customer.lastSoldOn)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium">Recent sales</h2>
            </div>
            {recentSales.length === 0 ? (
              <EmptyState title="No sales yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-sm">
                  <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Invoice</th>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                      <th className="px-4 py-2.5 text-right font-medium">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {recentSales.map((sale, index) => (
                      <tr key={`${sale.invoiceId}-${index}`} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <Link to={`/invoices/${sale.invoiceId}`} className="hover:underline">
                            {sale.invoiceNumber}
                          </Link>
                          <span className="block text-xs text-muted">
                            {formatDate(sale.invoiceDate)}
                          </span>
                        </td>
                        <td className="max-w-[160px] truncate px-4 py-2.5">{sale.customer}</td>
                        <td className="px-4 py-2.5 text-right">
                          {Number(sale.quantity)} {sale.unit}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">
                          {money(sale.unitPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </Page>
    </>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-slate-400">{detail}</p>}
    </div>
  );
}
