/** GST supply classification helpers. */

export type SupplyType = "intra_state" | "inter_state";

/**
 * Supply category drives both the IRP `TranDtls`/`DocDtls` fields and the tax
 * treatment (IGST vs CGST+SGST, zero-rated exports, SEZ).
 */
export const SUPPLY_CATEGORIES = [
  "b2b",
  "b2c",
  "export_wp", // export with payment of tax
  "export_wop", // export without payment (LUT/bond)
  "sez_wp",
  "sez_wop",
  "deemed_export",
] as const;
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];

/** IRP `TranDtls.SupTyp` code for each category. */
export const IRP_SUPPLY_TYPE: Record<SupplyCategory, string> = {
  b2b: "B2B",
  b2c: "B2C",
  export_wp: "EXPWP",
  export_wop: "EXPWOP",
  sez_wp: "SEZWP",
  sez_wop: "SEZWOP",
  deemed_export: "DEXP",
};

/** Standard ad-valorem GST slabs in percent. */
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28] as const;

export interface SupplyTypeInput {
  /** Supplier's GSTIN state code (first two digits). */
  supplierStateCode: string;
  /** Place of supply state code. */
  placeOfSupplyStateCode: string;
  supplyCategory?: SupplyCategory;
  /**
   * Section 10(1)(b) / SEZ cases where IGST applies even though supplier and
   * place of supply share a state.
   */
  forceIgst?: boolean;
}

/**
 * Exports, SEZ supplies and supplies to "Other Country/Territory" are always
 * inter-state; otherwise the state codes decide.
 */
export function determineSupplyType(input: SupplyTypeInput): SupplyType {
  if (input.forceIgst) return "inter_state";
  const cat = input.supplyCategory;
  if (cat && cat !== "b2b" && cat !== "b2c") return "inter_state";
  const pos = input.placeOfSupplyStateCode;
  if (pos === "96" || pos === "97") return "inter_state";
  return input.supplierStateCode === pos ? "intra_state" : "inter_state";
}

/** Exports and SEZ-without-payment supplies are zero-rated. */
export function isZeroRated(category: SupplyCategory): boolean {
  return category === "export_wop" || category === "sez_wop";
}

export function isExportCategory(category: SupplyCategory): boolean {
  return category.startsWith("export") || category.startsWith("sez");
}
