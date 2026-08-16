/**
 * Unit Quantity Codes accepted by the IRP and e-Way Bill APIs.
 * Using anything outside this list gets the payload rejected.
 */
export interface UqcDefinition {
  code: string;
  description: string;
  qtyDecimals: number;
}

export const UQC_UNITS: readonly UqcDefinition[] = [
  { code: "BAG", description: "Bags", qtyDecimals: 0 },
  { code: "BAL", description: "Bale", qtyDecimals: 0 },
  { code: "BDL", description: "Bundles", qtyDecimals: 0 },
  { code: "BKL", description: "Buckles", qtyDecimals: 0 },
  { code: "BOU", description: "Billion of Units", qtyDecimals: 3 },
  { code: "BOX", description: "Box", qtyDecimals: 0 },
  { code: "BTL", description: "Bottles", qtyDecimals: 0 },
  { code: "BUN", description: "Bunches", qtyDecimals: 0 },
  { code: "CAN", description: "Cans", qtyDecimals: 0 },
  { code: "CBM", description: "Cubic Meters", qtyDecimals: 3 },
  { code: "CCM", description: "Cubic Centimeters", qtyDecimals: 3 },
  { code: "CMS", description: "Centimeters", qtyDecimals: 2 },
  { code: "CTN", description: "Cartons", qtyDecimals: 0 },
  { code: "DOZ", description: "Dozens", qtyDecimals: 0 },
  { code: "DRM", description: "Drums", qtyDecimals: 0 },
  { code: "GGK", description: "Great Gross", qtyDecimals: 0 },
  { code: "GMS", description: "Grammes", qtyDecimals: 3 },
  { code: "GRS", description: "Gross", qtyDecimals: 0 },
  { code: "GYD", description: "Gross Yards", qtyDecimals: 2 },
  { code: "KGS", description: "Kilograms", qtyDecimals: 3 },
  { code: "KLR", description: "Kilolitre", qtyDecimals: 3 },
  { code: "KME", description: "Kilometre", qtyDecimals: 2 },
  { code: "LTR", description: "Litres", qtyDecimals: 3 },
  { code: "MLT", description: "Millilitre", qtyDecimals: 2 },
  { code: "MTR", description: "Meters", qtyDecimals: 2 },
  { code: "MTS", description: "Metric Ton", qtyDecimals: 3 },
  { code: "NOS", description: "Numbers", qtyDecimals: 0 },
  { code: "PAC", description: "Packs", qtyDecimals: 0 },
  { code: "PCS", description: "Pieces", qtyDecimals: 0 },
  { code: "PRS", description: "Pairs", qtyDecimals: 0 },
  { code: "QTL", description: "Quintal", qtyDecimals: 3 },
  { code: "ROL", description: "Rolls", qtyDecimals: 0 },
  { code: "SET", description: "Sets", qtyDecimals: 0 },
  { code: "SQF", description: "Square Feet", qtyDecimals: 2 },
  { code: "SQM", description: "Square Meters", qtyDecimals: 2 },
  { code: "SQY", description: "Square Yards", qtyDecimals: 2 },
  { code: "TBS", description: "Tablets", qtyDecimals: 0 },
  { code: "TGM", description: "Ten Gross", qtyDecimals: 0 },
  { code: "THD", description: "Thousands", qtyDecimals: 0 },
  { code: "TON", description: "Tonnes", qtyDecimals: 3 },
  { code: "TUB", description: "Tubes", qtyDecimals: 0 },
  { code: "UGS", description: "US Gallons", qtyDecimals: 3 },
  { code: "UNT", description: "Units", qtyDecimals: 0 },
  { code: "YDS", description: "Yards", qtyDecimals: 2 },
  { code: "OTH", description: "Others", qtyDecimals: 3 },
];

const UQC_MAP = new Map(UQC_UNITS.map((u) => [u.code, u]));

export function isValidUqc(code: string): boolean {
  return UQC_MAP.has(code.trim().toUpperCase());
}

export function uqc(code: string): UqcDefinition | undefined {
  return UQC_MAP.get(code.trim().toUpperCase());
}
