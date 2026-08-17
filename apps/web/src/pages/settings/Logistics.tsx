import { useState } from "react";
import { Link } from "react-router-dom";
import { GST_STATE_CODES } from "@traxac/shared";
import {
  useSaveTransporter,
  useSaveVehicle,
  useTransporters,
  useVehicles,
} from "../../api/hooks.js";
import { DrawerForm, SettingsList, SettingsSection } from "../../components/forms.js";
import { Pill } from "../../components/status.js";
import { Drawer, Field, SearchInput } from "../../components/ui.js";
import { field } from "../../lib/format.js";

/**
 * Transporters and vehicles.
 *
 * Both are remembered from invoices automatically, so this page is mostly for
 * correcting a detail or adding a transporter ID before the first e-Way Bill.
 */
export function LogisticsSettings({ show }: { show: (message: string) => void }) {
  const [transporterQuery, setTransporterQuery] = useState("");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const transporters = useTransporters(transporterQuery);
  const vehicles = useVehicles(vehicleQuery);
  const saveTransporter = useSaveTransporter();
  const saveVehicle = useSaveVehicle();
  const [adding, setAdding] = useState<"transporter" | "vehicle" | null>(null);

  return (
    <div className="max-w-3xl space-y-4">
      <SettingsSection
        title="Transporters"
        description="The transporter ID is needed on the e-Way Bill when they carry the goods."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setAdding("transporter")}
          >
            Add transporter
          </button>
        }
      >
        <div className="border-b border-line px-4 py-3">
          <div className="sm:max-w-xs">
            <SearchInput
              value={transporterQuery}
              onChange={setTransporterQuery}
              placeholder="Name or transporter ID…"
            />
          </div>
        </div>
        <SettingsList
          items={transporters.data?.items}
          loading={transporters.isLoading}
          error={transporters.error}
          keyOf={(t) => t.id}
          empty={{
            title: transporterQuery ? "No transporter matches that" : "No transporters yet",
            description: transporterQuery
              ? undefined
              : "Add one now, or it will be remembered the first time you use it on an invoice.",
          }}
          renderItem={(transporter) => (
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/transporters/${transporter.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {transporter.name}
                </Link>
                <p className="font-mono text-xs text-muted">
                  {transporter.transporterId ?? "No transporter ID"}
                </p>
              </div>
              {transporter.phone && <span className="text-xs text-muted">{transporter.phone}</span>}
              {!transporter.isActive && <Pill>Archived</Pill>}
            </div>
          )}
        />
      </SettingsSection>

      <SettingsSection
        title="Vehicles"
        description="Remembered automatically from invoices, so they autocomplete next time."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setAdding("vehicle")}
          >
            Add vehicle
          </button>
        }
      >
        <div className="border-b border-line px-4 py-3">
          <div className="sm:max-w-xs">
            <SearchInput
              value={vehicleQuery}
              onChange={setVehicleQuery}
              placeholder="Vehicle number or driver…"
            />
          </div>
        </div>
        <SettingsList
          items={vehicles.data?.items}
          loading={vehicles.isLoading}
          error={vehicles.error}
          keyOf={(v) => v.id}
          empty={{
            title: vehicleQuery ? "No vehicle matches that" : "No vehicles yet",
            description: vehicleQuery
              ? undefined
              : "Any vehicle you use on an invoice is saved here.",
          }}
          renderItem={(vehicle) => (
            <div className="flex items-center gap-3 px-4 py-3">
              <Link
                to={`/vehicles/${vehicle.id}`}
                className="flex-1 font-mono text-sm hover:underline"
              >
                {vehicle.vehicleNo}
              </Link>
              {vehicle.vehicleType === "O" && <Pill tone="warn">Over-dimensional</Pill>}
              {vehicle.driverName && (
                <span className="text-xs text-muted">{vehicle.driverName}</span>
              )}
            </div>
          )}
        />
      </SettingsSection>

      <Drawer
        open={adding === "transporter"}
        onClose={() => setAdding(null)}
        title="Add transporter"
      >
        <DrawerForm
          submitLabel="Add transporter"
          pending={saveTransporter.isPending}
          error={saveTransporter.error}
          onSubmit={(form) =>
            saveTransporter.mutate(
              {
                name: field(form, "name"),
                transporterId: field(form, "transporterId").toUpperCase(),
                phone: field(form, "phone"),
                city: field(form, "city"),
                stateCode: field(form, "stateCode"),
              },
              {
                onSuccess: () => {
                  setAdding(null);
                  show("Transporter added");
                },
              },
            )
          }
        >
          <Field label="Name" required>
            <input name="name" className="field" required />
          </Field>
          <Field
            label="Transporter ID or GSTIN"
            hint="15 characters, from the e-Way Bill portal. Needed for the e-Way Bill."
          >
            <input name="transporterId" className="field font-mono uppercase" maxLength={15} />
          </Field>
          <Field label="Phone">
            <input name="phone" className="field" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <input name="city" className="field" />
            </Field>
            <Field label="State">
              <select name="stateCode" className="field" defaultValue="">
                <option value="">—</option>
                {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </DrawerForm>
      </Drawer>

      <Drawer open={adding === "vehicle"} onClose={() => setAdding(null)} title="Add vehicle">
        <DrawerForm
          submitLabel="Add vehicle"
          pending={saveVehicle.isPending}
          error={saveVehicle.error}
          onSubmit={(form) =>
            saveVehicle.mutate(
              {
                vehicleNo: field(form, "vehicleNo").toUpperCase(),
                vehicleType: field(form, "vehicleType"),
                driverName: field(form, "driverName"),
                driverPhone: field(form, "driverPhone"),
              },
              {
                onSuccess: () => {
                  setAdding(null);
                  show("Vehicle added");
                },
              },
            )
          }
        >
          <Field label="Vehicle number" required hint="For example MH12AB1234.">
            <input name="vehicleNo" className="field font-mono uppercase" required maxLength={15} />
          </Field>
          <Field label="Type">
            <select name="vehicleType" className="field" defaultValue="R">
              <option value="R">Regular</option>
              <option value="O">Over-dimensional cargo</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Driver">
              <input name="driverName" className="field" />
            </Field>
            <Field label="Driver phone">
              <input name="driverPhone" className="field" />
            </Field>
          </div>
        </DrawerForm>
      </Drawer>
    </div>
  );
}
