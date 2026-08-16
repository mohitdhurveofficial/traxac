/**
 * GST rate slabs and supply-type determination.
 */

export type SupplyType = "intra_state" | "inter_state";
export type TransactionType = "b2b" | "b2c" | "export" | "import";

/** Standard GST slabs in percent. Cess handled separately where applicable. */
export const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28] as const;
export type GstSlab = (typeof GST_SLABS)[number];

export interface RateBreakdownInput {
  /** Seller (supplier) GSTIN state code. */
  supplierStateCode: string;
  /** Place of supply state code. */
  placeOfSupplyStateCode: string;
  /** Buyer is outside India (export / SEZ). */
  isExport?: boolean;
}

export function determineSupplyType(
  input: RateBreakdownInput,
): SupplyType {
  if (input.isExport) return "inter_state";
  return input.supplierStateCode === input.placeOfSupplyStateCode
    ? "intra_state"
    : "inter_state";
}

/** True when the transaction qualifies as Exempt/Nil-rated slab (0%). */
export function isNilRateSlab(rate: number): boolean {
  return rate === 0;
}
