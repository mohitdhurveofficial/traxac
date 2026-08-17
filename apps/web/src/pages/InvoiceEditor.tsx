import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  calculateInvoiceTax, evaluateEwbRequirement, GST_STATE_CODES, UQC_UNITS,
} from "@traxac/shared";
import {
  useBranches, useGstins, useInvoice, useNextInvoiceNumber, useParties, useParty,
  useProducts, useSaveInvoice, useSaveParty, useSaveProduct, useTransporters,
} from "../api/hooks.js";
import type { Party, Product } from "../api/types.js";
import { Page, PageHeader } from "../components/shell.js";
import { Picker, Section } from "../components/pickers.js";
import { Drawer, ErrorNote, Field, Spinner, useToast } from "../components/ui.js";
import { checked, dateInputValue, field, money, numberField, toPaise } from "../lib/format.js";

/**
 * Invoice editor.
 *
 * The visible form is deliberately short: customer, items, save. Everything
 * else — ship-to, dispatch-from, transport, charges, notes — is collapsed
 * until it is needed, because most invoices never need it.
 *
 * Totals are computed in the browser with the **same** engine the server uses
 * (`calculateInvoiceTax` from @traxac/shared), so the number on screen is the
 * number that gets filed. There is no second implementation to drift.
 */

interface LineDraft {
  key: string;
  productId: string | null;
  name: string;
  description: string;
  hsnSac: string;
  isService: boolean;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPercent: string;
  gstRate: string;
}

interface ChargeDraft {
  key: string;
  label: string;
  kind: string;
  hsnSac: string;
  amount: string;
  gstRate: string;
}

const newKey = (): string => Math.random().toString(36).slice(2, 10);

const emptyLine = (): LineDraft => ({
  key: newKey(),
  productId: null,
  name: "",
  description: "",
  hsnSac: "",
  isService: false,
  quantity: "1",
  unit: "NOS",
  unitPrice: "",
  discountPercent: "0",
  gstRate: "18",
});

export function InvoiceEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast, show } = useToast();

  const existing = useInvoice(id);
  const gstins = useGstins();
  const save = useSaveInvoice(id);

  /* ------------------------------- state ------------------------------- */
  const [gstinId, setGstinId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(dateInputValue(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [buyer, setBuyer] = useState<Party | null>(null);
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [charges, setCharges] = useState<ChargeDraft[]>([]);
  const [shipToAddressId, setShipToAddressId] = useState("");
  const [dispatchFromBranchId, setDispatchFromBranchId] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [transportMode, setTransportMode] = useState("1");
  const [distanceKm, setDistanceKm] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transportDocNo, setTransportDocNo] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [partyQuery, setPartyQuery] = useState("");
  const [newPartyName, setNewPartyName] = useState<string | null>(null);

  const parties = useParties({ q: partyQuery, limit: 15 });
  const buyerDetail = useParty(buyer?.id);
  const branches = useBranches(gstinId || undefined);
  const transporters = useTransporters();
  const nextNumber = useNextInvoiceNumber(gstinId);

  const sellerGstin = gstins.data?.items.find((g) => g.id === gstinId);

  /* --------------------------- hydrate on edit -------------------------- */
  useEffect(() => {
    if (!gstinId && gstins.data?.items.length) {
      const primary = gstins.data.items.find((g) => g.isPrimary) ?? gstins.data.items[0];
      if (primary) setGstinId(primary.id);
    }
  }, [gstins.data, gstinId]);

  useEffect(() => {
    const detail = existing.data;
    if (!detail || !id) return;
    const inv = detail.invoice;
    setGstinId(inv.gstinId);
    setInvoiceDate(dateInputValue(inv.invoiceDate));
    setDueDate(dateInputValue(inv.dueDate));
    setPlaceOfSupply(inv.placeOfSupply);
    setPoNumber(inv.poNumber ?? "");
    setNotes(inv.notes ?? "");
    setTerms(inv.terms ?? "");
    setTransporterId(inv.transporterId ?? "");
    setTransportMode(String(inv.transportMode ?? 1));
    setDistanceKm(inv.distanceKm ? String(inv.distanceKm) : "");
    setVehicleNo(inv.vehicleNo ?? "");
    setTransportDocNo(inv.transportDocNo ?? "");
    setDispatchFromBranchId(inv.branchId ?? "");
    setLines(detail.lines.map((line) => ({
      key: newKey(),
      productId: line.productId ?? null,
      name: line.name,
      description: line.description ?? "",
      hsnSac: line.hsnSac,
      isService: line.isService,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: String(line.unitPrice / 100),
      discountPercent: line.discountPercent,
      gstRate: line.gstRate,
    })));
    setCharges(detail.charges.map((charge) => ({
      key: newKey(),
      label: charge.label,
      kind: charge.kind,
      hsnSac: charge.hsnSac ?? "",
      amount: String(charge.amount / 100),
      gstRate: charge.gstRate,
    })));
    if (inv.buyerPartyId) {
      setBuyer({
        id: inv.buyerPartyId,
        name: inv.billTo.name,
        gstin: inv.billTo.gstin,
        stateCode: inv.billTo.stateCode,
        partyType: "customer",
        registrationType: "regular",
        isActive: true,
      });
    }
  }, [existing.data, id]);

  // Choosing a customer sets the place of supply — the field a trader most
  // often gets wrong, and the one that decides IGST versus CGST+SGST.
  useEffect(() => {
    if (buyer && !placeOfSupply) {
      setPlaceOfSupply(buyer.defaultPlaceOfSupply ?? buyer.stateCode ?? "");
    }
  }, [buyer, placeOfSupply]);

  /* ------------------------------- totals ------------------------------ */
  const totals = useMemo(() => {
    if (!sellerGstin || !placeOfSupply) return null;
    return calculateInvoiceTax({
      supplierStateCode: sellerGstin.stateCode,
      placeOfSupplyStateCode: placeOfSupply,
      supplyCategory: "b2b",
      lines: lines.map((line) => ({
        quantity: Number(line.quantity) || 0,
        unitPrice: toPaise(line.unitPrice),
        discountPercent: Number(line.discountPercent) || 0,
        gstRate: Number(line.gstRate) || 0,
      })),
      charges: charges.map((charge) => ({
        label: charge.label,
        amount: toPaise(charge.amount),
        gstRate: Number(charge.gstRate) || 0,
      })),
    });
  }, [sellerGstin, placeOfSupply, lines, charges]);

  const ewb = useMemo(() => {
    if (!totals) return null;
    return evaluateEwbRequirement({
      grandTotalPaise: totals.grandTotal,
      isIntraState: totals.supplyType === "intra_state",
      goodsInvolved: lines.some((line) => !line.isService),
    });
  }, [totals, lines]);

  const isDraft = !existing.data || existing.data.invoice.status === "draft";

  /* -------------------------------- save ------------------------------- */
  const buildPayload = () => ({
    gstinId,
    branchId: dispatchFromBranchId || null,
    docType: "invoice",
    series: "INV",
    invoiceDate: new Date(invoiceDate).toISOString(),
    dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    buyerPartyId: buyer?.id ?? null,
    shipToAddressId: shipToAddressId || null,
    dispatchFromBranchId: dispatchFromBranchId || null,
    supplyCategory: "b2b",
    placeOfSupply,
    reverseCharge: false,
    igstOnIntra: false,
    currency: "INR",
    exchangeRate: 1,
    lines: lines
      .filter((line) => line.name.trim() && Number(line.quantity) > 0)
      .map((line) => ({
        productId: line.productId,
        name: line.name.trim(),
        description: line.description,
        hsnSac: line.hsnSac.trim(),
        isService: line.isService,
        quantity: Number(line.quantity),
        unit: line.unit,
        unitPrice: Number(line.unitPrice) || 0,
        discountPercent: Number(line.discountPercent) || 0,
        discountAmount: 0,
        gstRate: Number(line.gstRate) || 0,
        cessRate: 0,
        cessNonAdvol: 0,
        stateCess: 0,
      })),
    charges: charges
      .filter((charge) => charge.label.trim() && Number(charge.amount) > 0)
      .map((charge) => ({
        label: charge.label.trim(),
        kind: charge.kind,
        hsnSac: charge.hsnSac,
        amount: Number(charge.amount),
        gstRate: Number(charge.gstRate) || 0,
      })),
    transport: {
      transporterId: transporterId || null,
      transportMode: Number(transportMode),
      distanceKm: distanceKm ? Number(distanceKm) : null,
      vehicleNo: vehicleNo.trim(),
      vehicleType: "R",
      transportDocNo,
      transportDocDate: null,
      subSupplyType: "1",
    },
    poNumber,
    notes,
    terms,
  });

  const submit = (then: "stay" | "open"): void => {
    save.mutate(buildPayload(), {
      onSuccess: (detail) => {
        show("Draft saved");
        if (then === "open") navigate(`/invoices/${detail.invoice.id}`);
        else if (!id) navigate(`/invoices/${detail.invoice.id}/edit`, { replace: true });
      },
    });
  };

  const canSave = Boolean(
    gstinId && placeOfSupply && buyer
    && lines.some((line) => line.name.trim() && Number(line.quantity) > 0),
  );

  if (id && existing.isLoading) {
    return <div className="grid place-items-center py-32 text-muted"><Spinner className="size-6" /></div>;
  }
  if (id && existing.data && !isDraft) {
    return (
      <Page>
        <div className="card p-6 text-center">
          <p className="text-sm font-medium">This invoice has been issued and cannot be edited.</p>
          <p className="mt-1 text-sm text-muted">
            Issue a credit note if the amounts need to change.
          </p>
          <button type="button" className="btn-primary mt-4" onClick={() => navigate(`/invoices/${id}`)}>
            View invoice
          </button>
        </div>
      </Page>
    );
  }

  return (
    <>
      <PageHeader
        title={id ? "Edit draft" : "New invoice"}
        subtitle={nextNumber.data ? `Will be numbered ${nextNumber.data.invoiceNumber}` : undefined}
        actions={
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
        }
      />

      <Page>
        <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-4">
            {/* ------------------------- Who and when ------------------------- */}
            <section className="card p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Customer" required>
                    <Picker<Party>
                      autoFocus={!id}
                      value={buyer ? {
                        id: buyer.id,
                        label: buyer.name,
                        sublabel: [buyer.gstin, buyer.city].filter(Boolean).join(" · "),
                        value: buyer,
                      } : null}
                      options={(parties.data?.items ?? []).map((party) => ({
                        id: party.id,
                        label: party.name,
                        sublabel: [party.gstin, party.city].filter(Boolean).join(" · "),
                        meta: party.stateCode ? GST_STATE_CODES[party.stateCode] : undefined,
                        value: party,
                      }))}
                      onSelect={(option) => {
                        setBuyer(option?.value ?? null);
                        setPlaceOfSupply(option?.value?.defaultPlaceOfSupply ?? option?.value?.stateCode ?? "");
                        setShipToAddressId("");
                      }}
                      onSearch={setPartyQuery}
                      onCreate={setNewPartyName}
                      createLabel="Add customer"
                      loading={parties.isFetching}
                      placeholder="Search customers by name or GSTIN…"
                    />
                  </Field>
                </div>

                <Field label="Invoice date" required>
                  <input type="date" className="field" value={invoiceDate}
                    onChange={(event) => setInvoiceDate(event.target.value)} />
                </Field>
                <Field label="Payment due">
                  <input type="date" className="field" value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)} />
                </Field>

                {(gstins.data?.items.length ?? 0) > 1 && (
                  <Field label="Billing from">
                    <select className="field" value={gstinId}
                      onChange={(event) => setGstinId(event.target.value)}>
                      {gstins.data?.items.map((g) => (
                        <option key={g.id} value={g.id}>{g.tradeName} — {g.gstin}</option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field
                  label="Place of supply"
                  required
                  hint={totals
                    ? totals.supplyType === "intra_state"
                      ? "Same state — CGST + SGST applies"
                      : "Different state — IGST applies"
                    : "Sets whether IGST or CGST+SGST applies"}
                >
                  <select className="field" value={placeOfSupply}
                    onChange={(event) => setPlaceOfSupply(event.target.value)}>
                    <option value="">Select…</option>
                    {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                      <option key={code} value={code}>{code} — {name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            {/* ----------------------------- Items ---------------------------- */}
            <LineItems lines={lines} setLines={setLines} totals={totals} />

            {/* -------------------------- Optional bits ----------------------- */}
            <Section
              title="Delivery address and dispatch point"
              hint="Only if goods go somewhere other than the customer's address"
              badge={shipToAddressId || dispatchFromBranchId ? "Set" : null}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ship to" hint="A saved delivery address for this customer">
                  <select className="field" value={shipToAddressId}
                    onChange={(event) => setShipToAddressId(event.target.value)}
                    disabled={!buyerDetail.data}>
                    <option value="">Same as customer address</option>
                    {buyerDetail.data?.addresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.label} — {address.city}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Dispatch from" hint="Your plant or warehouse, if not your main address">
                  <select className="field" value={dispatchFromBranchId}
                    onChange={(event) => setDispatchFromBranchId(event.target.value)}>
                    <option value="">Main business address</option>
                    {branches.data?.items.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name} — {branch.city}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Section>

            <Section
              title="Freight and other charges"
              hint="Packing, insurance, loading — taxed at their own rate"
              badge={charges.length ? `${charges.length}` : null}
            >
              <ChargeRows charges={charges} setCharges={setCharges} />
            </Section>

            <Section
              title="Transport"
              hint={ewb?.required
                ? "An e-Way Bill is needed — add the vehicle to complete it"
                : "Transporter, vehicle and distance"}
              badge={vehicleNo ? vehicleNo : ewb?.required ? "Needed" : null}
              defaultOpen={Boolean(ewb?.required)}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Transporter">
                  <select className="field" value={transporterId}
                    onChange={(event) => setTransporterId(event.target.value)}>
                    <option value="">Not decided yet</option>
                    {transporters.data?.items.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Vehicle number" hint="For example MH12AB1234">
                  <input className="field font-mono uppercase" value={vehicleNo}
                    onChange={(event) => setVehicleNo(event.target.value.toUpperCase())}
                    placeholder="MH12AB1234" />
                </Field>
                <Field label="Distance (km)" hint="Decides how long the e-Way Bill stays valid">
                  <input type="number" min="0" className="field" value={distanceKm}
                    onChange={(event) => setDistanceKm(event.target.value)} placeholder="0" />
                </Field>
                <Field label="LR / transport document no">
                  <input className="field" value={transportDocNo}
                    onChange={(event) => setTransportDocNo(event.target.value)} />
                </Field>
                <Field label="Mode">
                  <select className="field" value={transportMode}
                    onChange={(event) => setTransportMode(event.target.value)}>
                    <option value="1">Road</option>
                    <option value="2">Rail</option>
                    <option value="3">Air</option>
                    <option value="4">Ship</option>
                  </select>
                </Field>
              </div>
            </Section>

            <Section title="Reference and notes" badge={poNumber || notes ? "Set" : null}>
              <div className="grid gap-4">
                <Field label="Purchase order number">
                  <input className="field" value={poNumber}
                    onChange={(event) => setPoNumber(event.target.value)} />
                </Field>
                <Field label="Notes on the invoice">
                  <textarea className="field min-h-20" value={notes}
                    onChange={(event) => setNotes(event.target.value)} />
                </Field>
                <Field label="Terms">
                  <textarea className="field min-h-20" value={terms}
                    onChange={(event) => setTerms(event.target.value)} />
                </Field>
              </div>
            </Section>
          </div>

          {/* --------------------------- Summary rail --------------------------- */}
          <aside className="lg:sticky lg:top-4">
            <div className="card p-4">
              <h2 className="text-sm font-medium">Summary</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label="Taxable value" value={money(totals?.taxableValue ?? 0)} />
                {totals && totals.totalDiscount > 0 && (
                  <Row label="Discount" value={`− ${money(totals.totalDiscount)}`} />
                )}
                {totals && totals.otherCharges > 0 && (
                  <Row label="Other charges" value={money(totals.otherCharges)} />
                )}
                {totals?.supplyType === "intra_state" ? (
                  <>
                    <Row label="CGST" value={money(totals.cgst)} />
                    <Row label="SGST" value={money(totals.sgst)} />
                  </>
                ) : (
                  <Row label="IGST" value={money(totals?.igst ?? 0)} />
                )}
                {totals && totals.roundOff !== 0 && (
                  <Row label="Round off" value={money(totals.roundOff)} />
                )}
                <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                  <dt className="text-sm font-medium">Total</dt>
                  <dd className="text-lg font-semibold">{money(totals?.grandTotal ?? 0)}</dd>
                </div>
              </dl>

              {ewb && (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                  ewb.required ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-muted"}`}>
                  {ewb.required
                    ? "An e-Way Bill will be needed for this consignment."
                    : ewb.reason}
                </div>
              )}

              <ErrorNote error={save.error} />

              <div className="mt-4 space-y-2">
                <button type="button" className="btn-primary w-full" disabled={!canSave || save.isPending}
                  onClick={() => submit("open")}>
                  {save.isPending && <Spinner />}
                  Save and review
                </button>
                <button type="button" className="btn-secondary w-full" disabled={!canSave || save.isPending}
                  onClick={() => submit("stay")}>
                  Save draft
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-muted">
                Nothing is sent to the Government until you issue the invoice.
              </p>
            </div>
          </aside>
        </div>
      </Page>

      <NewCustomerDrawer
        name={newPartyName}
        onClose={() => setNewPartyName(null)}
        onCreated={(party) => {
          setBuyer(party);
          setPlaceOfSupply(party.defaultPlaceOfSupply ?? party.stateCode ?? "");
          setNewPartyName(null);
          show(`${party.name} added`);
        }}
      />
      {toast}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/* ------------------------------ line items ------------------------------ */

function LineItems({
  lines, setLines, totals,
}: {
  lines: LineDraft[];
  setLines: React.Dispatch<React.SetStateAction<LineDraft[]>>;
  totals: ReturnType<typeof calculateInvoiceTax> | null;
}) {
  const [productQuery, setProductQuery] = useState("");
  const products = useProducts({ q: productQuery, limit: 15 });
  const [newProductFor, setNewProductFor] = useState<{ key: string; name: string } | null>(null);

  const update = (key: string, patch: Partial<LineDraft>): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const applyProduct = (key: string, product: Product): void => {
    update(key, {
      productId: product.id,
      name: product.name,
      description: product.description ?? "",
      hsnSac: product.hsnSac,
      isService: product.isService,
      unit: product.unit,
      unitPrice: String(product.unitPrice / 100),
      gstRate: product.gstRate,
    });
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium">Items</h2>
        <button type="button" className="btn-ghost text-xs"
          onClick={() => setLines((current) => [...current, emptyLine()])}>
          + Add item
        </button>
      </div>

      <ul className="divide-y divide-line">
        {lines.map((line, index) => {
          const computed = totals?.lines[index];
          return (
            <li key={line.key} className="p-4">
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-12">
                  {line.name ? (
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <input
                          className="w-full rounded-lg border-0 px-0 py-0.5 text-sm font-medium focus:ring-0"
                          value={line.name}
                          onChange={(event) => update(line.key, { name: event.target.value })}
                        />
                        {line.description && (
                          <p className="truncate text-xs text-muted">{line.description}</p>
                        )}
                      </div>
                      {lines.length > 1 && (
                        <button type="button" aria-label="Remove item"
                          className="btn-ghost -mt-1 px-1.5 text-muted hover:text-red-600"
                          onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}>
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ) : (
                    <Picker<Product>
                      value={null}
                      options={(products.data?.items ?? []).map((product) => ({
                        id: product.id,
                        label: product.name,
                        sublabel: `HSN ${product.hsnSac} · ${product.gstRate}% · ${product.unit}`,
                        meta: money(product.unitPrice),
                        value: product,
                      }))}
                      onSelect={(option) => option && applyProduct(line.key, option.value)}
                      onSearch={setProductQuery}
                      onCreate={(name) => setNewProductFor({ key: line.key, name })}
                      createLabel="Add item"
                      loading={products.isFetching}
                      placeholder="Search your items, or type a new one…"
                    />
                  )}
                </div>

                {line.name && (
                  <>
                    <div className="sm:col-span-2">
                      <label className="label">HSN/SAC</label>
                      <input className="field" value={line.hsnSac}
                        onChange={(event) => update(line.key, { hsnSac: event.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Qty</label>
                      <input type="number" step="0.001" min="0" className="field" value={line.quantity}
                        onChange={(event) => update(line.key, { quantity: event.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Unit</label>
                      <select className="field" value={line.unit}
                        onChange={(event) => update(line.key, { unit: event.target.value })}>
                        {UQC_UNITS.map((unit) => (
                          <option key={unit.code} value={unit.code}>{unit.code}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Rate ₹</label>
                      <input type="number" step="0.01" min="0" className="field" value={line.unitPrice}
                        onChange={(event) => update(line.key, { unitPrice: event.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Disc %</label>
                      <input type="number" step="0.01" min="0" max="100" className="field"
                        value={line.discountPercent}
                        onChange={(event) => update(line.key, { discountPercent: event.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">GST %</label>
                      <select className="field" value={line.gstRate}
                        onChange={(event) => update(line.key, { gstRate: event.target.value })}>
                        {["0", "0.25", "3", "5", "12", "18", "28"].map((rate) => (
                          <option key={rate} value={rate}>{rate}%</option>
                        ))}
                      </select>
                    </div>
                    {computed && (
                      <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-xs text-muted sm:col-span-12">
                        <span>
                          Taxable {money(computed.taxableValue)} · Tax {money(computed.totalTax)}
                        </span>
                        <span className="text-sm font-medium text-ink">{money(computed.lineTotal)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <NewProductDrawer
        request={newProductFor}
        onClose={() => setNewProductFor(null)}
        onCreated={(product, key) => {
          applyProduct(key, product);
          setNewProductFor(null);
        }}
      />
    </section>
  );
}

function ChargeRows({
  charges, setCharges,
}: {
  charges: ChargeDraft[];
  setCharges: React.Dispatch<React.SetStateAction<ChargeDraft[]>>;
}) {
  return (
    <div className="space-y-3">
      {charges.map((charge) => (
        <div key={charge.key} className="grid gap-2 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <input className="field" placeholder="Freight, packing…" value={charge.label}
              onChange={(event) => setCharges((c) => c.map((x) =>
                x.key === charge.key ? { ...x, label: event.target.value } : x))} />
          </div>
          <div className="sm:col-span-3">
            <input type="number" step="0.01" className="field" placeholder="Amount ₹" value={charge.amount}
              onChange={(event) => setCharges((c) => c.map((x) =>
                x.key === charge.key ? { ...x, amount: event.target.value } : x))} />
          </div>
          <div className="sm:col-span-3">
            <select className="field" value={charge.gstRate}
              onChange={(event) => setCharges((c) => c.map((x) =>
                x.key === charge.key ? { ...x, gstRate: event.target.value } : x))}>
              {["0", "5", "12", "18", "28"].map((rate) => (
                <option key={rate} value={rate}>GST {rate}%</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-1">
            <button type="button" className="btn-ghost w-full px-2 text-muted hover:text-red-600"
              aria-label="Remove charge"
              onClick={() => setCharges((c) => c.filter((x) => x.key !== charge.key))}>
              ×
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-secondary"
        onClick={() => setCharges((c) => [...c, {
          key: newKey(), label: "", kind: "freight", hsnSac: "", amount: "", gstRate: "18",
        }])}>
        + Add charge
      </button>
    </div>
  );
}

/* --------------------------- inline creation ---------------------------- */

function NewCustomerDrawer({
  name, onClose, onCreated,
}: { name: string | null; onClose: () => void; onCreated: (party: Party) => void }) {
  const save = useSaveParty();
  return (
    <Drawer open={name !== null} onClose={onClose} title="Add customer"
      description="Only the essentials — you can fill in the rest later.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          save.mutate({
            name: field(data, "name"),
            gstin: field(data, "gstin"),
            registrationType: data.get("gstin") ? "regular" : "unregistered",
            phone: field(data, "phone"),
            addressLine1: field(data, "addressLine1"),
            city: field(data, "city"),
            stateCode: field(data, "stateCode"),
            pincode: field(data, "pincode"),
            country: "IN",
            partyType: "customer",
          }, { onSuccess: (party) => onCreated(party) });
        }}
      >
        <Field label="Business name" required>
          <input name="name" className="field" required defaultValue={name ?? ""} />
        </Field>
        <Field label="GSTIN" hint="Leave blank for an unregistered buyer">
          <input name="gstin" className="field font-mono uppercase" maxLength={15} />
        </Field>
        <Field label="State" required>
          <select name="stateCode" className="field" required defaultValue="">
            <option value="" disabled>Select…</option>
            {Object.entries(GST_STATE_CODES).map(([code, label]) => (
              <option key={code} value={code}>{code} — {label}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City"><input name="city" className="field" /></Field>
          <Field label="PIN code"><input name="pincode" className="field" maxLength={6} /></Field>
        </div>
        <Field label="Address"><input name="addressLine1" className="field" /></Field>
        <Field label="Phone"><input name="phone" className="field" /></Field>
        <ErrorNote error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending && <Spinner />} Add customer
        </button>
      </form>
    </Drawer>
  );
}

function NewProductDrawer({
  request, onClose, onCreated,
}: {
  request: { key: string; name: string } | null;
  onClose: () => void;
  onCreated: (product: Product, key: string) => void;
}) {
  const save = useSaveProduct();
  return (
    <Drawer open={request !== null} onClose={onClose} title="Add item"
      description="Saved for next time, so you never type it twice.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!request) return;
          const data = new FormData(event.currentTarget);
          save.mutate({
            name: field(data, "name"),
            hsnSac: field(data, "hsnSac"),
            unit: field(data, "unit"),
            unitPrice: numberField(data, "unitPrice"),
            gstRate: numberField(data, "gstRate"),
            isService: checked(data, "isService"),
            description: field(data, "description"),
          }, { onSuccess: (product) => onCreated(product, request.key) });
        }}
      >
        <Field label="Item name" required>
          <input name="name" className="field" required defaultValue={request?.name ?? ""} />
        </Field>
        <Field label="Description"><input name="description" className="field" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="HSN / SAC" required hint="4, 6 or 8 digits">
            <input name="hsnSac" className="field font-mono" required maxLength={8} />
          </Field>
          <Field label="GST rate" required>
            <select name="gstRate" className="field" defaultValue="18">
              {["0", "0.25", "3", "5", "12", "18", "28"].map((rate) => (
                <option key={rate} value={rate}>{rate}%</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit">
            <select name="unit" className="field" defaultValue="NOS">
              {UQC_UNITS.map((unit) => (
                <option key={unit.code} value={unit.code}>{unit.code} — {unit.description}</option>
              ))}
            </select>
          </Field>
          <Field label="Selling price ₹">
            <input name="unitPrice" type="number" step="0.01" className="field" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input name="isService" type="checkbox" className="size-4 rounded border-line" />
          This is a service, not goods
        </label>
        <ErrorNote error={save.error} />
        <button type="submit" className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending && <Spinner />} Add item
        </button>
      </form>
    </Drawer>
  );
}
