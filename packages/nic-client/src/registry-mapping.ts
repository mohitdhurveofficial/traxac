import type {
  GstinBlockStatus,
  GstinDetails,
  GstinRegistrationStatus,
  TransporterDetails,
} from "@ewayvo/gst-gateway";

/**
 * Normalising two portals that describe the same taxpayer differently.
 *
 * The IRP returns `LegalName`, `AddrBnm`, `AddrPncd`; the e-Way Bill portal
 * returns `legalName`, `address1`, `pinCode`. Neither is more correct, so both
 * are mapped onto one shape.
 *
 * The rule throughout: a field the portal did not send becomes `null`, never a
 * derived or defaulted value. A blank trade name is a fact about the register,
 * and quietly substituting the legal name would put words in a taxpayer's
 * mouth on a printed invoice.
 *
 * @see https://einv-apisandbox.nic.in/version1.03/get-gstin-details.html
 * @see https://docs.ewaybillgst.gov.in/apidocs/version1.03/get-gstin-details.html
 */

/** Only 'ACT' means active. Everything else is reported as it came. */
export function parseRegistrationStatus(value: unknown): GstinRegistrationStatus {
  const raw = text(value)?.toUpperCase();
  if (raw === "ACT" || raw === "CNL" || raw === "INA" || raw === "PRO") return raw;
  return "UNKNOWN";
}

/** 'B' is blocked; 'U' or blank is unblocked; absent is genuinely unknown. */
export function parseBlockStatus(value: unknown): GstinBlockStatus {
  if (value === null || value === undefined) return "unknown";
  const raw = String(value).trim().toUpperCase();
  if (raw === "B") return "blocked";
  if (raw === "U" || raw === "") return "unblocked";
  return "unknown";
}

/** IRP shape: `/eivital/v1.03/Master/gstin/<GSTIN>`. */
export function mapIrpGstinDetails(data: Record<string, unknown>, requested: string): GstinDetails {
  return {
    gstin: text(data["Gstin"]) ?? requested,
    legalName: text(data["LegalName"]),
    tradeName: text(data["TradeName"]),
    status: parseRegistrationStatus(data["Status"]),
    statusRaw: text(data["Status"]),
    taxpayerType: text(data["TxpType"]),
    blockStatus: parseBlockStatus(data["BlkStatus"]),
    // The IRP breaks the address into more parts than the e-Way Bill portal.
    buildingName: text(data["AddrBnm"]),
    buildingNumber: text(data["AddrBno"]),
    floorNumber: text(data["AddrFlno"]),
    street: text(data["AddrSt"]),
    location: text(data["AddrLoc"]),
    addressLine1: joinAddress([data["AddrBno"], data["AddrBnm"], data["AddrFlno"]]),
    addressLine2: joinAddress([data["AddrSt"], data["AddrLoc"]]),
    stateCode: stateCode(data["StateCode"]),
    pincode: text(data["AddrPncd"]),
    // v1.04 only; absent from v1.03 and from the e-Way Bill register.
    registeredOn: text(data["DtReg"]),
    deregisteredOn: text(data["DtDReg"]),
    jurisdiction: null,
  };
}

/** e-Way Bill shape: `/Master/GetGSTINDetails?gstin=…`. */
export function mapEwbGstinDetails(data: Record<string, unknown>, requested: string): GstinDetails {
  return {
    gstin: text(data["gstin"]) ?? requested,
    legalName: text(data["legalName"]),
    tradeName: text(data["tradeName"]),
    status: parseRegistrationStatus(data["status"]),
    statusRaw: text(data["status"]),
    taxpayerType: text(data["txpType"]),
    blockStatus: parseBlockStatus(data["blkStatus"]),
    addressLine1: text(data["address1"]),
    addressLine2: text(data["address2"]),
    street: null,
    location: null,
    floorNumber: null,
    buildingNumber: null,
    buildingName: null,
    stateCode: stateCode(data["stateCode"]),
    pincode: text(data["pinCode"]),
    // The e-Way Bill register does not carry registration dates.
    registeredOn: null,
    deregisteredOn: null,
    jurisdiction: null,
  };
}

/** e-Way Bill shape: `/Master/GetTransporterDetails?trn_no=…`. */
export function mapTransporterDetails(
  data: Record<string, unknown>,
  requested: string,
): TransporterDetails {
  return {
    transin: text(data["transin"]) ?? text(data["gstin"]) ?? requested,
    legalName: text(data["legalName"]),
    tradeName: text(data["tradeName"]),
    addressLine1: text(data["address1"]),
    addressLine2: text(data["address2"]),
    stateCode: stateCode(data["stateCode"]),
    pincode: text(data["pinCode"]),
  };
}

/** Empty strings and whitespace are absent values, not content. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/** The IRP sends StateCode as a number; the e-Way Bill portal as a string. */
function stateCode(value: unknown): string | null {
  const raw = text(value);
  return raw === null ? null : raw.padStart(2, "0");
}

/** Compose a line from the parts the portal supplied, skipping the blanks. */
function joinAddress(parts: unknown[]): string | null {
  const present = parts.map(text).filter((part): part is string => part !== null);
  return present.length ? present.join(", ") : null;
}
