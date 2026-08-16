/**
 * GST state codes as published by GSTN (first two digits of a GSTIN).
 * Format: [stateCode, stateName]. Used for place-of-supply and GSTIN validation.
 */
const STATES: ReadonlyArray<readonly [string, string]> = [
  ["01", "Jammu & Kashmir"],
  ["02", "Himachal Pradesh"],
  ["03", "Punjab"],
  ["04", "Chandigarh"],
  ["05", "Uttarakhand"],
  ["06", "Haryana"],
  ["07", "Delhi"],
  ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"],
  ["10", "Bihar"],
  ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"],
  ["14", "Manipur"],
  ["15", "Mizoram"],
  ["16", "Tripura"],
  ["17", "Meghalaya"],
  ["18", "Assam"],
  ["19", "West Bengal"],
  ["20", "Jharkhand"],
  ["21", "Odisha"],
  ["22", "Chhattisgarh"],
  ["23", "Madhya Pradesh"],
  ["24", "Gujarat"],
  ["26", "Dadra & Nagar Haveli and Daman & Diu"],
  ["27", "Maharashtra"],
  ["29", "Karnataka"],
  ["30", "Goa"],
  ["31", "Lakshadweep"],
  ["32", "Kerala"],
  ["33", "Tamil Nadu"],
  ["34", "Puducherry"],
  ["35", "Andaman & Nicobar Islands"],
  ["36", "Telangana"],
  ["37", "Andhra Pradesh"],
  ["38", "Ladakh"],
  ["96", "Other Country"],
  ["97", "Other Territory"],
];

export const GST_STATE_CODES: Record<string, string> = Object.fromEntries(STATES);

/** Reverse lookup: state name -> state code. */
export const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  STATES.map(([code, name]) => [name, code]),
);

export function isValidStateCode(code: string): boolean {
  return code in GST_STATE_CODES;
}
