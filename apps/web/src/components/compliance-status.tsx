import type { Einvoice, EwayBill, Invoice } from "../api/types.js";
import { formatDate, relativeTime } from "../lib/format.js";

/**
 * Compliance at a glance.
 *
 * Three rows, in the order the work actually happens: the invoice is issued,
 * the IRP acknowledges it, the e-Way Bill is raised. Each row says only where
 * it stands and what it is waiting for.
 *
 * Deliberately no portal vocabulary here — no error codes, no "IRP", no
 * "Part-A". A trader reads this to answer "can the lorry leave?", and the
 * technical detail lives one click away for whoever needs it.
 */
type Tone = "done" | "active" | "waiting" | "problem" | "skipped";

interface Step {
  label: string;
  tone: Tone;
  status: string;
  detail?: string | null;
}

const MARK: Record<Tone, { glyph: string; className: string }> = {
  done: { glyph: "✓", className: "bg-emerald-100 text-emerald-700" },
  active: { glyph: "•", className: "bg-blue-100 text-blue-700 animate-pulse" },
  waiting: { glyph: "•", className: "bg-amber-100 text-amber-700" },
  problem: { glyph: "!", className: "bg-red-100 text-red-700" },
  skipped: { glyph: "–", className: "bg-slate-100 text-slate-400" },
};

const TEXT: Record<Tone, string> = {
  done: "text-emerald-700",
  active: "text-blue-700",
  waiting: "text-amber-700",
  problem: "text-red-700",
  skipped: "text-slate-400",
};

function invoiceStep(invoice: Invoice): Step {
  if (invoice.status === "cancelled") {
    return { label: "Invoice", tone: "problem", status: "Cancelled", detail: invoice.cancelReason };
  }
  if (invoice.status === "draft") {
    return { label: "Invoice", tone: "waiting", status: "Draft", detail: "Not issued yet" };
  }
  return {
    label: "Invoice",
    tone: "done",
    status: "Finalized",
    detail: `${invoice.invoiceNumber} · ${formatDate(invoice.invoiceDate)}`,
  };
}

function einvoiceStep(invoice: Invoice, einvoice: Einvoice | null): Step {
  switch (invoice.einvoiceStatus) {
    case "not_required":
      return { label: "e-Invoice", tone: "skipped", status: "Not required", detail: null };
    case "queued":
    case "processing":
      return {
        label: "e-Invoice",
        tone: "active",
        status: "Generating…",
        detail: "Waiting for the portal",
      };
    case "generated":
      return {
        label: "e-Invoice",
        tone: "done",
        status: "IRN generated",
        detail: einvoice?.ackNumber ? `Acknowledgement ${einvoice.ackNumber}` : null,
      };
    case "failed":
      return {
        label: "e-Invoice",
        tone: "problem",
        status: "Could not be generated",
        // Already a plain sentence: the NIC code was mapped server-side.
        detail: einvoice?.lastError ?? null,
      };
    case "cancelled":
      return { label: "e-Invoice", tone: "skipped", status: "IRN cancelled", detail: null };
    default:
      return { label: "e-Invoice", tone: "waiting", status: "Not sent yet", detail: null };
  }
}

function ewbStep(invoice: Invoice, ewayBill: EwayBill | null): Step {
  switch (invoice.ewbStatus) {
    case "not_required":
      return {
        label: "e-Way Bill",
        tone: "skipped",
        status: "Not required",
        detail: "Below the threshold, or no movement of goods",
      };
    case "queued":
    case "processing":
      return {
        label: "e-Way Bill",
        tone: "active",
        status: "Generating…",
        detail: "Waiting for the portal",
      };
    case "part_b_pending":
      return {
        label: "e-Way Bill",
        tone: "waiting",
        status: "Vehicle details needed",
        detail: "Part-A is done; add the vehicle before dispatch",
      };
    case "generated": {
      const expiring =
        ewayBill?.validUntil &&
        new Date(ewayBill.validUntil).getTime() - Date.now() < 12 * 3_600_000;
      return {
        label: "e-Way Bill",
        tone: expiring ? "waiting" : "done",
        status: "Generated",
        detail: ewayBill?.validUntil
          ? `${ewayBill.ewbNumber} · valid ${relativeTime(ewayBill.validUntil)}`
          : (ewayBill?.ewbNumber ?? null),
      };
    }
    case "expired":
      return {
        label: "e-Way Bill",
        tone: "problem",
        status: "Expired",
        detail: ewayBill?.ewbNumber ? `${ewayBill.ewbNumber} is no longer valid` : null,
      };
    case "failed":
      return {
        label: "e-Way Bill",
        tone: "problem",
        status: "Could not be generated",
        detail: ewayBill?.lastError ?? null,
      };
    case "cancelled":
      return { label: "e-Way Bill", tone: "skipped", status: "Cancelled", detail: null };
    default:
      return { label: "e-Way Bill", tone: "waiting", status: "Not made yet", detail: null };
  }
}

export function ComplianceStatus({
  invoice,
  einvoice,
  ewayBill,
}: {
  invoice: Invoice;
  einvoice: Einvoice | null;
  ewayBill: EwayBill | null;
}) {
  const steps = [invoiceStep(invoice), einvoiceStep(invoice, einvoice), ewbStep(invoice, ewayBill)];

  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const mark = MARK[step.tone];
        return (
          <li key={step.label} className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${mark.className}`}
              aria-hidden
            >
              {mark.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">{step.label}</p>
              <p className={`text-sm font-medium ${TEXT[step.tone]}`}>{step.status}</p>
              {step.detail && (
                <p className="mt-0.5 text-xs break-words text-muted">{step.detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
