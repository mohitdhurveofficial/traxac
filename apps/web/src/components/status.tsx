import type { ReactNode } from "react";
import { relativeTime } from "../lib/format.js";

/**
 * Status vocabulary.
 *
 * Traders do not think in "einvoiceStatus: queued". They think "is it done,
 * is it working, or does it need me?". Every status maps onto one of three
 * tones, and the label says what it means in plain words.
 */
type Tone = "neutral" | "progress" | "good" | "warn" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  progress: "bg-blue-50 text-blue-700",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-red-50 text-red-700",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${TONE_CLASS[tone]}`}>{children}</span>;
}

function Dot({ tone }: { tone: Tone }) {
  const colour = {
    neutral: "bg-slate-400",
    progress: "bg-blue-500",
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
  }[tone];
  return <span className={`size-1.5 rounded-full ${colour}`} aria-hidden />;
}

const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Issued", tone: "progress" },
  generated: { label: "Issued", tone: "good" },
  failed: { label: "Needs attention", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  completed: { label: "Paid", tone: "good" },
};

export function InvoiceStatus({ status }: { status: string }) {
  const meta = INVOICE_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <Pill tone={meta.tone}>
      <Dot tone={meta.tone} />
      {meta.label}
    </Pill>
  );
}

const EINVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  not_required: { label: "e-Invoice not needed", tone: "neutral" },
  pending: { label: "e-Invoice not sent", tone: "warn" },
  queued: { label: "Sending to IRP…", tone: "progress" },
  processing: { label: "Sending to IRP…", tone: "progress" },
  generated: { label: "IRN generated", tone: "good" },
  failed: { label: "IRN failed", tone: "bad" },
  cancelled: { label: "IRN cancelled", tone: "neutral" },
};

export function EinvoiceStatus({ status }: { status: string }) {
  const meta = EINVOICE_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  if (status === "not_required") return null;
  return (
    <Pill tone={meta.tone}>
      <Dot tone={meta.tone} />
      {meta.label}
    </Pill>
  );
}

const EWB_STATUS: Record<string, { label: string; tone: Tone }> = {
  not_required: { label: "No e-Way Bill needed", tone: "neutral" },
  pending: { label: "e-Way Bill not made", tone: "warn" },
  queued: { label: "Making e-Way Bill…", tone: "progress" },
  processing: { label: "Making e-Way Bill…", tone: "progress" },
  generated: { label: "e-Way Bill active", tone: "good" },
  part_b_pending: { label: "Vehicle details needed", tone: "warn" },
  failed: { label: "e-Way Bill failed", tone: "bad" },
  expired: { label: "e-Way Bill expired", tone: "bad" },
  cancelled: { label: "e-Way Bill cancelled", tone: "neutral" },
};

export function EwbStatus({ status, validUntil }: { status: string; validUntil?: string | null }) {
  const meta = EWB_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  if (status === "not_required") return null;

  // An active bill about to lapse is the single most time-critical thing on
  // the screen, so it changes tone rather than hiding behind a date.
  if (status === "generated" && validUntil) {
    const hoursLeft = (new Date(validUntil).getTime() - Date.now()) / 3_600_000;
    if (hoursLeft < 0) {
      return (
        <Pill tone="bad">
          <Dot tone="bad" />
          e-Way Bill expired
        </Pill>
      );
    }
    if (hoursLeft < 12) {
      return (
        <Pill tone="warn">
          <Dot tone="warn" />
          e-Way Bill expires {relativeTime(validUntil)}
        </Pill>
      );
    }
  }
  return (
    <Pill tone={meta.tone}>
      <Dot tone={meta.tone} />
      {meta.label}
    </Pill>
  );
}

export function PaymentStatus({ total, paid }: { total: number; paid: number }) {
  if (paid <= 0) return <Pill tone="neutral">Unpaid</Pill>;
  if (paid >= total) return <Pill tone="good">Paid</Pill>;
  return <Pill tone="warn">Part paid</Pill>;
}
