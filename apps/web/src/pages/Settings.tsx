import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GST_STATE_CODES } from "@traxac/shared";
import {
  useBranches, useCredentials, useDeleteCredential, useGstins, useSaveBranch,
  useSaveCredential, useSaveGstin, useSaveTransporter, useSettings, useTestCredential,
  useTransporters, useUpdateSettings, useVehicles, useSaveVehicle,
} from "../api/hooks.js";
import { Page, PageHeader } from "../components/shell.js";
import { Pill } from "../components/status.js";
import { Drawer, ErrorNote, Field, Spinner, useToast } from "../components/ui.js";
import { checked, field, formatDateTime, numberField } from "../lib/format.js";

/**
 * Settings.
 *
 * Everything a trader configures once and forgets. Grouped by how often it is
 * touched, with GST API credentials given their own tab because that is the
 * one place where getting it wrong stops invoices from being filed.
 */
const TABS = [
  { key: "business", label: "Business" },
  { key: "gstins", label: "GSTINs & branches" },
  { key: "gst", label: "GST credentials" },
  { key: "logistics", label: "Transporters & vehicles" },
] as const;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "business") as (typeof TABS)[number]["key"];
  const { toast, show } = useToast();

  return (
    <>
      <PageHeader title="Settings">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((item) => (
            <button key={item.key} type="button"
              onClick={() => setParams({ tab: item.key }, { replace: true })}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                tab === item.key ? "bg-ink text-white" : "bg-slate-100 text-muted hover:bg-slate-200"}`}>
              {item.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <Page>
        {tab === "business" && <BusinessTab show={show} />}
        {tab === "gstins" && <GstinTab show={show} />}
        {tab === "gst" && <CredentialsTab show={show} />}
        {tab === "logistics" && <LogisticsTab show={show} />}
      </Page>
      {toast}
    </>
  );
}

type Show = (message: string) => void;

/** Settings values arrive as `unknown` from a jsonb column; render only text. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function BusinessTab({ show }: { show: Show }) {
  const settings = useSettings();
  const update = useUpdateSettings();
  const data = settings.data;

  return (
    <div className="max-w-2xl space-y-4">
      <section className="card p-4">
        <h2 className="text-sm font-medium">Business</h2>
        <form className="mt-3 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            update.mutate({
              businessName: field(form, "businessName"),
              ewbThresholdRupees: numberField(form, "ewbThresholdRupees"),
              autoGenerateEinvoice: checked(form, "autoGenerateEinvoice"),
              autoGenerateEwb: checked(form, "autoGenerateEwb"),
              defaultTerms: field(form, "defaultTerms"),
            }, { onSuccess: () => show("Settings saved") });
          }}>
          <Field label="Business name">
            <input name="businessName" className="field" defaultValue={data?.business.name ?? ""} />
          </Field>
          <Field label="e-Way Bill threshold (₹)"
            hint="Consignments above this value need an e-Way Bill. The statutory default is ₹50,000.">
            <input name="ewbThresholdRupees" type="number" className="field"
              defaultValue={String((data?.settings?.["ewbThresholdRupees"] as number) ?? 50000)} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input name="autoGenerateEinvoice" type="checkbox" className="mt-0.5 size-4 rounded border-line"
              defaultChecked={Boolean(data?.settings?.["autoGenerateEinvoice"])} />
            <span>
              Send invoices to the IRP as soon as they are issued
              <span className="block text-xs text-muted">You can still do it manually per invoice.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input name="autoGenerateEwb" type="checkbox" className="mt-0.5 size-4 rounded border-line"
              defaultChecked={Boolean(data?.settings?.["autoGenerateEwb"])} />
            <span>Generate e-Way Bills automatically when required</span>
          </label>
          <Field label="Default terms" hint="Printed at the bottom of every invoice">
            <textarea name="defaultTerms" className="field min-h-20"
              defaultValue={asText(data?.settings?.["defaultTerms"])} />
          </Field>
          <ErrorNote error={update.error} />
          <button type="submit" className="btn-primary" disabled={update.isPending}>
            {update.isPending && <Spinner />} Save
          </button>
        </form>
      </section>
    </div>
  );
}

function GstinTab({ show }: { show: Show }) {
  const gstins = useGstins();
  const branches = useBranches();
  const [adding, setAdding] = useState<"gstin" | "branch" | null>(null);
  const saveGstin = useSaveGstin();
  const saveBranch = useSaveBranch();

  return (
    <div className="max-w-3xl space-y-4">
      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Your GSTIN registrations</h2>
          <button type="button" className="btn-ghost text-xs" onClick={() => setAdding("gstin")}>
            + Add GSTIN
          </button>
        </div>
        <ul className="divide-y divide-line">
          {gstins.data?.items.map((gstin) => (
            <li key={gstin.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{gstin.tradeName}</p>
                <p className="font-mono text-xs text-muted">{gstin.gstin}</p>
                <p className="text-xs text-muted">
                  {gstin.city}, {GST_STATE_CODES[gstin.stateCode]}
                </p>
              </div>
              {gstin.isPrimary && <Pill tone="good">Primary</Pill>}
            </li>
          ))}
          {(gstins.data?.items.length ?? 0) === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">
              Add the GSTIN you bill from — it appears on every invoice.
            </li>
          )}
        </ul>
      </section>

      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Branches, warehouses and plants</h2>
            <p className="text-xs text-muted">Places goods are dispatched from.</p>
          </div>
          <button type="button" className="btn-ghost text-xs"
            disabled={!gstins.data?.items.length} onClick={() => setAdding("branch")}>
            + Add place
          </button>
        </div>
        <ul className="divide-y divide-line">
          {branches.data?.items.map((branch) => (
            <li key={branch.id} className="px-4 py-3">
              <p className="text-sm font-medium">{branch.name}
                <span className="ml-2 text-xs text-muted capitalize">{branch.kind}</span>
              </p>
              <p className="text-xs text-muted">
                {branch.addressLine1}, {branch.city} {branch.pincode}
              </p>
            </li>
          ))}
          {(branches.data?.items.length ?? 0) === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">None added.</li>
          )}
        </ul>
      </section>

      <Drawer open={adding === "gstin"} onClose={() => setAdding(null)} title="Add GSTIN">
        <form className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            saveGstin.mutate({
              gstin: field(form, "gstin").toUpperCase(),
              legalName: field(form, "legalName"),
              tradeName: field(form, "tradeName"),
              registrationType: "regular",
              addressLine1: field(form, "addressLine1"),
              city: field(form, "city"),
              stateCode: field(form, "stateCode"),
              pincode: field(form, "pincode"),
              phone: field(form, "phone"),
              email: field(form, "email"),
              einvoiceEnabled: true,
              ewbEnabled: true,
              isPrimary: checked(form, "isPrimary"),
            }, { onSuccess: () => { setAdding(null); show("GSTIN added"); } });
          }}>
          <Field label="GSTIN" required hint="The state code must match the address state.">
            <input name="gstin" className="field font-mono uppercase" required maxLength={15} />
          </Field>
          <Field label="Legal name" required><input name="legalName" className="field" required /></Field>
          <Field label="Trade name" required hint="Shown on the invoice">
            <input name="tradeName" className="field" required />
          </Field>
          <Field label="Address" required><input name="addressLine1" className="field" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" required><input name="city" className="field" required /></Field>
            <Field label="PIN code" required>
              <input name="pincode" className="field" required maxLength={6} />
            </Field>
          </div>
          <Field label="State" required>
            <select name="stateCode" className="field" required defaultValue="">
              <option value="" disabled>Select…</option>
              {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input name="phone" className="field" /></Field>
            <Field label="Email"><input name="email" type="email" className="field" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="isPrimary" type="checkbox" className="size-4 rounded border-line" />
            Use as the default for new invoices
          </label>
          <ErrorNote error={saveGstin.error} />
          <button type="submit" className="btn-primary w-full" disabled={saveGstin.isPending}>
            {saveGstin.isPending && <Spinner />} Add GSTIN
          </button>
        </form>
      </Drawer>

      <Drawer open={adding === "branch"} onClose={() => setAdding(null)} title="Add branch or plant">
        <form className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            saveBranch.mutate({
              gstinId: field(form, "gstinId"),
              name: field(form, "name"),
              kind: field(form, "kind"),
              addressLine1: field(form, "addressLine1"),
              city: field(form, "city"),
              stateCode: field(form, "stateCode"),
              pincode: field(form, "pincode"),
              isDefault: false,
            }, { onSuccess: () => { setAdding(null); show("Place added"); } });
          }}>
          <Field label="Belongs to GSTIN" required>
            <select name="gstinId" className="field" required defaultValue="">
              <option value="" disabled>Select…</option>
              {gstins.data?.items.map((g) => (
                <option key={g.id} value={g.id}>{g.tradeName} — {g.gstin}</option>
              ))}
            </select>
          </Field>
          <Field label="Name" required>
            <input name="name" className="field" required placeholder="Chakan Rolling Plant" />
          </Field>
          <Field label="Type">
            <select name="kind" className="field" defaultValue="plant">
              <option value="plant">Plant</option>
              <option value="warehouse">Warehouse</option>
              <option value="branch">Branch</option>
              <option value="office">Office</option>
            </select>
          </Field>
          <Field label="Address" required><input name="addressLine1" className="field" required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" required><input name="city" className="field" required /></Field>
            <Field label="PIN code" required>
              <input name="pincode" className="field" required maxLength={6} />
            </Field>
          </div>
          <Field label="State" required>
            <select name="stateCode" className="field" required defaultValue="">
              <option value="" disabled>Select…</option>
              {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                <option key={code} value={code}>{code} — {name}</option>
              ))}
            </select>
          </Field>
          <ErrorNote error={saveBranch.error} />
          <button type="submit" className="btn-primary w-full" disabled={saveBranch.isPending}>
            {saveBranch.isPending && <Spinner />} Add place
          </button>
        </form>
      </Drawer>
    </div>
  );
}

function CredentialsTab({ show }: { show: Show }) {
  const gstins = useGstins();
  const credentials = useCredentials();
  const save = useSaveCredential();
  const test = useTestCredential();
  const remove = useDeleteCredential();
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm">
        <p className="font-medium text-brand-900">How e-Invoice and e-Way Bill work here</p>
        <p className="mt-1 text-brand-900/80">
          Traxac talks to the Government portals directly using your API credentials. Nothing is
          simulated: without valid credentials, generating an IRN or e-Way Bill fails and says so.
          Get API access from the e-Invoice portal
          (<span className="font-mono text-xs">einvoice1.gst.gov.in</span>) and the e-Way Bill
          portal (<span className="font-mono text-xs">ewaybillgst.gov.in</span>), then add the
          username and password here. Keep the environment on sandbox until you have tested.
        </p>
      </div>

      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Saved credentials</h2>
          <button type="button" className="btn-ghost text-xs"
            disabled={!gstins.data?.items.length} onClick={() => setAdding(true)}>
            + Add credentials
          </button>
        </div>
        <ul className="divide-y divide-line">
          {credentials.data?.items.map((credential) => (
            <li key={credential.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {credential.service === "einvoice" ? "e-Invoice" : "e-Way Bill"}
                  <span className="ml-2 font-mono text-xs text-muted">{credential.gstin}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {credential.usernameHint} · {credential.provider}
                  {credential.lastVerifiedAt && ` · verified ${formatDateTime(credential.lastVerifiedAt)}`}
                </p>
                {credential.lastError && (
                  <p className="mt-1 text-xs text-red-600">{credential.lastError}</p>
                )}
                {result?.id === credential.id && (
                  <p className={`mt-1 text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
                    {result.message}
                  </p>
                )}
              </div>
              <Pill tone={credential.environment === "production" ? "good" : "warn"}>
                {credential.environment}
              </Pill>
              <button type="button" className="btn-secondary text-xs"
                disabled={test.isPending}
                onClick={() => test.mutate(credential.id, {
                  onSuccess: (response) => setResult({
                    id: credential.id,
                    ok: response.ok,
                    message: response.ok
                      ? "Signed in to the portal successfully."
                      : `${response.error?.code}: ${response.error?.message}`,
                  }),
                })}>
                {test.isPending ? <Spinner /> : null} Test
              </button>
              <button type="button" className="btn-ghost px-2 text-muted hover:text-red-600"
                aria-label="Delete credentials"
                onClick={() => remove.mutate(credential.id, { onSuccess: () => show("Removed") })}>
                ×
              </button>
            </li>
          ))}
          {(credentials.data?.items.length ?? 0) === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">
              No credentials yet. Invoices can still be created and printed — only the IRN and
              e-Way Bill steps need them.
            </li>
          )}
        </ul>
      </section>

      <Drawer open={adding} onClose={() => setAdding(false)} title="Add GST API credentials"
        description="Stored encrypted. They are never shown again after saving.">
        <form className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            save.mutate({
              gstinId: field(form, "gstinId"),
              provider: "nic",
              environment: field(form, "environment"),
              service: field(form, "service"),
              username: field(form, "username"),
              password: field(form, "password"),
              clientId: field(form, "clientId"),
              clientSecret: field(form, "clientSecret"),
              baseUrl: field(form, "baseUrl"),
            }, { onSuccess: () => { setAdding(false); show("Credentials saved"); } });
          }}>
          <Field label="For which GSTIN" required>
            <select name="gstinId" className="field" required defaultValue="">
              <option value="" disabled>Select…</option>
              {gstins.data?.items.map((g) => (
                <option key={g.id} value={g.id}>{g.tradeName} — {g.gstin}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service" required>
              <select name="service" className="field" defaultValue="einvoice">
                <option value="einvoice">e-Invoice (IRN)</option>
                <option value="ewb">e-Way Bill</option>
              </select>
            </Field>
            <Field label="Environment" required>
              <select name="environment" className="field" defaultValue="sandbox">
                <option value="sandbox">Sandbox (testing)</option>
                <option value="production">Production (live)</option>
              </select>
            </Field>
          </div>
          <Field label="API username" required hint="The API user, not your portal login">
            <input name="username" className="field" required autoComplete="off" />
          </Field>
          <Field label="API password" required>
            <input name="password" type="password" className="field" required autoComplete="new-password" />
          </Field>
          <Field label="Client ID" hint="From NIC or your GSP. Leave blank to use the platform default.">
            <input name="clientId" className="field" autoComplete="off" />
          </Field>
          <Field label="Client secret">
            <input name="clientSecret" type="password" className="field" autoComplete="new-password" />
          </Field>
          <Field label="Custom base URL" hint="Only if you route through a GSP.">
            <input name="baseUrl" className="field" placeholder="https://…" />
          </Field>
          <ErrorNote error={save.error} />
          <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
            {save.isPending && <Spinner />} Save credentials
          </button>
        </form>
      </Drawer>
    </div>
  );
}

function LogisticsTab({ show }: { show: Show }) {
  const transporters = useTransporters();
  const vehicles = useVehicles();
  const saveTransporter = useSaveTransporter();
  const saveVehicle = useSaveVehicle();
  const [adding, setAdding] = useState<"transporter" | "vehicle" | null>(null);

  return (
    <div className="max-w-3xl space-y-4">
      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Transporters</h2>
          <button type="button" className="btn-ghost text-xs" onClick={() => setAdding("transporter")}>
            + Add
          </button>
        </div>
        <ul className="divide-y divide-line">
          {transporters.data?.items.map((transporter) => (
            <li key={transporter.id} className="px-4 py-3">
              <p className="text-sm font-medium">{transporter.name}</p>
              <p className="font-mono text-xs text-muted">
                {transporter.transporterId ?? "No transporter ID"}
              </p>
            </li>
          ))}
          {(transporters.data?.items.length ?? 0) === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">None saved.</li>
          )}
        </ul>
      </section>

      <section className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Vehicles</h2>
          <button type="button" className="btn-ghost text-xs" onClick={() => setAdding("vehicle")}>
            + Add
          </button>
        </div>
        <ul className="divide-y divide-line">
          {vehicles.data?.items.map((vehicle) => (
            <li key={vehicle.id} className="flex items-center gap-3 px-4 py-3">
              <p className="flex-1 font-mono text-sm">{vehicle.vehicleNo}</p>
              {vehicle.vehicleType === "O" && <Pill tone="warn">Over-dimensional</Pill>}
              {vehicle.driverName && <span className="text-xs text-muted">{vehicle.driverName}</span>}
            </li>
          ))}
          {(vehicles.data?.items.length ?? 0) === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">
              Vehicles you use on invoices are remembered automatically.
            </li>
          )}
        </ul>
      </section>

      <Drawer open={adding === "transporter"} onClose={() => setAdding(null)} title="Add transporter">
        <form className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            saveTransporter.mutate({
              name: field(form, "name"),
              transporterId: field(form, "transporterId"),
              phone: field(form, "phone"),
            }, { onSuccess: () => { setAdding(null); show("Transporter added"); } });
          }}>
          <Field label="Name" required><input name="name" className="field" required /></Field>
          <Field label="Transporter ID or GSTIN" hint="15 characters, from the e-Way Bill portal">
            <input name="transporterId" className="field font-mono uppercase" maxLength={15} />
          </Field>
          <Field label="Phone"><input name="phone" className="field" /></Field>
          <ErrorNote error={saveTransporter.error} />
          <button type="submit" className="btn-primary w-full" disabled={saveTransporter.isPending}>
            Add transporter
          </button>
        </form>
      </Drawer>

      <Drawer open={adding === "vehicle"} onClose={() => setAdding(null)} title="Add vehicle">
        <form className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            saveVehicle.mutate({
              vehicleNo: field(form, "vehicleNo").toUpperCase(),
              vehicleType: field(form, "vehicleType"),
              driverName: field(form, "driverName"),
              driverPhone: field(form, "driverPhone"),
            }, { onSuccess: () => { setAdding(null); show("Vehicle added"); } });
          }}>
          <Field label="Vehicle number" required hint="For example MH12AB1234">
            <input name="vehicleNo" className="field font-mono uppercase" required maxLength={15} />
          </Field>
          <Field label="Type">
            <select name="vehicleType" className="field" defaultValue="R">
              <option value="R">Regular</option>
              <option value="O">Over-dimensional cargo</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Driver"><input name="driverName" className="field" /></Field>
            <Field label="Driver phone"><input name="driverPhone" className="field" /></Field>
          </div>
          <ErrorNote error={saveVehicle.error} />
          <button type="submit" className="btn-primary w-full" disabled={saveVehicle.isPending}>
            Add vehicle
          </button>
        </form>
      </Drawer>
    </div>
  );
}
