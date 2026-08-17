/**
 * Date helpers. Indian GST works on a 1-April..31-March financial year and the
 * NIC APIs exchange dates as dd/mm/yyyy strings in IST.
 */

export const IST_OFFSET_MINUTES = 330;

/** Shift a UTC instant into IST wall-clock components. */
function istParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** dd/mm/yyyy — the format used by both IRP and EWB payloads. */
export function toNicDate(date: Date): string {
  const { y, m, d } = istParts(date);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** dd/mm/yyyy hh:mm — used by EWB validity and Part-B timestamps. */
export function toNicDateTime(date: Date): string {
  const { y, m, d, hh, mm } = istParts(date);
  return `${pad(d)}/${pad(m)}/${y} ${pad(hh)}:${pad(mm)}`;
}

/** yyyy-mm-dd in IST — used for ISO-style API responses and grouping. */
export function toIsoDate(date: Date): string {
  const { y, m, d } = istParts(date);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parse dd/mm/yyyy [hh:mm[:ss]] returned by NIC into a UTC Date. */
export function parseNicDateTime(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, d, m, y, hh, mm, ss] = match;
  const utcMs = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh ?? 0),
    Number(mm ?? 0),
    Number(ss ?? 0),
  );
  return new Date(utcMs - IST_OFFSET_MINUTES * 60_000);
}

/** Financial year label for a date, e.g. "2026-27". */
export function financialYear(date: Date): string {
  const { y, m } = istParts(date);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${pad((startYear + 1) % 100)}`;
}

/** First instant (IST) of a financial year label like "2026-27". */
export function financialYearStart(label: string): Date {
  const startYear = Number(label.slice(0, 4));
  return new Date(Date.UTC(startYear, 3, 1) - IST_OFFSET_MINUTES * 60_000);
}

export function financialYearEnd(label: string): Date {
  const startYear = Number(label.slice(0, 4));
  return new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999) - IST_OFFSET_MINUTES * 60_000);
}

/** Start of the IST day containing `date`, as a UTC instant. */
export function startOfIstDay(date: Date): Date {
  const { y, m, d } = istParts(date);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MINUTES * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

/** Whole hours between two instants, rounded down. */
export function hoursBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 3_600_000);
}
