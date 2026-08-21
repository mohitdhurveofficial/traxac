import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { computeValidity, GST_STATE_CODES } from "@ewayvo/shared";
import { useCredentials, useInvoice, useInvoiceAction, useInvoiceTimeline } from "../api/hooks.js";
import type { AddressSnapshot, InvoiceDetail } from "../api/types.js";
import { Page, PageHeader } from "../components/shell.js";
import {
  EinvoiceStatus,
  EwbStatus,
  InvoiceStatus,
  PaymentStatus,
  Pill,
} from "../components/status.js";
import { ComplianceStatus } from "../components/compliance-status.js";
import { Attachments } from "../components/attachments.js";
import { notify } from "../lib/toast.js";
import {
  EmptyState,
  ErrorNote,
  ErrorState,
  Field,
  Modal,
  Spinner,
  useToast,
} from "../components/ui.js";
import {
  checked,
  field,
  formatDate,
  formatDateTime,
  money,
  numberField,
  relativeTime,
} from "../lib/format.js";

/**
 * Invoice detail.
 *
 * The layout answers three questions in order: what is this invoice, what is
 * its compliance state, and what can I do next. The "next action" is always a
 * single primary button — a trader should never have to work out which of six
 * buttons applies to their situation.
 */
type DialogKind =
  | null
  | "issue"
  | "cancel"
  | "payment"
  | "einvoice-cancel"
  | "ewb-generate"
  | "ewb-partb"
  | "ewb-extend"
  | "ewb-cancel";

export function InvoiceDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [dialog, setDialog] = useState<DialogKind>(null);

  const query = useInvoice(id);
  const timeline = useInvoiceTimeline(id);
  const actions = useInvoiceAction(id);
  // Used only to distinguish "not sent yet" from "no portal login saved".
  const credentials = useCredentials();
  const portalConnected = (credentials.data?.items.length ?? 0) > 0;

  if (query.isLoading) {
    return (
      <div className="grid place-items-center py-32 text-muted">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!query.data) {
    return query.error ? (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <EmptyState
        title="This invoice is not here"
        description="It may have been deleted, or the link may be out of date."
        action={
          <button type="button" className="btn-secondary" onClick={() => navigate("/invoices")}>
            Back to invoices
          </button>
        }
      />
    );
  }

  const detail = query.data;
  const { invoice, lines, charges, einvoice, ewayBill, payments } = detail;
  const isDraft = invoice.status === "draft";
  const busy =
    ["queued", "processing"].includes(invoice.einvoiceStatus) ||
    ["queued", "processing"].includes(invoice.ewbStatus);

  return (
    <>
      <PageHeader
        title={isDraft ? "Draft invoice" : invoice.invoiceNumber}
        subtitle={`${invoice.billTo.name} · ${formatDate(invoice.invoiceDate)}`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => navigate("/invoices")}>
              Back
            </button>
            {isDraft ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => navigate(`/invoices/${id}/edit`)}
                >
                  Edit
                </button>
                <button type="button" className="btn-primary" onClick={() => setDialog("issue")}>
                  Issue invoice
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    void actions.duplicate.mutate(undefined, {
                      onSuccess: (created) => void navigate(`/invoices/${created.invoice.id}/edit`),
                    })
                  }
                >
                  Duplicate
                </button>
                <PdfButton invoiceId={id} onRender={() => actions.renderPdf.mutateAsync()} />
              </>
            )}
          </div>
        }
      />

      <Page>
        <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
          <div className="space-y-4">
            {/* ---------------------------- Status ---------------------------- */}
            <section className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <InvoiceStatus status={invoice.status} />
                <PaymentStatus total={invoice.grandTotal} paid={invoice.amountPaid} />
                <EinvoiceStatus status={invoice.einvoiceStatus} />
                <EwbStatus status={invoice.ewbStatus} validUntil={ewayBill?.validUntil} />
                {busy && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <Spinner className="size-3" /> working…
                  </span>
                )}
              </div>

              {invoice.status === "cancelled" && invoice.cancelReason && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-muted">
                  Cancelled: {invoice.cancelReason}
                </p>
              )}
              {einvoice?.lastError && invoice.einvoiceStatus === "failed" && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p className="font-medium">e-Invoice could not be generated</p>
                  <p className="mt-0.5">{einvoice.lastError}</p>
                  {einvoice.errorCode === "CREDENTIALS_MISSING" && (
                    <button
                      type="button"
                      className="mt-1.5 text-xs font-medium underline"
                      onClick={() => navigate("/settings?tab=gst")}
                    >
                      Add GST credentials →
                    </button>
                  )}
                </div>
              )}
              {ewayBill?.lastError && invoice.ewbStatus === "failed" && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p className="font-medium">e-Way Bill could not be generated</p>
                  <p className="mt-0.5">{ewayBill.lastError}</p>
                </div>
              )}
            </section>

            {/* ---------------------------- Parties --------------------------- */}
            <section className="card p-4">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <AddressBlock title="Bill from" address={invoice.billFrom} />
                <AddressBlock title="Bill to" address={invoice.billTo} />
                {invoice.shipTo && <AddressBlock title="Ship to" address={invoice.shipTo} />}
                {invoice.dispatchFrom && (
                  <AddressBlock title="Dispatch from" address={invoice.dispatchFrom} />
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-muted">
                <span>
                  Place of supply:{" "}
                  <strong className="text-ink">
                    {GST_STATE_CODES[invoice.placeOfSupply] ?? invoice.placeOfSupply}
                  </strong>
                </span>
                {invoice.poNumber && (
                  <span>
                    PO: <strong className="text-ink">{invoice.poNumber}</strong>
                  </span>
                )}
                {invoice.dueDate && (
                  <span>
                    Due: <strong className="text-ink">{formatDate(invoice.dueDate)}</strong>
                  </span>
                )}
                {invoice.ewbTransactionType > 1 && (
                  <span>
                    EWB type {invoice.ewbTransactionType}:{" "}
                    <strong className="text-ink">
                      {
                        [
                          "",
                          "Regular",
                          "Bill To – Ship To",
                          "Bill From – Dispatch From",
                          "Combination",
                        ][invoice.ewbTransactionType]
                      }
                    </strong>
                  </span>
                )}
              </div>
            </section>

            {/* ----------------------------- Items ---------------------------- */}
            <section className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-line bg-slate-50 text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Item</th>
                      <th className="px-4 py-2.5 font-medium">HSN</th>
                      <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                      <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                      <th className="px-4 py-2.5 text-right font-medium">Taxable</th>
                      <th className="px-4 py-2.5 text-right font-medium">Tax</th>
                      <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{line.name}</p>
                          {line.description && (
                            <p className="text-xs text-muted">{line.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{line.hsnSac}</td>
                        <td className="px-4 py-3 text-right">
                          {Number(line.quantity)} {line.unit}
                        </td>
                        <td className="px-4 py-3 text-right">{money(line.unitPrice)}</td>
                        <td className="px-4 py-3 text-right">{money(line.taxableValue)}</td>
                        <td className="px-4 py-3 text-right">
                          {money(line.totalTax)}
                          <span className="block text-xs text-muted">{Number(line.gstRate)}%</span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {money(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                    {charges.map((charge) => (
                      <tr key={charge.id} className="text-muted">
                        <td className="px-4 py-2.5" colSpan={4}>
                          {charge.label}
                        </td>
                        <td className="px-4 py-2.5 text-right">{money(charge.amount)}</td>
                        <td className="px-4 py-2.5 text-right">{money(charge.taxAmount)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {money(charge.amount + charge.taxAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end border-t border-line bg-slate-50 px-4 py-3">
                <dl className="w-full max-w-xs space-y-1 text-sm">
                  {invoice.totalDiscount > 0 && (
                    <>
                      <Line label="Gross value" value={money(invoice.grossValue)} />
                      <Line label="Less discount" value={`− ${money(invoice.totalDiscount)}`} />
                    </>
                  )}
                  <Line label="Taxable value" value={money(invoice.taxableValue)} />
                  {invoice.otherCharges > 0 && (
                    <Line label="Other charges" value={money(invoice.otherCharges)} />
                  )}
                  {invoice.igst > 0 ? (
                    <Line label="IGST" value={money(invoice.igst)} />
                  ) : (
                    <>
                      <Line label="CGST" value={money(invoice.cgst)} />
                      <Line label="SGST" value={money(invoice.sgst)} />
                    </>
                  )}
                  {invoice.roundOff !== 0 && (
                    <Line label="Round off" value={money(invoice.roundOff)} />
                  )}
                  <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold">
                    <dt>Total</dt>
                    <dd>{money(invoice.grandTotal)}</dd>
                  </div>
                  {invoice.amountPaid > 0 && (
                    <div className="flex justify-between text-sm text-muted">
                      <dt>Balance due</dt>
                      <dd>{money(detail.amountDue)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </section>

            {/* ---------------------------- Timeline -------------------------- */}
            <section className="card p-4">
              <h2 className="text-sm font-medium">History</h2>
              <ol className="mt-3 space-y-3">
                {(timeline.data?.entries ?? []).map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300" />
                    <div className="min-w-0">
                      <p>
                        <span className="font-medium">{humanAction(entry.action)}</span>
                        {entry.summary && <span className="text-muted"> — {entry.summary}</span>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatDateTime(entry.createdAt)} · {entry.actorLabel}
                      </p>
                    </div>
                  </li>
                ))}
                {(timeline.data?.entries.length ?? 0) === 0 && (
                  <p className="text-sm text-muted">Nothing recorded yet.</p>
                )}
              </ol>
            </section>
          </div>

          {/* --------------------------- Action rail --------------------------- */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            {!isDraft && (
              <section className="card p-4">
                <h2 className="text-sm font-medium">Compliance</h2>

                {/* Plain-language summary first; portal identifiers below. */}
                <div className="mt-3">
                  <ComplianceStatus
                    invoice={invoice}
                    einvoice={einvoice}
                    ewayBill={ewayBill}
                    portalConnected={portalConnected}
                  />
                </div>

                <details className="mt-4 border-t border-line pt-3">
                  <summary className="cursor-pointer text-xs text-muted hover:text-ink">
                    Portal reference
                  </summary>

                  <div className="mt-3 space-y-3 text-sm">
                    <div>
                      <p className="text-xs text-muted">e-Invoice (IRN)</p>
                      {einvoice?.irn ? (
                        <>
                          <p className="mt-0.5 font-mono text-[11px] break-all">{einvoice.irn}</p>
                          <p className="mt-1 text-xs text-muted">
                            Ack {einvoice.ackNumber} · {formatDate(einvoice.ackDate)}
                            {einvoice.environment === "sandbox" && (
                              <Pill tone="warn">
                                <span className="text-[10px]">sandbox</span>
                              </Pill>
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="mt-0.5 text-muted">Not generated</p>
                      )}
                    </div>

                    <div className="border-t border-line pt-3">
                      <p className="text-xs text-muted">e-Way Bill</p>
                      {ewayBill?.ewbNumber ? (
                        <>
                          <p className="mt-0.5 font-mono text-sm">{ewayBill.ewbNumber}</p>
                          {ewayBill.validUntil && (
                            <p className="mt-1 text-xs text-muted">
                              Valid until {formatDateTime(ewayBill.validUntil)} (
                              {relativeTime(ewayBill.validUntil)})
                            </p>
                          )}
                          {ewayBill.vehicleNo && (
                            <p className="text-xs text-muted">Vehicle {ewayBill.vehicleNo}</p>
                          )}
                          {ewayBill.extensionCount > 0 && (
                            <p className="text-xs text-muted">
                              Extended {ewayBill.extensionCount}×
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="mt-0.5 text-muted">
                          {invoice.ewbRequired ? "Required, not generated" : "Not required"}
                        </p>
                      )}
                    </div>
                  </div>
                </details>

                {/*
                 * Exactly one primary button. The list is built in priority
                 * order and only the first entry is emphasised, so the next
                 * step is never a guess — and when credentials are missing,
                 * fixing that is the step, not retrying something that will
                 * fail the same way.
                 */}
                <ComplianceActions
                  portalConnected={portalConnected}
                  detail={detail}
                  onDialog={setDialog}
                  onRetryEinvoice={() =>
                    actions.generateEinvoice.mutate(
                      { withEwayBill: false },
                      {
                        onSuccess: () => show("Sending to the IRP…"),
                      },
                    )
                  }
                  onFixCredentials={() => navigate("/settings?tab=gst")}
                />
              </section>
            )}

            {!isDraft && (
              <section className="card p-4">
                <h2 className="text-sm font-medium">Payment</h2>
                <p className="mt-1 text-2xl font-semibold">{money(detail.amountDue)}</p>
                <p className="text-xs text-muted">outstanding of {money(invoice.grandTotal)}</p>
                {detail.amountDue > 0 && invoice.status !== "cancelled" && (
                  <button
                    type="button"
                    className="btn-secondary mt-3 w-full"
                    onClick={() => setDialog("payment")}
                  >
                    Record payment
                  </button>
                )}
                {payments.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
                    {payments.map((payment) => (
                      <li key={payment.id} className="flex justify-between">
                        <span className="text-muted capitalize">
                          {payment.method} · {formatDate(payment.paidAt)}
                        </span>
                        <span className="font-medium">{money(payment.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <Attachments invoiceId={id} canEdit={invoice.status !== "cancelled"} onToast={show} />

            {!isDraft && invoice.status !== "cancelled" && (
              <button
                type="button"
                className="btn-ghost w-full text-red-700 hover:bg-red-50"
                onClick={() => setDialog("cancel")}
              >
                Cancel invoice
              </button>
            )}
          </aside>
        </div>
      </Page>

      <Dialogs
        dialog={dialog}
        close={() => setDialog(null)}
        detail={detail}
        actions={actions}
        show={show}
      />
      {toast}
    </>
  );
}

/**
 * Opens the invoice PDF, rendering it first if it is not there yet.
 *
 * Rendering happens on the worker, so a plain link to the endpoint showed a
 * raw "not found" the first time it was clicked. This asks for the render,
 * waits for it, and only then opens the tab.
 */
function PdfButton({
  invoiceId,
  onRender,
}: {
  invoiceId: string;
  onRender: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);

  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      const url = `/api/v1/invoices/${invoiceId}/pdf`;
      if ((await fetch(url, { method: "HEAD", credentials: "include" })).ok) {
        window.open(url, "_blank", "noopener");
        return;
      }
      await onRender();
      // Poll rather than guess: rendering is normally under a second, but a
      // busy worker can take longer, and a silent failure is worse than a wait.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if ((await fetch(url, { method: "HEAD", credentials: "include" })).ok) {
          window.open(url, "_blank", "noopener");
          return;
        }
      }
      notify("The PDF is still being prepared", "Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn-secondary" disabled={busy} onClick={() => void open()}>
      {busy && <Spinner />}
      {busy ? "Preparing…" : "PDF"}
    </button>
  );
}

/**
 * Builds the compliance action list in priority order and renders only the
 * first one as primary.
 */
function ComplianceActions({
  detail,
  portalConnected,
  onDialog,
  onRetryEinvoice,
  onFixCredentials,
}: {
  detail: InvoiceDetail;
  portalConnected: boolean;
  onDialog: (dialog: DialogKind) => void;
  onRetryEinvoice: () => void;
  onFixCredentials: () => void;
}) {
  const { invoice, einvoice, ewayBill } = detail;
  const inFlight = ["queued", "processing"];

  // A missing credential blocks every portal call, so it outranks everything.
  // Either the portal rejected us, or no login has ever been saved — the fix
  // is the same screen, so both funnel into one action.
  const credentialsMissing =
    !portalConnected ||
    einvoice?.errorCode === "CREDENTIALS_MISSING" ||
    ewayBill?.errorCode === "CREDENTIALS_MISSING";

  type Action = { key: string; label: string; danger?: boolean; run: () => void };
  const actions: Action[] = [];

  if (credentialsMissing) {
    actions.push({
      key: "creds",
      label: portalConnected ? "Fix GST connection" : "Connect GST portal",
      run: onFixCredentials,
    });
  }
  // Every portal call below needs a saved login, so offer none until there is
  // one — a button that can only fail is worse than no button.
  if (invoice.einvoiceStatus === "pending" && !credentialsMissing) {
    actions.push({ key: "irn", label: "Generate e-Invoice", run: onRetryEinvoice });
  }
  if (invoice.einvoiceStatus === "failed" && !credentialsMissing) {
    actions.push({ key: "irn-retry", label: "Retry e-Invoice", run: onRetryEinvoice });
  }
  if (
    invoice.ewbRequired &&
    !ewayBill?.ewbNumber &&
    !inFlight.includes(invoice.ewbStatus) &&
    !credentialsMissing
  ) {
    actions.push({
      key: "ewb",
      label: invoice.ewbStatus === "failed" ? "Retry e-Way Bill" : "Generate e-Way Bill",
      run: () => onDialog("ewb-generate"),
    });
  }
  if (ewayBill?.actions?.canUpdatePartB) {
    actions.push({
      key: "partb",
      label:
        invoice.ewbStatus === "part_b_pending" ? "Add vehicle (Part-B)" : "Update vehicle (Part-B)",
      run: () => onDialog("ewb-partb"),
    });
  }
  if (ewayBill?.actions?.canExtend) {
    actions.push({ key: "extend", label: "Extend validity", run: () => onDialog("ewb-extend") });
  }
  if (einvoice?.irn && einvoice.status === "generated") {
    actions.push({
      key: "irn-cancel",
      label: "Cancel IRN",
      danger: true,
      run: () => onDialog("einvoice-cancel"),
    });
  }
  if (ewayBill?.actions?.canCancel) {
    actions.push({
      key: "ewb-cancel",
      label: "Cancel e-Way Bill",
      danger: true,
      run: () => onDialog("ewb-cancel"),
    });
  }

  if (actions.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {actions.map((action, index) => (
        <button
          key={action.key}
          type="button"
          onClick={action.run}
          className={`w-full ${
            action.danger ? "btn-danger" : index === 0 ? "btn-primary" : "btn-secondary"
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AddressBlock({ title, address }: { title: string; address: AddressSnapshot }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{title}</p>
      <p className="mt-1.5 text-sm font-medium">{address.name}</p>
      <p className="text-xs leading-relaxed text-muted">
        {[
          address.addressLine1,
          address.addressLine2,
          `${address.city} ${address.pincode}`,
          GST_STATE_CODES[address.stateCode],
        ]
          .filter(Boolean)
          .join(", ")}
      </p>
      {address.gstin && (
        <p className="mt-1 font-mono text-[11px]">
          {address.gstin === "URP" ? "Unregistered" : address.gstin}
        </p>
      )}
    </div>
  );
}

function humanAction(action: string): string {
  const map: Record<string, string> = {
    "invoice.created": "Draft created",
    "invoice.updated": "Draft edited",
    "invoice.finalized": "Invoice issued",
    "invoice.cancelled": "Invoice cancelled",
    "invoice.payment_recorded": "Payment recorded",
    "invoice.duplicated": "Copied to a new draft",
    "einvoice.generated": "IRN generated",
    "einvoice.failed": "IRN failed",
    "einvoice.cancelled": "IRN cancelled",
    "ewb.generated": "e-Way Bill generated",
    "ewb.part_b_updated": "Vehicle details updated",
    "ewb.transporter_updated": "Transporter changed",
    "ewb.extended": "e-Way Bill extended",
    "ewb.cancelled": "e-Way Bill cancelled",
  };
  return map[action] ?? action;
}

/* -------------------------------- dialogs ------------------------------- */

function Dialogs({
  dialog,
  close,
  detail,
  actions,
  show,
}: {
  dialog: DialogKind;
  close: () => void;
  detail: InvoiceDetail;
  actions: ReturnType<typeof useInvoiceAction>;
  show: (message: string) => void;
}) {
  const { invoice, ewayBill } = detail;
  const done = (message: string) => ({
    onSuccess: () => {
      show(message);
      close();
    },
  });

  return (
    <>
      <Modal open={dialog === "issue"} onClose={close} title="Issue this invoice">
        <p className="text-sm text-muted">
          The invoice number is assigned now and the invoice can no longer be edited.
        </p>
        <form
          id="issue-form"
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            actions.finalize.mutate(
              {
                generateEinvoice: checked(data, "einvoice"),
                generateEwb: checked(data, "ewb"),
              },
              done("Invoice issued"),
            );
          }}
        >
          <label className="flex items-start gap-2 text-sm">
            <input
              name="einvoice"
              type="checkbox"
              defaultChecked
              className="mt-0.5 size-4 rounded border-line"
            />
            <span>
              Send to the Government IRP for an IRN
              <span className="block text-xs text-muted">
                Required for B2B invoices above the turnover limit.
              </span>
            </span>
          </label>
          {invoice.ewbRequired && (
            <label className="flex items-start gap-2 text-sm">
              <input
                name="ewb"
                type="checkbox"
                defaultChecked
                className="mt-0.5 size-4 rounded border-line"
              />
              <span>
                Also generate the e-Way Bill
                <span className="block text-xs text-muted">
                  {invoice.vehicleNo
                    ? `Vehicle ${invoice.vehicleNo}, ${invoice.distanceKm ?? 0} km.`
                    : "No vehicle entered — Part-A only, add the vehicle before dispatch."}
                </span>
              </span>
            </label>
          )}
          <ErrorNote error={actions.finalize.error} />
        </form>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>
            Not yet
          </button>
          <button
            type="submit"
            form="issue-form"
            className="btn-primary"
            disabled={actions.finalize.isPending}
          >
            {actions.finalize.isPending && <Spinner />} Issue invoice
          </button>
        </div>
      </Modal>

      <ReasonDialog
        open={dialog === "cancel"}
        onClose={close}
        title="Cancel this invoice"
        description="The invoice stays in your records, marked cancelled."
        pending={actions.cancel.isPending}
        error={actions.cancel.error}
        reasons={{
          "1": "Duplicate",
          "2": "Order cancelled",
          "3": "Data entry mistake",
          "4": "Other",
        }}
        onSubmit={(reasonCode, remark) =>
          actions.cancel.mutate({ reasonCode, remark }, done("Invoice cancelled"))
        }
      />

      <ReasonDialog
        open={dialog === "einvoice-cancel"}
        onClose={close}
        title="Cancel the IRN"
        description="Only possible within 24 hours of the acknowledgement. After that, issue a credit note."
        pending={actions.cancelEinvoice.isPending}
        error={actions.cancelEinvoice.error}
        reasons={{
          "1": "Duplicate",
          "2": "Data entry mistake",
          "3": "Order cancelled",
          "4": "Other",
        }}
        onSubmit={(reasonCode, remark) =>
          actions.cancelEinvoice.mutate({ reasonCode, remark }, done("IRN cancelled"))
        }
      />

      <ReasonDialog
        open={dialog === "ewb-cancel"}
        onClose={close}
        title="Cancel the e-Way Bill"
        description="Only possible within 24 hours of generation, and only if it has not been verified in transit."
        pending={actions.cancelEwb.isPending}
        error={actions.cancelEwb.error}
        reasons={{
          "1": "Duplicate",
          "2": "Order cancelled",
          "3": "Data entry mistake",
          "4": "Other",
        }}
        onSubmit={(reasonCode, remark) =>
          actions.cancelEwb.mutate({ reasonCode, remark }, done("e-Way Bill cancelled"))
        }
      />

      <Modal open={dialog === "payment"} onClose={close} title="Record a payment">
        <form
          id="payment-form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            actions.recordPayment.mutate(
              {
                amount: numberField(data, "amount"),
                method: field(data, "method"),
                reference: field(data, "reference"),
              },
              done("Payment recorded"),
            );
          }}
        >
          <Field label="Amount received (₹)" required>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              className="field"
              required
              defaultValue={(detail.amountDue / 100).toFixed(2)}
            />
          </Field>
          <Field label="Method">
            <select name="method" className="field" defaultValue="neft">
              {["cash", "upi", "neft", "rtgs", "cheque", "card", "other"].map((method) => (
                <option key={method} value={method}>
                  {method.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reference">
            <input name="reference" className="field" />
          </Field>
          <ErrorNote error={actions.recordPayment.error} />
        </form>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            form="payment-form"
            className="btn-primary"
            disabled={actions.recordPayment.isPending}
          >
            Record
          </button>
        </div>
      </Modal>

      <Modal open={dialog === "ewb-generate"} onClose={close} title="Generate the e-Way Bill">
        <form
          id="ewb-form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const vehicleNo = field(data, "vehicleNo").trim();
            actions.generateEwb.mutate(
              {
                distanceKm: numberField(data, "distanceKm"),
                partB: vehicleNo
                  ? {
                      transportMode: Number(data.get("transportMode") || 1),
                      vehicleNo,
                      vehicleType: "R",
                    }
                  : undefined,
              },
              done("Generating the e-Way Bill…"),
            );
          }}
        >
          <Field label="Distance (km)" required hint="One day of validity per 200 km, rounded up.">
            <input
              name="distanceKm"
              type="number"
              min="1"
              max="4000"
              className="field"
              required
              defaultValue={invoice.distanceKm ?? ""}
            />
          </Field>
          <Field label="Vehicle number" hint="Leave blank to generate Part-A only.">
            <input
              name="vehicleNo"
              className="field font-mono uppercase"
              defaultValue={invoice.vehicleNo ?? ""}
              maxLength={15}
            />
          </Field>
          <Field label="Mode">
            <select
              name="transportMode"
              className="field"
              defaultValue={String(invoice.transportMode ?? 1)}
            >
              <option value="1">Road</option>
              <option value="2">Rail</option>
              <option value="3">Air</option>
              <option value="4">Ship</option>
            </select>
          </Field>
          <ValidityHint distanceKm={invoice.distanceKm ?? 0} />
          <ErrorNote error={actions.generateEwb.error} />
        </form>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            form="ewb-form"
            className="btn-primary"
            disabled={actions.generateEwb.isPending}
          >
            Generate
          </button>
        </div>
      </Modal>

      <Modal open={dialog === "ewb-partb"} onClose={close} title="Update vehicle details">
        <form
          id="partb-form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            actions.updatePartB.mutate(
              {
                transportMode: Number(data.get("transportMode") || 1),
                vehicleNo: field(data, "vehicleNo"),
                vehicleType: "R",
                fromPlace: field(data, "fromPlace"),
                fromStateCode: field(data, "fromStateCode"),
                reasonCode: field(data, "reasonCode"),
                reasonRemark: field(data, "reasonRemark"),
              },
              done("Vehicle updated"),
            );
          }}
        >
          <Field label="Vehicle number" required>
            <input
              name="vehicleNo"
              className="field font-mono uppercase"
              required
              defaultValue={ewayBill?.vehicleNo ?? ""}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From place" required>
              <input
                name="fromPlace"
                className="field"
                required
                defaultValue={invoice.dispatchFrom?.city ?? invoice.billFrom.city}
              />
            </Field>
            <Field label="From state" required>
              <select
                name="fromStateCode"
                className="field"
                required
                defaultValue={invoice.dispatchFrom?.stateCode ?? invoice.billFrom.stateCode}
              >
                {Object.entries(GST_STATE_CODES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Mode">
            <select name="transportMode" className="field" defaultValue="1">
              <option value="1">Road</option>
              <option value="2">Rail</option>
              <option value="3">Air</option>
              <option value="4">Ship</option>
            </select>
          </Field>
          <Field label="Reason">
            <select name="reasonCode" className="field" defaultValue="4">
              <option value="1">Vehicle broke down</option>
              <option value="2">Transhipment</option>
              <option value="3">Other</option>
              <option value="4">First time entry</option>
            </select>
          </Field>
          <Field label="Remark" required>
            <input name="reasonRemark" className="field" required defaultValue="Vehicle assigned" />
          </Field>
          <ErrorNote error={actions.updatePartB.error} />
        </form>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            form="partb-form"
            className="btn-primary"
            disabled={actions.updatePartB.isPending}
          >
            Update
          </button>
        </div>
      </Modal>

      <Modal open={dialog === "ewb-extend"} onClose={close} title="Extend the e-Way Bill">
        <form
          id="extend-form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            actions.extendEwb.mutate(
              {
                remainingDistanceKm: numberField(data, "remainingDistanceKm"),
                reasonCode: field(data, "reasonCode"),
                reasonRemark: field(data, "reasonRemark"),
                currentPlace: field(data, "currentPlace"),
                currentStateCode: field(data, "currentStateCode"),
                currentPincode: field(data, "currentPincode"),
                transitType: field(data, "transitType"),
              },
              done("Validity extended"),
            );
          }}
        >
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Extension is allowed from 8 hours before expiry to 8 hours after.
          </p>
          <Field label="Distance still to travel (km)" required>
            <input name="remainingDistanceKm" type="number" min="1" className="field" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Where is it now" required>
              <input name="currentPlace" className="field" required />
            </Field>
            <Field label="PIN code" required>
              <input name="currentPincode" className="field" required maxLength={6} />
            </Field>
          </div>
          <Field label="State" required>
            <select name="currentStateCode" className="field" required defaultValue="">
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
          <Field label="Consignment is" required>
            <select name="transitType" className="field" defaultValue="2">
              <option value="2">In movement</option>
              <option value="1">In transit (stationary)</option>
            </select>
          </Field>
          <Field label="Reason" required>
            <select name="reasonCode" className="field" defaultValue="1">
              <option value="1">Natural calamity</option>
              <option value="2">Law and order situation</option>
              <option value="4">Transhipment</option>
              <option value="5">Accident</option>
              <option value="99">Other</option>
            </select>
          </Field>
          <Field label="Remark" required>
            <input name="reasonRemark" className="field" required />
          </Field>
          <ErrorNote error={actions.extendEwb.error} />
        </form>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            form="extend-form"
            className="btn-primary"
            disabled={actions.extendEwb.isPending}
          >
            Extend
          </button>
        </div>
      </Modal>
    </>
  );
}

function ValidityHint({ distanceKm }: { distanceKm: number }) {
  if (!distanceKm) return null;
  const { days, validUntil } = computeValidity({ distanceKm, generatedAt: new Date() });
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
      {days} day{days > 1 ? "s" : ""} of validity — until {formatDateTime(validUntil)}.
    </p>
  );
}

function ReasonDialog({
  open,
  onClose,
  title,
  description,
  reasons,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  reasons: Record<string, string>;
  onSubmit: (reasonCode: string, remark: string) => void;
  pending: boolean;
  error: unknown;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted">{description}</p>
      <form
        id="reason-form"
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSubmit(field(data, "reasonCode"), field(data, "remark"));
        }}
      >
        <Field label="Reason" required>
          <select name="reasonCode" className="field" defaultValue={Object.keys(reasons)[0]}>
            {Object.entries(reasons).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Remark" required>
          <input name="remark" className="field" required minLength={3} maxLength={100} />
        </Field>
        <ErrorNote error={error} />
      </form>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Keep it
        </button>
        <button type="submit" form="reason-form" className="btn-danger" disabled={pending}>
          {pending && <Spinner />} {title}
        </button>
      </div>
    </Modal>
  );
}
