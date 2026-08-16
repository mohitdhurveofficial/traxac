import {
  roundPaise, roundToRupee, splitHalf, toPaise, type Paise,
} from "./money.js";
import {
  determineSupplyType, type SupplyCategory, type SupplyType,
} from "./supply.js";

/**
 * Deterministic GST computation engine.
 *
 * Contract:
 *  - Inputs are integer paise (or rupee strings that are converted once).
 *  - Every intermediate is rounded to whole paise, half-up.
 *  - CGST/SGST halves are derived so that cgst + sgst === totalGst exactly.
 *  - Round-off is applied once, at grand-total level, to the nearest rupee.
 * The same function runs in the API, the worker and the browser, so a
 * preview can never disagree with what is persisted or sent to the IRP.
 */

export interface TaxLineInput {
  /** Quantity; supports up to 3 decimals. */
  quantity: number;
  /** Unit price in paise. */
  unitPrice: Paise;
  /** Percentage discount on the line (0-100). Applied before any flat amount. */
  discountPercent?: number;
  /** Flat discount in paise, applied after the percentage discount. */
  discountAmount?: Paise;
  /** Ad-valorem GST rate, e.g. 18. */
  gstRate: number;
  /** Ad-valorem compensation cess rate, e.g. 12. */
  cessRate?: number;
  /** Quantity-based (non ad-valorem) cess in paise, e.g. per-1000-sticks. */
  cessNonAdvol?: Paise;
  /** State-specific cess in paise (Kerala flood cess and similar). */
  stateCess?: Paise;
}

export interface ChargeInput {
  label: string;
  /** Charge amount in paise. */
  amount: Paise;
  /** GST rate applied to the charge; 0 for non-taxable charges. */
  gstRate?: number;
}

export interface LineTaxResult {
  grossValue: Paise;
  discountAmount: Paise;
  taxableValue: Paise;
  gstRate: number;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  cessNonAdvol: Paise;
  stateCess: Paise;
  totalTax: Paise;
  lineTotal: Paise;
}

export interface ChargeTaxResult {
  label: string;
  amount: Paise;
  gstRate: number;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  taxAmount: Paise;
}

export interface TaxTotals {
  supplyType: SupplyType;
  lines: LineTaxResult[];
  charges: ChargeTaxResult[];
  /** Sum of line gross values (qty x price) before discount. */
  grossValue: Paise;
  totalDiscount: Paise;
  /** Sum of line taxable values after discount. */
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  cessNonAdvol: Paise;
  stateCess: Paise;
  totalTax: Paise;
  /** Charge amounts excluding their tax. */
  otherCharges: Paise;
  roundOff: Paise;
  grandTotal: Paise;
}

export interface CalcInvoiceInput {
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  supplyCategory?: SupplyCategory;
  /** Force IGST for Sec 10(1)(b) / SEZ intra-state cases. */
  igstOnIntra?: boolean;
  /** Zero-rated (LUT export / SEZ without payment): no tax charged. */
  zeroRated?: boolean;
  lines: TaxLineInput[];
  charges?: ChargeInput[];
  /** Disable the nearest-rupee round-off (some buyers require exact paise). */
  disableRoundOff?: boolean;
}

function computeLine(
  line: TaxLineInput,
  supplyType: SupplyType,
  zeroRated: boolean,
): LineTaxResult {
  const grossValue = roundPaise(line.unitPrice * line.quantity);
  const percentDiscount = roundPaise((grossValue * (line.discountPercent ?? 0)) / 100);
  const discountAmount = Math.min(
    grossValue,
    percentDiscount + roundPaise(line.discountAmount ?? 0),
  );
  const taxableValue = grossValue - discountAmount;

  const gstRate = zeroRated ? 0 : line.gstRate;
  const gstTotal = roundPaise((taxableValue * gstRate) / 100);
  const cess = zeroRated ? 0 : roundPaise((taxableValue * (line.cessRate ?? 0)) / 100);
  const cessNonAdvol = zeroRated ? 0 : roundPaise(line.cessNonAdvol ?? 0);
  const stateCess = zeroRated ? 0 : roundPaise(line.stateCess ?? 0);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (supplyType === "intra_state") {
    [cgst, sgst] = splitHalf(gstTotal);
  } else {
    igst = gstTotal;
  }

  const totalTax = cgst + sgst + igst + cess + cessNonAdvol + stateCess;
  return {
    grossValue,
    discountAmount,
    taxableValue,
    gstRate,
    cgst,
    sgst,
    igst,
    cess,
    cessNonAdvol,
    stateCess,
    totalTax,
    lineTotal: taxableValue + totalTax,
  };
}

function computeCharge(
  charge: ChargeInput,
  supplyType: SupplyType,
  zeroRated: boolean,
): ChargeTaxResult {
  const amount = roundPaise(charge.amount);
  const gstRate = zeroRated ? 0 : charge.gstRate ?? 0;
  const tax = roundPaise((amount * gstRate) / 100);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (supplyType === "intra_state") {
    [cgst, sgst] = splitHalf(tax);
  } else {
    igst = tax;
  }
  return { label: charge.label, amount, gstRate, cgst, sgst, igst, taxAmount: tax };
}

export function calculateInvoiceTax(input: CalcInvoiceInput): TaxTotals {
  const supplyType = determineSupplyType({
    supplierStateCode: input.supplierStateCode,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    supplyCategory: input.supplyCategory,
    forceIgst: input.igstOnIntra,
  });
  const zeroRated = input.zeroRated ?? false;

  const lines = input.lines.map((l) => computeLine(l, supplyType, zeroRated));
  const charges = (input.charges ?? []).map((c) => computeCharge(c, supplyType, zeroRated));

  const sum = <T>(items: T[], pick: (item: T) => number): number =>
    items.reduce((acc, item) => acc + pick(item), 0);

  const grossValue = sum(lines, (l) => l.grossValue);
  const totalDiscount = sum(lines, (l) => l.discountAmount);
  const taxableValue = sum(lines, (l) => l.taxableValue);
  const cgst = sum(lines, (l) => l.cgst) + sum(charges, (c) => c.cgst);
  const sgst = sum(lines, (l) => l.sgst) + sum(charges, (c) => c.sgst);
  const igst = sum(lines, (l) => l.igst) + sum(charges, (c) => c.igst);
  const cess = sum(lines, (l) => l.cess);
  const cessNonAdvol = sum(lines, (l) => l.cessNonAdvol);
  const stateCess = sum(lines, (l) => l.stateCess);
  const otherCharges = sum(charges, (c) => c.amount);
  const totalTax = cgst + sgst + igst + cess + cessNonAdvol + stateCess;

  const preRounding = taxableValue + totalTax + otherCharges;
  const grandTotal = input.disableRoundOff ? preRounding : roundToRupee(preRounding);

  return {
    supplyType,
    lines,
    charges,
    grossValue,
    totalDiscount,
    taxableValue,
    cgst,
    sgst,
    igst,
    cess,
    cessNonAdvol,
    stateCess,
    totalTax,
    otherCharges,
    roundOff: grandTotal - preRounding,
    grandTotal,
  };
}

/** Convenience wrapper accepting rupee values (UI previews, imports). */
export function calculateFromRupees(input: {
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  supplyCategory?: SupplyCategory;
  igstOnIntra?: boolean;
  zeroRated?: boolean;
  lines: Array<Omit<TaxLineInput, "unitPrice" | "discountAmount"> & {
    unitPrice: number | string;
    discountAmount?: number | string;
  }>;
  charges?: Array<Omit<ChargeInput, "amount"> & { amount: number | string }>;
}): TaxTotals {
  return calculateInvoiceTax({
    ...input,
    lines: input.lines.map((l) => ({
      ...l,
      unitPrice: toPaise(l.unitPrice),
      discountAmount: toPaise(l.discountAmount ?? 0),
    })),
    charges: (input.charges ?? []).map((c) => ({ ...c, amount: toPaise(c.amount) })),
  });
}

/**
 * HSN-wise tax summary printed on invoices and used for GSTR-1 style reports.
 */
export interface HsnSummaryRow {
  hsnSac: string;
  quantity: number;
  unit: string;
  taxableValue: Paise;
  gstRate: number;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  cess: Paise;
  total: Paise;
}

export function summariseByHsn(
  lines: Array<LineTaxResult & { hsnSac: string; quantity: number; unit: string }>,
): HsnSummaryRow[] {
  const map = new Map<string, HsnSummaryRow>();
  for (const line of lines) {
    const key = `${line.hsnSac}|${line.gstRate}`;
    const existing = map.get(key);
    const row: HsnSummaryRow = existing ?? {
      hsnSac: line.hsnSac,
      quantity: 0,
      unit: line.unit,
      taxableValue: 0,
      gstRate: line.gstRate,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      total: 0,
    };
    row.quantity += line.quantity;
    row.taxableValue += line.taxableValue;
    row.cgst += line.cgst;
    row.sgst += line.sgst;
    row.igst += line.igst;
    row.cess += line.cess + line.cessNonAdvol + line.stateCess;
    row.total = row.taxableValue + row.cgst + row.sgst + row.igst + row.cess;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.hsnSac.localeCompare(b.hsnSac));
}
