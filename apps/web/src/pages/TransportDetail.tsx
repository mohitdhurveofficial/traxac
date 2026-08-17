import { Link, useNavigate, useParams } from "react-router-dom";
import { useTransporterHistory, useVehicleHistory } from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { EwbStatus } from "../components/status.js";
import { formatDate, money, moneyCompact } from "../lib/format.js";

interface Shipment {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customer: string;
  vehicleNo: string | null;
  distanceKm: number | null;
  transportDocNo: string | null;
  grandTotal: number;
  ewbNumber: string | null;
  ewbStatus: string | null;
  ewbValidUntil: string | null;
}

/**
 * Transporter and vehicle history.
 *
 * One component for both, because the question is the same — what has moved,
 * and is anything still on the road with a bill about to lapse.
 */
export function TransporterDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const history = useTransporterHistory(id);
  const data = history.data as
    | {
        transporter: { name: string; transporterId: string | null; phone: string | null };
        totals: { shipments: number; value: number; distanceKm: number; lastUsed: string | null };
        vehicles: Array<{ vehicleNo: string; shipments: number; lastUsed: string }>;
        recentShipments: Shipment[];
      }
    | undefined;

  return (
    <TransportView
      loading={history.isLoading}
      error={history.error}
      title={data?.transporter.name ?? "Transporter"}
      subtitle={data?.transporter.transporterId ?? undefined}
      backTo="/settings?tab=logistics"
      stats={[
        { label: "Shipments", value: String(data?.totals.shipments ?? 0) },
        { label: "Value moved", value: moneyCompact(data?.totals.value ?? 0) },
        {
          label: "Distance",
          value: `${(data?.totals.distanceKm ?? 0).toLocaleString("en-IN")} km`,
        },
        {
          label: "Last used",
          value: data?.totals.lastUsed ? formatDate(data.totals.lastUsed) : "Never",
        },
      ]}
      aside={
        data?.vehicles.length ? (
          <section className="card p-4">
            <h2 className="text-sm font-medium">Vehicles used</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {data.vehicles.map((vehicle) => (
                <li key={vehicle.vehicleNo} className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs">{vehicle.vehicleNo}</span>
                  <span className="text-xs text-muted">
                    {vehicle.shipments} trips · {formatDate(vehicle.lastUsed)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null
      }
      shipments={data?.recentShipments ?? []}
    />
  );
}

export function VehicleDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const history = useVehicleHistory(id);
  const data = history.data as
    | {
        vehicle: { vehicleNo: string; vehicleType: string; driverName: string | null };
        totals: { shipments: number; value: number; lastUsed: string | null };
        recentShipments: Shipment[];
      }
    | undefined;

  return (
    <TransportView
      loading={history.isLoading}
      error={history.error}
      title={data?.vehicle.vehicleNo ?? "Vehicle"}
      subtitle={
        data?.vehicle.vehicleType === "O"
          ? "Over-dimensional cargo"
          : (data?.vehicle.driverName ?? undefined)
      }
      backTo="/settings?tab=logistics"
      stats={[
        { label: "Shipments", value: String(data?.totals.shipments ?? 0) },
        { label: "Value moved", value: moneyCompact(data?.totals.value ?? 0) },
        {
          label: "Last used",
          value: data?.totals.lastUsed ? formatDate(data.totals.lastUsed) : "Never",
        },
      ]}
      shipments={data?.recentShipments ?? []}
    />
  );
}

function TransportView({
  loading,
  error,
  title,
  subtitle,
  backTo,
  stats,
  aside,
  shipments,
}: {
  loading: boolean;
  error: unknown;
  title: string;
  subtitle?: string;
  backTo: string;
  stats: Array<{ label: string; value: string }>;
  aside?: React.ReactNode;
  shipments: Shipment[];
}) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="grid place-items-center py-32 text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <button type="button" className="btn-ghost" onClick={() => navigate(backTo)}>
            Back
          </button>
        }
      />
      <Page>
        <ErrorNote error={error} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="card p-4">
              <p className="text-xs text-muted">{stat.label}</p>
              <p className="mt-1 text-xl font-semibold tracking-tight">{stat.value}</p>
            </div>
          ))}
        </div>

        <div
          className={`mt-4 grid gap-4 ${aside ? "lg:grid-cols-[1fr_300px]" : ""} lg:items-start`}
        >
          <section className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium">Shipments</h2>
            </div>
            {shipments.length === 0 ? (
              <EmptyState title="No shipments yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Invoice</th>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 font-medium">Vehicle</th>
                      <th className="px-4 py-2.5 font-medium">e-Way Bill</th>
                      <th className="px-4 py-2.5 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shipments.map((shipment) => (
                      <tr key={shipment.invoiceId} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            to={`/invoices/${shipment.invoiceId}`}
                            className="font-medium hover:underline"
                          >
                            {shipment.invoiceNumber}
                          </Link>
                          <span className="block text-xs text-muted">
                            {formatDate(shipment.invoiceDate)}
                          </span>
                        </td>
                        <td className="max-w-[160px] truncate px-4 py-3">{shipment.customer}</td>
                        <td className="px-4 py-3 font-mono text-xs">{shipment.vehicleNo ?? "—"}</td>
                        <td className="px-4 py-3">
                          {shipment.ewbNumber ? (
                            <>
                              <span className="block font-mono text-xs">{shipment.ewbNumber}</span>
                              <EwbStatus
                                status={shipment.ewbStatus ?? "generated"}
                                validUntil={shipment.ewbValidUntil}
                              />
                            </>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {money(shipment.grandTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {aside}
        </div>
      </Page>
    </>
  );
}
