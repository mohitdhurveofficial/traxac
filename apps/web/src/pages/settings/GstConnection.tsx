import { useState } from "react";
import {
  useCredentials,
  useDeleteCredential,
  useGstins,
  useSaveCredential,
  useTestCredential,
} from "../../api/hooks.js";
import { DrawerForm, SettingsList, SettingsSection, useConfirm } from "../../components/forms.js";
import { Pill } from "../../components/status.js";
import { Drawer, Field } from "../../components/ui.js";
import { field, formatDateTime } from "../../lib/format.js";

/**
 * The GST API connection.
 *
 * This is the only screen in the product that uses portal vocabulary — client
 * id, sandbox, IRP — and it is deliberately the last tab. A business that
 * never connects one can use everything else without meeting any of this.
 *
 * Nothing here simulates a connection. With no credentials, compliance
 * actions fail with a clear message and the rest of the product carries on.
 */
export function GstConnectionSettings({ show }: { show: (message: string) => void }) {
  const gstins = useGstins();
  const credentials = useCredentials();
  const save = useSaveCredential();
  const test = useTestCredential();
  const remove = useDeleteCredential();
  const { confirm, dialog } = useConfirm();

  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const connected = (credentials.data?.items.length ?? 0) > 0;

  return (
    <div className="max-w-3xl space-y-4">
      {!connected && (
        <div className="rounded-xl border border-line bg-slate-50 p-4">
          <p className="text-sm font-medium">You do not need this to use Traxac.</p>
          <p className="mt-1 text-sm text-muted">
            Invoicing, PDFs, customers, payments and reports all work without it. A connection is
            only needed to get an IRN or an e-Way Bill from the Government portal — which is
            mandatory only above the turnover threshold.
          </p>
        </div>
      )}

      <SettingsSection
        title="Connections"
        description="One per registration, per service. Credentials are encrypted and never shown again."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!gstins.data?.items.length}
            onClick={() => setAdding(true)}
          >
            Add connection
          </button>
        }
      >
        <SettingsList
          items={credentials.data?.items}
          loading={credentials.isLoading}
          error={credentials.error}
          keyOf={(c) => c.id}
          empty={{
            title: "Not connected",
            description:
              "Add the API credentials issued by NIC or your GSP to generate e-Invoices and e-Way Bills.",
            action: gstins.data?.items.length ? (
              <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
                Add connection
              </button>
            ) : (
              <p className="text-sm text-muted">Add a GSTIN registration first.</p>
            ),
          }}
          renderItem={(credential) => (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {credential.service === "einvoice" ? "e-Invoice" : "e-Way Bill"}
                  <span className="ml-2 font-mono text-xs text-muted">{credential.gstin}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {credential.usernameHint}
                  {credential.lastVerifiedAt &&
                    ` · checked ${formatDateTime(credential.lastVerifiedAt)}`}
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
                {credential.environment === "production" ? "Live" : "Test"}
              </Pill>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(credential.id, {
                    onSuccess: (response) =>
                      setResult({
                        id: credential.id,
                        ok: response.ok,
                        message: response.ok
                          ? "Connected successfully."
                          : (response.error?.message ?? "Could not connect."),
                      }),
                  })
                }
              >
                Test
              </button>
              <button
                type="button"
                className="btn-ghost px-2 text-muted hover:text-red-600"
                aria-label="Remove connection"
                onClick={() =>
                  confirm(
                    "Remove this connection? e-Invoices and e-Way Bills will stop working for this registration until you add it again.",
                    () =>
                      remove.mutate(credential.id, { onSuccess: () => show("Connection removed") }),
                  )
                }
              >
                ×
              </button>
            </div>
          )}
        />
      </SettingsSection>

      <SettingsSection title="Where credentials come from">
        <div className="space-y-2 px-4 py-4 text-sm text-muted">
          <p>
            Businesses above ₹100 crore turnover can register directly with NIC. Below that, the
            credentials come from a GSP or an ERP partner, who issues the client ID and secret.
          </p>
          <p>
            Keep the environment on <strong>Test</strong> until a document has gone through
            successfully. Switching to Live files real documents against your GSTIN.
          </p>
        </div>
      </SettingsSection>

      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        title="Add GST connection"
        description="Stored encrypted. The password is never shown again after saving."
        wide
      >
        <DrawerForm
          submitLabel="Save connection"
          pending={save.isPending}
          error={save.error}
          onSubmit={(form) =>
            save.mutate(
              {
                gstinId: field(form, "gstinId"),
                provider: "nic",
                environment: field(form, "environment"),
                service: field(form, "service"),
                username: field(form, "username"),
                password: field(form, "password"),
                clientId: field(form, "clientId"),
                clientSecret: field(form, "clientSecret"),
                baseUrl: field(form, "baseUrl"),
              },
              {
                onSuccess: () => {
                  setAdding(false);
                  show("Connection saved — use Test to check it");
                },
              },
            )
          }
        >
          <Field label="Registration" required>
            <select name="gstinId" className="field" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {gstins.data?.items.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.tradeName} — {g.gstin}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service" required>
              <select name="service" className="field" defaultValue="einvoice">
                <option value="einvoice">e-Invoice</option>
                <option value="ewb">e-Way Bill</option>
              </select>
            </Field>
            <Field label="Environment" required>
              <select name="environment" className="field" defaultValue="sandbox">
                <option value="sandbox">Test</option>
                <option value="production">Live</option>
              </select>
            </Field>
          </div>
          <Field label="API username" required hint="The API user, not your portal login.">
            <input name="username" className="field" required autoComplete="off" />
          </Field>
          <Field label="API password" required>
            <input
              name="password"
              type="password"
              className="field"
              required
              autoComplete="new-password"
            />
          </Field>
          <Field label="Client ID" hint="From NIC or your GSP.">
            <input name="clientId" className="field" autoComplete="off" />
          </Field>
          <Field label="Client secret">
            <input
              name="clientSecret"
              type="password"
              className="field"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Base URL" hint="Only if your provider gave you one.">
            <input name="baseUrl" className="field" placeholder="https://…" />
          </Field>
        </DrawerForm>
      </Drawer>

      {dialog}
    </div>
  );
}
