/**
 * Display helpers. The API speaks integer paise; the UI speaks rupees, and
 * this is the only place that converts between them.
 */

export function rupees(paise: number | string | null | undefined): number {
  return Number(paise ?? 0) / 100;
}

export function money(paise: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees(paise));
}

/** Short form for dense tables and tiles: ₹1.04L, ₹2.3Cr. */
export function moneyCompact(paise: number | string | null | undefined): string {
  const value = rupees(paise);
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(value / 1_00_000).toFixed(2)}L`;
  if (abs >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${value.toFixed(0)}`;
}

export function toPaise(rupeeValue: number | string | null | undefined): number {
  const n = typeof rupeeValue === "string" ? Number.parseFloat(rupeeValue) : rupeeValue ?? 0;
  return Number.isFinite(n) ? Math.round((n) * 100) : 0;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
});
const DATETIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return DATE_FORMAT.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return DATETIME_FORMAT.format(new Date(value));
}

/** yyyy-mm-dd for <input type="date">, in IST. */
export function dateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

/** "in 6 hours", "3 days ago" — used for e-Way Bill validity. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const target = new Date(value).getTime();
  const diffMs = target - Date.now();
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms || unit === "minute") {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "now";
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/**
 * Read a text field from a form.
 *
 * `FormData.get` returns `string | File | null`, so coercing it with `String()`
 * would render "[object Object]" if a file ever reached a text field. This
 * narrows properly and gives a predictable empty string for absent fields.
 */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Read a checkbox: browsers submit "on" when checked and omit it otherwise. */
export function checked(form: FormData, name: string): boolean {
  return form.get(name) === "on";
}

/** Read a numeric field, falling back to 0 for blank or unparseable input. */
export function numberField(form: FormData, name: string): number {
  const parsed = Number.parseFloat(field(form, name));
  return Number.isFinite(parsed) ? parsed : 0;
}
