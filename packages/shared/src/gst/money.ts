/**
 * All monetary values are stored as integer paise to avoid floating-point drift.
 */
export type Paise = number & { __brand: "paise" };

/** Convert rupees (number or numeric string) to integer paise. */
export function toPaise(rupees: number | string): Paise {
  const n =
    typeof rupees === "string"
      ? Number.parseFloat(rupees || "0") || 0
      : rupees;
  return Math.round(n * 100) as Paise;
}

/** Convert integer paise back to rupees (may have up to 2 decimals). */
export function toRupees(paise: Paise | number): number {
  return Math.round(paise) / 100;
}

/** Format integer paise as an INR currency string, e.g. Rs 1,23,456.78. */
export function formatINR(paise: Paise | number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(toRupees(paise));
}
