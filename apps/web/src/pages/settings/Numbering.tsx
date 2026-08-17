import { useState } from "react";
import { useNumberSeries, useUpdateNumberSeries } from "../../api/hooks.js";
import { DrawerForm, SettingsList, SettingsSection } from "../../components/forms.js";
import { Drawer, Field } from "../../components/ui.js";
import { field, numberField } from "../../lib/format.js";

const DOC_LABEL: Record<string, string> = {
  invoice: "Tax invoice",
  credit_note: "Credit note",
  debit_note: "Debit note",
  delivery_challan: "Delivery challan",
  bill_of_supply: "Bill of supply",
};

/**
 * Document numbering.
 *
 * A series is created the first time a document type is issued, so this page
 * shows what exists rather than asking the user to set it up in advance.
 *
 * The next number can be moved forward but never back: GST requires a
 * consecutive series, and reusing a number that has already been issued is
 * the kind of mistake that surfaces at assessment.
 */
export function NumberingSettings({ show }: { show: (message: string) => void }) {
  const series = useNumberSeries();
  const [editing, setEditing] = useState<string | null>(null);
  const current = series.data?.items.find((s) => s.id === editing);
  const update = useUpdateNumberSeries(editing ?? "");

  const preview = (item: {
    prefix: string;
    series: string;
    financialYear: string;
    padding: number;
    suffix: string;
    nextNumber: number;
  }): string =>
    `${item.prefix}${item.series}/${item.financialYear}/${String(item.nextNumber).padStart(item.padding, "0")}${item.suffix}`;

  return (
    <div className="max-w-3xl space-y-4">
      <SettingsSection
        title="Invoice numbering"
        description="One series per document type, per registration, per financial year."
      >
        <SettingsList
          items={series.data?.items}
          loading={series.isLoading}
          error={series.error}
          keyOf={(s) => s.id}
          empty={{
            title: "No series yet",
            description:
              "A numbering series is created automatically the first time you issue a document of that type.",
          }}
          renderItem={(item) => (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {DOC_LABEL[item.docType] ?? item.docType}
                  <span className="ml-2 text-xs text-muted">FY {item.financialYear}</span>
                </p>
                <p className="mt-0.5 font-mono text-xs text-muted">Next: {preview(item)}</p>
              </div>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setEditing(item.id)}
              >
                Change
              </button>
            </div>
          )}
        />
      </SettingsSection>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Change numbering"
        description={
          current ? `${DOC_LABEL[current.docType]} · FY ${current.financialYear}` : undefined
        }
      >
        {current && (
          <DrawerForm
            submitLabel="Save numbering"
            pending={update.isPending}
            error={update.error}
            onSubmit={(form) =>
              update.mutate(
                {
                  prefix: field(form, "prefix"),
                  suffix: field(form, "suffix"),
                  padding: numberField(form, "padding"),
                  nextNumber: numberField(form, "nextNumber"),
                },
                {
                  onSuccess: () => {
                    setEditing(null);
                    show("Numbering updated");
                  },
                },
              )
            }
          >
            <div className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm">
              {preview(current)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prefix" hint="Before the series code.">
                <input
                  name="prefix"
                  className="field"
                  defaultValue={current.prefix}
                  maxLength={10}
                />
              </Field>
              <Field label="Suffix">
                <input
                  name="suffix"
                  className="field"
                  defaultValue={current.suffix}
                  maxLength={10}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Digits" hint="0001 is four digits.">
                <input
                  name="padding"
                  type="number"
                  min="1"
                  max="10"
                  className="field"
                  defaultValue={current.padding}
                />
              </Field>
              <Field
                label="Next number"
                hint="Can be moved forward only — issued numbers cannot be reused."
              >
                <input
                  name="nextNumber"
                  type="number"
                  min={current.nextNumber}
                  className="field"
                  defaultValue={current.nextNumber}
                />
              </Field>
            </div>
          </DrawerForm>
        )}
      </Drawer>
    </div>
  );
}
