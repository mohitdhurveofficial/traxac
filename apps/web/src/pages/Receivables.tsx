import { Link } from "react-router-dom";
import { useReceivables } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { formatDate, money, moneyCompact } from "../lib/format.js";

/**
 * Receivables ageing.
 *
 * Buckets first because that is the shape of the question — "how much is
 * seriously late?" — then the list of who, ordered by how much they owe.
 */
export function ReceivablesPage() {
  const receivables = useReceivables();
  const data = receivables.data;
  const peak = Math.max(1, ...(data?.buckets ?? []).map((b) => b.amount));

  return (
    <>
      <PageHeader
        title="Outstanding"
        subtitle={data ? `${money(data.total)} across ${data.byParty.length} customers` : undefined}
      />

      <Page>
        <ErrorNote error={receivables.error} />

        {receivables.isLoading ? (
          <div className="grid place-items-center py-24 text-muted">
            <Spinner className="size-6" />
          </div>
        ) : (data?.byParty.length ?? 0) === 0 ? (
          <div className="card">
            <EmptyState
              title="Nothing outstanding"
              description="Every issued invoice has been paid in full."
            />
          </div>
        ) : (
          <>
            <section className="card p-4">
              <h2 className="text-sm font-medium">By age</h2>
              <ul className="mt-4 space-y-3">
                {data?.buckets.map((bucket) => (
                  <li key={bucket.label} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-xs text-muted">{bucket.label}</span>
                    <span className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
                      <span
                        className={`block h-full rounded ${
                          bucket.label.startsWith("Over")
                            ? "bg-red-400"
                            : bucket.label === "Not yet due"
                              ? "bg-emerald-400"
                              : "bg-amber-400"
                        }`}
                        style={{
                          width: `${Math.max(bucket.amount ? 3 : 0, (bucket.amount / peak) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="w-28 shrink-0 text-right text-sm font-medium">
                      {money(bucket.amount)}
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs text-muted">
                      {bucket.count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card mt-4 overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-medium">By customer</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 text-right font-medium">Invoices</th>
                      <th className="px-4 py-2.5 font-medium">Oldest due</th>
                      <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data?.byParty.map((row) => (
                      <tr key={row.partyId ?? row.name} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          {row.partyId ? (
                            <Link
                              to={`/customers/${row.partyId}`}
                              className="font-medium hover:underline"
                            >
                              {row.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{row.name}</span>
                          )}
                          {row.overdueDays > 0 && (
                            <span className="ml-2 text-xs text-amber-700">
                              {row.overdueDays} days late
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-muted">{row.invoiceCount}</td>
                        <td className="px-4 py-3 text-muted">
                          {row.oldestDue ? formatDate(row.oldestDue) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {moneyCompact(row.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </Page>
    </>
  );
}
