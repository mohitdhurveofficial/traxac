import type { Database } from "@traxac/database";
import { hsnCodes, units } from "@traxac/database";
import { UQC_UNITS } from "@traxac/shared";

/**
 * Reference data that every tenant shares. Idempotent, so it can run on every
 * deploy as part of the release step.
 */
const COMMON_HSN: Array<[code: string, description: string, rate: string, service?: boolean]> = [
  ["1006", "Rice", "5"],
  ["1701", "Cane or beet sugar", "5"],
  ["2523", "Cement", "28"],
  ["3004", "Medicaments, packaged for retail sale", "12"],
  ["3208", "Paints and varnishes", "18"],
  ["3923", "Plastic articles for conveyance or packing of goods", "18"],
  ["3926", "Other articles of plastics", "18"],
  ["4819", "Cartons, boxes and cases of paper or paperboard", "18"],
  ["5208", "Woven cotton fabrics", "5"],
  ["6109", "T-shirts, singlets and vests, knitted", "5"],
  ["7208", "Flat-rolled products of iron or non-alloy steel", "18"],
  ["7214", "Bars and rods of iron or non-alloy steel", "18"],
  ["7308", "Structures and parts of structures, of iron or steel", "18"],
  ["7318", "Screws, bolts, nuts and similar articles of iron or steel", "18"],
  ["8413", "Pumps for liquids", "18"],
  ["8414", "Air or vacuum pumps, compressors and fans", "18"],
  ["8481", "Taps, cocks, valves and similar appliances", "18"],
  ["8504", "Electrical transformers and static converters", "18"],
  ["8517", "Telephone sets and other apparatus for communication", "18"],
  ["8544", "Insulated wire and cable", "18"],
  ["8708", "Parts and accessories of motor vehicles", "28"],
  ["9403", "Other furniture and parts thereof", "18"],
  ["996511", "Road transport services of goods", "5", true],
  ["997212", "Rental or leasing services involving own or leased non-residential property", "18", true],
  ["998313", "Information technology consulting and support services", "18", true],
  ["998399", "Other professional, technical and business services", "18", true],
  ["999799", "Other services not elsewhere classified", "18", true],
];

export async function seedReferenceData(database: Database): Promise<void> {
  await database.db.insert(units).values(
    UQC_UNITS.map((u) => ({
      code: u.code,
      description: u.description,
      qtyDecimals: u.qtyDecimals,
    })),
  ).onConflictDoNothing();

  await database.db.insert(hsnCodes).values(
    COMMON_HSN.map(([code, description, defaultGstRate, isService]) => ({
      code,
      description,
      defaultGstRate,
      isService: isService ?? false,
    })),
  ).onConflictDoNothing();
}
