import { determineSupplyType, type SupplyType } from "./supply.js";
import { toPaise, type Paise } from "./money.js";

/**
 * Line-level inputs: quantity x unit price with discounts and GST rate.
 * All rupee values accepted as number|string; normalized internally to paise.
 */
export interface TaxLineInput {
  quantity: number;
  unitPrice: number | string;
  /** Discount percent applied on line basis (0-100). */
  discountPercent?: number;
  /** GST rate percent applicable to the line, e.g. 18. */
  gstRate: number;
}

/** Additional charges (freight, packing, insurance...) with GST treatment. */
export interface AdditionalChargeInput {
  label: string;
  amount: number | string;
  /** Percent if the charge is taxable; omit/0 for non-taxable. */
  gstRate?: number;
}

export interface LineTaxResult {
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  lineTotal: Paise;
}

export interface TaxCalcResult {
  supplyType: SupplyType;
  lines: LineTaxResult[];
  subtotal: Paise;
  totalAdditionalCharges: Paise;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  roundOff: Paise;
  grandTotal: Paise;
}

const roundHalfUp = (paise: number): Paise => Math.round(paise) as Paise;

export interface CalcInvoiceInput {
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  isExport?: boolean;
  lines: TaxLineInput[];
  additionalCharges?: AdditionalChargeInput[];
  /** Pre-tax flat discount on the whole invoice, in rupees. */
  invoiceDiscount?: number | string;
}

/**
 * Core deterministic GST computation.
 * - Per-line: taxable = qty*price - lineDiscount; tax = taxable * rate/100.
 * - Intra-state: CGST+SGST split; Inter-state: IGST.
 * - Round-off applied once at grand-total level to nearest rupee.
 */
export function calculateInvoiceTax(
  input: CalcInvoiceInput,
): TaxCalcResult {
  const supplyType = determineSupplyType({
    supplierStateCode: input.supplierStateCode,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    isExport: input.isExport,
  });

  const lines: LineTaxResult[] = input.lines.map((line) => {
    const gross = roundHalfUp(toPaise(line.unitPrice) * line.quantity);
    const discount = roundHalfUp(
      (gross * (line.discountPercent ?? 0)) / 100,
    );
    const taxable = roundHalfUp(gross - discount);
    const totalTax = roundHalfUp((taxable * line.gstRate) / 100);
    const lineTotal = roundHalfUp(taxable + totalTax);
    if (supplyType === "intra_state") {
      const half = roundHalfUp(totalTax / 2);
      const cgst = half;
      const sgst = roundHalfUp(totalTax - half); // keep sum exact after rounding
      return { taxableValue: taxable, cgst, sgst, igst: 0 as Paise, totalTax, lineTotal };
    }
    return {
      taxableValue: taxable,
      cgst: 0 as Paise,
      sgst: 0 as Paise,
      igst: totalTax,
      totalTax,
      lineTotal,
    };
  });

  const subtotal = roundHalfUp(lines.reduce((s, l) => s + l.taxableValue, 0));
  const invoiceDiscountPaise = roundHalfUp(toPaise(input.invoiceDiscount ?? 0));
  const charges = (input.additionalCharges ?? []).map((c) => ({
    ...c,
    amountPaise: roundHalfUp(toPaise(c.amount)),
    taxPaise: roundHalfUp((roundHalfUp(toPaise(c.amount)) * (c.gstRate ?? 0)) / 100),
  }));
  const totalAdditionalCharges = roundHalfUp(
    charges.reduce((s, c) => s + c.amountPaise + c.taxPaise, 0),
  );
  const taxableValue = roundHalfUp(subtotal - invoiceDiscountPaise);
  const cgst = roundHalfUp(lines.reduce((s, l) => s + l.cgst, 0));
  const sgst = roundHalfUp(lines.reduce((s, l) => s + l.sgst, 0));
  const igst = roundHalfUp(lines.reduce((s, l) => s + l.igst, 0));
  const totalTax = roundHalfUp(cgst + sgst + igst);
  const raw = roundHalfUp(taxableValue + totalTax + totalAdditionalCharges);
  const grandTotal = roundHalfUp(Math.round(raw / 100) * 100); // nearest rupee
  const roundOff = roundHalfUp(grandTotal - raw);

  return {
    supplyType,
    lines,
    subtotal,
    totalAdditionalCharges,
    taxableValue,
    cgst,
    sgst,
    igst,
    totalTax,
    roundOff,
    grandTotal,
  };
}
