import { useState } from "react";
import {
  useCredentials,
  useDeleteCredential,
  useGstins,
  useSaveCredential,
  useTestCredential,
} from "../../api/hooks.js";
import type { Credential } from "../../api/types.js";
import { DrawerForm, SettingsSection, useConfirm } from "../../components/forms.js";
import { Pill } from "../../components/status.js";
import { Drawer, Field, Spinner } from "../../components/ui.js";
import { field, formatDateTime } from "../../lib/format.js";

/**
 * GST connections.
 *
 * Organised by registration, not by credential row, because that is how a
 * business thinks: "is my Maharashtra GSTIN connected?" — not "how many
 * credential records do I have?". Each registration shows the two services
 * side by side so a half-finished setup is obvious at a glance rather than
 * being an absence you have to notice.
 *
 * This is the only screen in the product that uses portal vocabulary, and it
 * is deliberately the last tab. A business that never connects one can use
 * everything else without meeting any of it.
 *
 * "Connected" here means a real authentication succeeded — never merely that
 * credentials were saved. Nothing on this screen simulates a connection.
 */

const SERVICES = [
  {
    key: "einvoice" as const,
    label: "e-Invoice",
    blurb: "Gets the IRN and signed QR code for your invoices.",
  },
  {
    key: "ewb" as const,
    label: "e-Way Bill",
    blurb: "Generates the e-Way Bill for goods in transit.",
  },
];

type TestResult = { ok: boolean; message: string };

export function GstConnectionSettings({ show }: { show: (message: string) => void }) {
  const gstins = useGstins();
  const credentials = useCredentials();
  const save = useSaveCredential();
  const test = useTestCredential();
  const remove = useDeleteCredential();
  const { confirm, dialog } = useConfirm();

  /** Which registration + service the drawer is currently editing. */
  const [connecting, setConnecting] = useState<{
    gstinId: string;
    gstin: string;
    service: "einvoice" | "ewb";
    existing?: Credential;
  } | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  const registrations = gstins.data?.items ?? [];
  const anyConnected = (credentials.data?.items.length ?? 0) > 0;

  const credentialFor = (gstinId: string, service: string): Credential | undefined =>
    credentials.data?.items.find((c) => c.gstinId === gstinId && c.service === service);

  const runTest = (credential: Credential): void => {
    test.mutate(credential.id, {
      onSuccess: (response) =>
        setResults((prev) => ({
          ...prev,
          [credential.id]: {
            ok: response.ok,
            message: response.ok
              ? "Connected successfully."
              : // The server already reduces portal errors to safe language.
                (response.error?.message ?? "Could not connect. Check the credentials."),
          },
        })),
    });
  };

  if (gstins.isLoading || credentials.isLoading) {
    return (
      <div className="grid place-items-center py-16 text-muted">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      {!anyConnected && (
        <div className="rounded-xl border border-line bg-slate-50 p-4">
          <p className="text-sm font-medium">You do not need this to use Ewayvo.</p>
          <p className="mt-1 text-sm text-muted">
            Invoicing, PDFs, customers, payments and reports all work without it. Connect a service
            only when you need an IRN or an e-Way Bill from the Government portal — which is
            mandatory only above the turnover threshold.
          </p>
        </div>
      )}

      {registrations.length === 0 ? (
        <SettingsSection title="GST connections">
          <p className="px-4 py-6 text-sm text-muted">
            Add a GSTIN registration under <strong>Business</strong> first. Connections belong to a
            registration, so there is nothing to connect yet.
          </p>
        </SettingsSection>
      ) : (
        registrations.map((registration) => (
          <SettingsSection
            key={registration.id}
            title={registration.tradeName || registration.legalName}
            description={registration.gstin}
          >
            <div className="divide-y divide-line">
              {SERVICES.map((service) => {
                const credential = credentialFor(registration.id, service.key);
                const result = credential ? results[credential.id] : undefined;
                return (
                  <div key={service.key} className="flex flex-wrap items-start gap-3 px-4 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{service.label}</p>
                        <ConnectionStatus credential={credential} />
                        {credential && (
                          <Pill tone={credential.environment === "production" ? "good" : "warn"}>
                            {credential.environment === "production" ? "Live" : "Test"}
                          </Pill>
                        )}
                      </div>

                      <p className="mt-1 text-xs text-muted">
                        {credential ? (
                          <>
                            {credential.usernameHint}
                            {credential.lastVerifiedAt
                              ? ` · last verified ${formatDateTime(credential.lastVerifiedAt)}`
                              : " · not verified yet"}
                          </>
                        ) : (
                          service.blurb
                        )}
                      </p>

                      {credential?.lastError && !result && (
                        <p className="mt-1 text-xs text-red-600">{credential.lastError}</p>
                      )}
                      {result && (
                        <p
                          className={`mt-1 text-xs ${result.ok ? "text-emerald-700" : "text-red-600"}`}
                        >
                          {result.message}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {credential ? (
                        <>
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={test.isPending}
                            onClick={() => runTest(credential)}
                          >
                            {test.isPending ? "Testing…" : "Test connection"}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() =>
                              setConnecting({
                                gstinId: registration.id,
                                gstin: registration.gstin,
                                service: service.key,
                                existing: credential,
                              })
                            }
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs text-muted hover:text-red-600"
                            onClick={() =>
                              confirm(
                                `Disconnect ${service.label} for ${registration.gstin}? ` +
                                  "Invoicing continues to work, but Ewayvo will stop requesting " +
                                  "documents from the Government portal for this registration.",
                                () =>
                                  remove.mutate(credential.id, {
                                    onSuccess: () => show(`${service.label} disconnected`),
                                  }),
                              )
                            }
                          >
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          onClick={() =>
                            setConnecting({
                              gstinId: registration.id,
                              gstin: registration.gstin,
                              service: service.key,
                            })
                          }
                        >
                          Connect {service.label}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SettingsSection>
        ))
      )}

      <SettingsSection title="Where credentials come from">
        <div className="space-y-2 px-4 py-4 text-sm text-muted">
          <p>
            Businesses above ₹100 crore turnover can register directly with NIC. Below that, the
            credentials come from a GSP or an ERP partner, who issues the client ID and secret.
          </p>
          <p>
            The API username and password are created on the Government portal specifically for API
            access — they are not your normal portal login.
          </p>
          <p>
            Keep the environment on <strong>Test</strong> until a document has gone through
            successfully. Switching to Live files real documents against your GSTIN.
          </p>
        </div>
      </SettingsSection>

      <Drawer
        open={connecting !== null}
        onClose={() => setConnecting(null)}
        title={
          connecting
            ? `${connecting.existing ? "Replace" : "Connect"} ${
                connecting.service === "einvoice" ? "e-Invoice" : "e-Way Bill"
              }`
            : ""
        }
        description={
          connecting
            ? `For ${connecting.gstin}. Stored encrypted — the password is never shown again.`
            : ""
        }
        wide
      >
        {connecting && (
          <DrawerForm
            submitLabel={connecting.existing ? "Replace credentials" : "Save and connect"}
            pending={save.isPending}
            error={save.error}
            onSubmit={(form) =>
              save.mutate(
                {
                  // The registration and service come from the card that was
                  // clicked, never from a field the user could mismatch.
                  gstinId: connecting.gstinId,
                  service: connecting.service,
                  provider: "nic",
                  environment: field(form, "environment"),
                  username: field(form, "username"),
                  password: field(form, "password"),
                  clientId: field(form, "clientId"),
                  clientSecret: field(form, "clientSecret"),
                  baseUrl: field(form, "baseUrl"),
                },
                {
                  onSuccess: () => {
                    setConnecting(null);
                    show("Saved — use Test connection to check it");
                  },
                },
              )
            }
          >
            <Field
              label="Environment"
              required
              hint="Test until a document has gone through successfully."
            >
              <select
                name="environment"
                className="field"
                defaultValue={connecting.existing?.environment ?? "sandbox"}
              >
                <option value="sandbox">Test</option>
                <option value="production">Live</option>
              </select>
            </Field>
            <Field label="API username" required hint="The API user, not your portal login.">
              <input name="username" className="field" required autoComplete="off" />
            </Field>
            <Field
              label="API password"
              required
              hint="Together with the username, keep this under about 66 characters — the portal's encryption cannot carry more."
            >
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
        )}
      </Drawer>

      {dialog}
    </div>
  );
}

/**
 * The status a business actually cares about.
 *
 * Saved credentials are not a connection. Until an authentication has
 * succeeded this reads "Not verified", because telling someone they are
 * connected and then failing at the moment they raise an invoice is worse
 * than telling them to press Test.
 */
function ConnectionStatus({ credential }: { credential?: Credential }) {
  if (!credential) return <Pill tone="neutral">Not connected</Pill>;
  if (credential.status === "failed" || credential.lastError) {
    return <Pill tone="bad">Needs attention</Pill>;
  }
  if (!credential.lastVerifiedAt) return <Pill tone="warn">Not verified</Pill>;
  return <Pill tone="good">Connected</Pill>;
}
