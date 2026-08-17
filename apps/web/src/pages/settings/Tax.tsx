import { useState } from "react";
import {
  useGstins,
  usePaymentTerms,
  useSaveHsn,
  useSavePaymentTerm,
  useSaveTaxSettings,
  useTaxSettings,
  useUnits,
} from "../../api/hooks.js";
import { DrawerForm, SettingsList, SettingsSection, Toggle } from "../../components/forms.js";
import { Pill } from "../../components/status.js";
import { Drawer, Field, SearchInput, Spinner } from "../../components/ui.js";
import { asText, checked, field, numberField } from "../../lib/format.js";

/**
 * Tax and commercial configuration.
 *
 * Set once per registration and then forgotten, which is why none of it
 * appears on the invoice form. TCS in particular is off by default: a
 * business that does not collect it should never see the field.
 */
export function TaxSettings({ show }: { show: (message: string) => void }) {
  const gstins = useGstins();
  const [gstinId, setGstinId] = useState<string>("");
  const activeGstin = gstinId || gstins.data?.items[0]?.id || "";

  const taxSettings = useTaxSettings(activeGstin || undefined);
  const saveTax = useSaveTaxSettings(activeGstin);
  const terms = usePaymentTerms();
  const saveTerm = useSavePaymentTerm();
  const saveHsn = useSaveHsn();
  const units = useUnits();

  const [addingTerm, setAddingTerm] = useState(false);
  const [addingHsn, setAddingHsn] = useState(false);
  const [unitQuery, setUnitQuery] = useState("");

  const settings = taxSettings.data;
  const visibleUnits = (units.data?.items ?? []).filter(
    (unit) =>
      !unitQuery ||
      unit.code.toLowerCase().includes(unitQuery.toLowerCase()) ||
      unit.description.toLowerCase().includes(unitQuery.toLowerCase()),
  );

  return (
    <div className="max-w-3xl space-y-4">
      <SettingsSection
        title="Tax treatment"
        description="Applies to invoices raised under this registration."
        action={
          (gstins.data?.items.length ?? 0) > 1 ? (
            <select
              className="field w-auto text-xs"
              value={activeGstin}
              onChange={(event) => setGstinId(event.target.value)}
            >
              {gstins.data?.items.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.tradeName}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        <div className="p-4">
          {taxSettings.isLoading || !activeGstin ? (
            <Spinner />
          ) : (
            <DrawerForm
              submitLabel="Save tax settings"
              pending={saveTax.isPending}
              error={saveTax.error}
              onSubmit={(form) =>
                saveTax.mutate(
                  {
                    tcsEnabled: checked(form, "tcsEnabled"),
                    tcsRate: numberField(form, "tcsRate"),
                    tcsSection: field(form, "tcsSection") || "206C(1H)",
                    roundOffEnabled: checked(form, "roundOffEnabled"),
                    igstOnIntraDefault: checked(form, "igstOnIntraDefault"),
                  },
                  { onSuccess: () => show("Tax settings saved") },
                )
              }
            >
              <Toggle
                name="roundOffEnabled"
                label="Round invoice totals to the nearest rupee"
                hint="Most businesses leave this on. The rounding is shown as a separate line."
                defaultChecked={settings?.["roundOffEnabled"] !== false}
              />
              <Toggle
                name="tcsEnabled"
                label="Collect TCS under section 206C(1H)"
                hint="Only if your turnover crosses the threshold and you collect TCS on sales."
                defaultChecked={Boolean(settings?.["tcsEnabled"])}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="TCS rate %" hint="Usually 0.1">
                  <input
                    name="tcsRate"
                    type="number"
                    step="0.001"
                    className="field"
                    defaultValue={asText(settings?.["tcsRate"], "0.1")}
                  />
                </Field>
                <Field label="Section">
                  <input
                    name="tcsSection"
                    className="field"
                    defaultValue={asText(settings?.["tcsSection"], "206C(1H)")}
                  />
                </Field>
              </div>
              <Toggle
                name="igstOnIntraDefault"
                label="Charge IGST on same-state supplies by default"
                hint="Rare. Only for supplies covered by section 10(1)(b)."
                defaultChecked={Boolean(settings?.["igstOnIntraDefault"])}
              />
            </DrawerForm>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Payment terms"
        description="Sets the due date on new invoices, and drives the overdue report."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setAddingTerm(true)}
          >
            Add terms
          </button>
        }
      >
        <SettingsList
          items={terms.data?.items}
          loading={terms.isLoading}
          error={terms.error}
          keyOf={(t) => t.id}
          empty={{
            title: "No payment terms yet",
            description:
              'Add the terms you offer, such as "Net 30", and the due date fills itself in.',
            action: (
              <button type="button" className="btn-primary" onClick={() => setAddingTerm(true)}>
                Add terms
              </button>
            ),
          }}
          renderItem={(term) => (
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{term.name}</p>
                <p className="text-xs text-muted">
                  {term.creditDays === 0 ? "Due immediately" : `Due in ${term.creditDays} days`}
                  {term.description ? ` · ${term.description}` : ""}
                </p>
              </div>
              {term.isDefault && <Pill tone="good">Default</Pill>}
            </div>
          )}
        />
      </SettingsSection>

      <SettingsSection
        title="HSN and SAC codes"
        description="Shared reference data. Add a code only if the built-in list is missing it."
        action={
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setAddingHsn(true)}
          >
            Add code
          </button>
        }
      >
        <div className="px-4 py-4 text-sm text-muted">
          Items carry their own HSN, so most businesses never need to touch this. Codes added here
          become available in the item form's suggestions.
        </div>
      </SettingsSection>

      <SettingsSection
        title="Units"
        description="The unit codes the Government accepts. Read-only — the list is fixed by GSTN."
      >
        <div className="border-b border-line px-4 py-3">
          <div className="sm:max-w-xs">
            <SearchInput value={unitQuery} onChange={setUnitQuery} placeholder="Find a unit…" />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <SettingsList
            items={visibleUnits}
            loading={units.isLoading}
            error={units.error}
            keyOf={(u) => u.code}
            empty={{ title: "No unit matches that" }}
            renderItem={(unit) => (
              <div className="flex items-center gap-3 px-4 py-2">
                <span className="w-14 font-mono text-xs">{unit.code}</span>
                <span className="flex-1 text-sm">{unit.description}</span>
                {unit.qtyDecimals > 0 && (
                  <span className="text-xs text-muted">{unit.qtyDecimals} dp</span>
                )}
              </div>
            )}
          />
        </div>
      </SettingsSection>

      <Drawer open={addingTerm} onClose={() => setAddingTerm(false)} title="Add payment terms">
        <DrawerForm
          submitLabel="Add terms"
          pending={saveTerm.isPending}
          error={saveTerm.error}
          onSubmit={(form) =>
            saveTerm.mutate(
              {
                name: field(form, "name"),
                creditDays: numberField(form, "creditDays"),
                description: field(form, "description"),
                isDefault: checked(form, "isDefault"),
              },
              {
                onSuccess: () => {
                  setAddingTerm(false);
                  show("Payment terms added");
                },
              },
            )
          }
        >
          <Field label="Name" required hint='For example "Net 30" or "Advance".'>
            <input name="name" className="field" required />
          </Field>
          <Field label="Credit days" required hint="0 means payment is due immediately.">
            <input
              name="creditDays"
              type="number"
              min="0"
              max="365"
              className="field"
              defaultValue="30"
            />
          </Field>
          <Field label="Wording on the invoice">
            <input name="description" className="field" placeholder="Payment within 30 days" />
          </Field>
          <Toggle name="isDefault" label="Use these terms by default on new invoices" />
        </DrawerForm>
      </Drawer>

      <Drawer open={addingHsn} onClose={() => setAddingHsn(false)} title="Add HSN or SAC code">
        <DrawerForm
          submitLabel="Add code"
          pending={saveHsn.isPending}
          error={saveHsn.error}
          onSubmit={(form) =>
            saveHsn.mutate(
              {
                code: field(form, "code"),
                description: field(form, "description"),
                defaultGstRate: numberField(form, "defaultGstRate"),
                isService: checked(form, "isService"),
              },
              {
                onSuccess: () => {
                  setAddingHsn(false);
                  show("Code added");
                },
              },
            )
          }
        >
          <Field label="Code" required hint="4, 6 or 8 digits. SAC codes start with 99.">
            <input name="code" className="field font-mono" required maxLength={8} />
          </Field>
          <Field label="Description" required>
            <input name="description" className="field" required />
          </Field>
          <Field label="Usual GST rate">
            <select name="defaultGstRate" className="field" defaultValue="18">
              {["0", "0.25", "3", "5", "12", "18", "28"].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}%
                </option>
              ))}
            </select>
          </Field>
          <Toggle name="isService" label="This is a service (SAC), not goods" />
        </DrawerForm>
      </Drawer>
    </div>
  );
}
