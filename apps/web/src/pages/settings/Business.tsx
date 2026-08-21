import { GST_STATE_CODES } from "@ewayvo/shared";
import {
  useBranches,
  useGstins,
  useSaveBranch,
  useSaveGstin,
  useSettings,
  useUpdateSettings,
} from "../../api/hooks.js";
import { DrawerForm, SettingsList, SettingsSection, Toggle } from "../../components/forms.js";
import { Pill } from "../../components/status.js";
import { Drawer, Field, Spinner } from "../../components/ui.js";
import { asText, checked, field, numberField } from "../../lib/format.js";
import { useState } from "react";

/**
 * Company profile, registrations and the places goods move from.
 *
 * These are the answers the invoice form stops asking once they are filled
 * in, which is why they sit together rather than being scattered.
 */
export function BusinessSettings({ show }: { show: (message: string) => void }) {
  const settings = useSettings();
  const update = useUpdateSettings();
  const gstins = useGstins();
  const branches = useBranches();
  const saveGstin = useSaveGstin();
  const saveBranch = useSaveBranch();
  const [adding, setAdding] = useState<"gstin" | "branch" | null>(null);

  const business = settings.data?.business;

  return (
    <div className="max-w-3xl space-y-4">
      <SettingsSection title="Company" description="The name that appears on every invoice.">
        <div className="p-4">
          {settings.isLoading ? (
            <Spinner />
          ) : (
            <DrawerForm
              submitLabel="Save"
              pending={update.isPending}
              error={update.error}
              onSubmit={(form) =>
                update.mutate(
                  {
                    businessName: field(form, "businessName"),
                    defaultTerms: field(form, "defaultTerms"),
                    defaultNotes: field(form, "defaultNotes"),
                  },
                  { onSuccess: () => show("Company details saved") },
                )
              }
            >
              <Field label="Business name" required>
                <input name="businessName" className="field" defaultValue={business?.name ?? ""} />
              </Field>
              <Field label="Default terms" hint="Printed at the bottom of every invoice.">
                <textarea
                  name="defaultTerms"
                  className="field min-h-20"
                  defaultValue={asText(settings.data?.settings?.["defaultTerms"])}
                />
              </Field>
              <Field label="Default notes">
                <textarea
                  name="defaultNotes"
                  className="field min-h-16"
                  defaultValue={asText(settings.data?.settings?.["defaultNotes"])}
                />
              </Field>
            </DrawerForm>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="GSTIN registrations"
        description="Each registration keeps its own books, numbering and credentials."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setAdding("gstin")}
          >
            Add GSTIN
          </button>
        }
      >
        <SettingsList
          items={gstins.data?.items}
          loading={gstins.isLoading}
          error={gstins.error}
          keyOf={(g) => g.id}
          empty={{
            title: "No GSTIN added yet",
            description:
              "Add the registration you bill from. It appears on every invoice and decides the tax treatment.",
            action: (
              <button type="button" className="btn-primary" onClick={() => setAdding("gstin")}>
                Add GSTIN
              </button>
            ),
          }}
          renderItem={(gstin) => (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{gstin.tradeName}</p>
                <p className="font-mono text-xs text-muted">{gstin.gstin}</p>
                <p className="text-xs text-muted">
                  {gstin.city}, {GST_STATE_CODES[gstin.stateCode]}
                </p>
              </div>
              {gstin.isPrimary && <Pill tone="good">Main</Pill>}
              {!gstin.isActive && <Pill>Inactive</Pill>}
            </div>
          )}
        />
      </SettingsSection>

      <SettingsSection
        title="Branches, plants and warehouses"
        description="Places goods are dispatched from, when that is not your main address."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!gstins.data?.items.length}
            onClick={() => setAdding("branch")}
          >
            Add place
          </button>
        }
      >
        <SettingsList
          items={branches.data?.items}
          loading={branches.isLoading}
          error={branches.error}
          keyOf={(b) => b.id}
          empty={{
            title: "No places added",
            description:
              "Only needed if goods leave from somewhere other than your billing address — a plant or a warehouse.",
          }}
          renderItem={(branch) => (
            <div className="px-4 py-3">
              <p className="text-sm font-medium">
                {branch.name}
                <span className="ml-2 text-xs text-muted capitalize">{branch.kind}</span>
              </p>
              <p className="text-xs text-muted">
                {branch.addressLine1}, {branch.city} {branch.pincode}
              </p>
            </div>
          )}
        />
      </SettingsSection>

      <Drawer
        open={adding === "gstin"}
        onClose={() => setAdding(null)}
        title="Add GSTIN"
        description="The state code in the GSTIN must match the address state."
      >
        <DrawerForm
          submitLabel="Add GSTIN"
          pending={saveGstin.isPending}
          error={saveGstin.error}
          onSubmit={(form) =>
            saveGstin.mutate(
              {
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
              },
              {
                onSuccess: () => {
                  setAdding(null);
                  show("GSTIN added");
                },
              },
            )
          }
        >
          <Field label="GSTIN" required>
            <input name="gstin" className="field font-mono uppercase" required maxLength={15} />
          </Field>
          <Field label="Legal name" required>
            <input name="legalName" className="field" required />
          </Field>
          <Field label="Trade name" required hint="Shown on the invoice.">
            <input name="tradeName" className="field" required />
          </Field>
          <Field label="Address" required>
            <input name="addressLine1" className="field" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" required>
              <input name="city" className="field" required />
            </Field>
            <Field label="PIN code" required>
              <input name="pincode" className="field" required maxLength={6} />
            </Field>
          </div>
          <Field label="State" required>
            <select name="stateCode" className="field" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input name="phone" className="field" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className="field" />
            </Field>
          </div>
          <Toggle name="isPrimary" label="Use as the default for new invoices" />
        </DrawerForm>
      </Drawer>

      <Drawer open={adding === "branch"} onClose={() => setAdding(null)} title="Add place">
        <DrawerForm
          submitLabel="Add place"
          pending={saveBranch.isPending}
          error={saveBranch.error}
          onSubmit={(form) =>
            saveBranch.mutate(
              {
                gstinId: field(form, "gstinId"),
                name: field(form, "name"),
                kind: field(form, "kind"),
                addressLine1: field(form, "addressLine1"),
                city: field(form, "city"),
                stateCode: field(form, "stateCode"),
                pincode: field(form, "pincode"),
                isDefault: false,
              },
              {
                onSuccess: () => {
                  setAdding(null);
                  show("Place added");
                },
              },
            )
          }
        >
          <Field label="Belongs to GSTIN" required>
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
          <Field label="Address" required>
            <input name="addressLine1" className="field" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" required>
              <input name="city" className="field" required />
            </Field>
            <Field label="PIN code" required>
              <input name="pincode" className="field" required maxLength={6} />
            </Field>
          </div>
          <Field label="State" required>
            <select name="stateCode" className="field" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              ))}
            </select>
          </Field>
        </DrawerForm>
      </Drawer>
    </div>
  );
}

export { numberField };
