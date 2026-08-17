import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GST_STATE_CODES } from "@traxac/shared";
import { useAddPartyAddress, useParties, useParty, useSaveParty } from "../api/hooks.js";
import type { Party } from "../api/types.js";
import { Page, PageHeader } from "../components/shell.js";
import { Drawer, EmptyState, ErrorNote, Field, SearchInput, Spinner, useToast } from "../components/ui.js";

/**
 * Customers.
 *
 * Delivery addresses live here rather than on the invoice, because a site or
 * warehouse gets billed to repeatedly — entering it once is the point.
 */
export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const { toast, show } = useToast();

  const parties = useParties({ q, limit: 50 });

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={parties.data ? `${parties.data.total} saved` : undefined}
        actions={
          <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
            Add customer
          </button>
        }
      >
        <div className="sm:max-w-sm">
          <SearchInput value={q} placeholder="Name, GSTIN, city, phone…"
            onChange={(next) => setParams(next ? { q: next } : {}, { replace: true })} />
        </div>
      </PageHeader>

      <Page>
        <ErrorNote error={parties.error} />
        {parties.isLoading ? (
          <div className="grid place-items-center py-24 text-muted"><Spinner className="size-6" /></div>
        ) : (parties.data?.items.length ?? 0) === 0 ? (
          <div className="card">
            <EmptyState
              title={q ? "No customers match this" : "No customers yet"}
              description="Customers you bill get saved here, so the next invoice takes seconds."
              action={<button type="button" className="btn-primary" onClick={() => setEditing("new")}>
                Add customer
              </button>}
            />
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {parties.data?.items.map((party) => (
              <li key={party.id}>
                <button type="button" onClick={() => setViewing(party.id)}
                  className="card w-full p-4 text-left hover:border-brand-500 hover:shadow-sm">
                  <p className="truncate font-medium">{party.name}</p>
                  {party.gstin && <p className="mt-0.5 font-mono text-xs text-muted">{party.gstin}</p>}
                  <p className="mt-1.5 truncate text-xs text-muted">
                    {[party.city, party.stateCode ? GST_STATE_CODES[party.stateCode] : null]
                      .filter(Boolean).join(", ") || "No address"}
                  </p>
                  {party.phone && <p className="text-xs text-muted">{party.phone}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Page>

      <PartyForm
        party={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); show("Customer saved"); }}
      />
      <PartyDetailDrawer
        partyId={viewing}
        onClose={() => setViewing(null)}
        onEdit={(party) => { setViewing(null); setEditing(party); }}
        onSaved={() => show("Address added")}
      />
      {toast}
    </>
  );
}

function PartyForm({
  party, open, onClose, onSaved,
}: { party: Party | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const save = useSaveParty(party?.id);
  return (
    <Drawer open={open} onClose={onClose}
      title={party ? "Edit customer" : "Add customer"}
      description="Only the name and state are required.">
      <form className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const gstin = String(data.get("gstin") || "").trim();
          save.mutate({
            name: String(data.get("name")),
            legalName: String(data.get("legalName") || ""),
            gstin,
            registrationType: gstin ? "regular" : "unregistered",
            email: String(data.get("email") || ""),
            phone: String(data.get("phone") || ""),
            addressLine1: String(data.get("addressLine1") || ""),
            city: String(data.get("city") || ""),
            stateCode: String(data.get("stateCode") || ""),
            pincode: String(data.get("pincode") || ""),
            country: "IN",
            partyType: "customer",
          }, { onSuccess: onSaved });
        }}>
        <Field label="Business name" required>
          <input name="name" className="field" required defaultValue={party?.name} />
        </Field>
        <Field label="Legal name" hint="If different from the trade name">
          <input name="legalName" className="field" defaultValue={party?.legalName ?? ""} />
        </Field>
        <Field label="GSTIN" hint="Leave blank for an unregistered buyer">
          <input name="gstin" className="field font-mono uppercase" maxLength={15}
            defaultValue={party?.gstin ?? ""} />
        </Field>
        <Field label="State" required>
          <select name="stateCode" className="field" required defaultValue={party?.stateCode ?? ""}>
            <option value="" disabled>Select…</option>
            {Object.entries(GST_STATE_CODES).map(([code, name]) => (
              <option key={code} value={code}>{code} — {name}</option>
            ))}
          </select>
        </Field>
        <Field label="Address">
          <input name="addressLine1" className="field" defaultValue={party?.addressLine1 ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City"><input name="city" className="field" defaultValue={party?.city ?? ""} /></Field>
          <Field label="PIN code">
            <input name="pincode" className="field" maxLength={6} defaultValue={party?.pincode ?? ""} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input name="phone" className="field" defaultValue={party?.phone ?? ""} /></Field>
          <Field label="Email">
            <input name="email" type="email" className="field" defaultValue={party?.email ?? ""} />
          </Field>
        </div>
        <ErrorNote error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending && <Spinner />} Save customer
        </button>
      </form>
    </Drawer>
  );
}

function PartyDetailDrawer({
  partyId, onClose, onEdit, onSaved,
}: {
  partyId: string | null;
  onClose: () => void;
  onEdit: (party: Party) => void;
  onSaved: () => void;
}) {
  const party = useParty(partyId ?? undefined);
  const addAddress = useAddPartyAddress(partyId ?? "");
  const [adding, setAdding] = useState(false);

  return (
    <Drawer open={partyId !== null} onClose={onClose}
      title={party.data?.name ?? "Customer"}
      description={party.data?.gstin ?? undefined}
      footer={party.data && (
        <button type="button" className="btn-secondary w-full" onClick={() => onEdit(party.data)}>
          Edit details
        </button>
      )}>
      {party.isLoading && <div className="grid place-items-center py-12"><Spinner /></div>}
      {party.data && (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Billing address</p>
            <p className="mt-1.5 text-sm">
              {[party.data.addressLine1, party.data.city, party.data.pincode,
                party.data.stateCode ? GST_STATE_CODES[party.data.stateCode] : null]
                .filter(Boolean).join(", ") || "Not set"}
            </p>
            {party.data.phone && <p className="mt-1 text-sm text-muted">{party.data.phone}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">Delivery addresses</p>
              <button type="button" className="btn-ghost text-xs" onClick={() => setAdding(!adding)}>
                {adding ? "Cancel" : "+ Add"}
              </button>
            </div>

            {adding && (
              <form className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  addAddress.mutate({
                    label: String(data.get("label")),
                    kind: "shipping",
                    name: String(data.get("name")),
                    gstin: String(data.get("gstin") || ""),
                    addressLine1: String(data.get("addressLine1")),
                    city: String(data.get("city")),
                    stateCode: String(data.get("stateCode")),
                    pincode: String(data.get("pincode")),
                    isDefault: false,
                  }, { onSuccess: () => { setAdding(false); onSaved(); } });
                }}>
                <Field label="Label" required>
                  <input name="label" className="field" required placeholder="Hosur site store" />
                </Field>
                <Field label="Consignee name" required>
                  <input name="name" className="field" required defaultValue={party.data.name} />
                </Field>
                <Field label="GSTIN at this location" hint="Leave blank if the same registration">
                  <input name="gstin" className="field font-mono uppercase" maxLength={15} />
                </Field>
                <Field label="Address" required>
                  <input name="addressLine1" className="field" required />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="City" required><input name="city" className="field" required /></Field>
                  <Field label="PIN" required>
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
                <ErrorNote error={addAddress.error} />
                <button type="submit" className="btn-primary w-full" disabled={addAddress.isPending}>
                  Save address
                </button>
              </form>
            )}

            <ul className="mt-3 space-y-2">
              {party.data.addresses.map((address) => (
                <li key={address.id} className="rounded-lg border border-line p-3 text-sm">
                  <p className="font-medium">{address.label}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {[address.addressLine1, address.city, address.pincode,
                      GST_STATE_CODES[address.stateCode]].filter(Boolean).join(", ")}
                  </p>
                  {address.gstin && <p className="mt-1 font-mono text-[11px]">{address.gstin}</p>}
                </li>
              ))}
              {party.data.addresses.length === 0 && !adding && (
                <p className="text-sm text-muted">
                  None yet. Add one if goods go somewhere other than the billing address.
                </p>
              )}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}
