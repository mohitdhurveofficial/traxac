/**
 * Every monetary amount in Ewayvo is an integer number of **paise**.
 * Floating-point rupees are never persisted or summed.
 */
export type Paise = number;

/** Convert rupees (number or numeric string) to integer paise. */
export function toPaise(rupees: number | string | null | undefined): Paise {
  if (rupees === null || rupees === undefined || rupees === "") return 0;
  const n = typeof rupees === "string" ? Number.parseFloat(rupees) : rupees;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Convert integer paise back to rupees with at most 2 decimals. */
export function toRupees(paise: Paise): number {
  return Math.round(paise) / 100;
}

/** Rupees as a plain 2-decimal string — the format the IRP/EWB APIs expect. */
export function rupeeString(paise: Paise): string {
  return (Math.round(paise) / 100).toFixed(2);
}

/** Rupees as a number rounded to 2 decimals, for JSON payloads to NIC. */
export function rupeeNumber(paise: Paise): number {
  return Number.parseFloat(rupeeString(paise));
}

/** Format integer paise as an Indian currency string, e.g. ₹1,23,456.78. */
export function formatINR(paise: Paise, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
  }).format(toRupees(paise));
}

/** Half-up rounding to whole paise (banker's rounding is not used by GST). */
export function roundPaise(value: number): Paise {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Round a paise amount to the nearest rupee (used for invoice round-off). */
export function roundToRupee(paise: Paise): Paise {
  return Math.sign(paise) * Math.round(Math.abs(paise) / 100) * 100;
}

/** Split a tax amount into two equal halves that still sum exactly. */
export function splitHalf(total: Paise): [Paise, Paise] {
  const first = roundPaise(total / 2);
  return [first, total - first];
}

/** Indian-format amount in words, used on printed invoices. */
export function amountInWords(paise: Paise): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const paiseRemainder = Math.abs(paise) % 100;
  const words = numberToWords(rupees);
  const parts = [`${words} Rupees`];
  if (paiseRemainder > 0) parts.push(`and ${numberToWords(paiseRemainder)} Paise`);
  const sign = paise < 0 ? "Minus " : "";
  return `${sign}${parts.join(" ")} Only`;
}

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] as string;
  const t = TENS[Math.floor(n / 10)] as string;
  const o = n % 10;
  return o ? `${t} ${ONES[o]}` : t;
}

/** Indian numbering system: crore, lakh, thousand, hundred. */
function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${numberToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}
