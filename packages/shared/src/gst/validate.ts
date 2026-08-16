import { isValidStateCode } from "./states.js";

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
/** NIC accepts AB12AB1234, AB12A1234, AB121234 and defence/temporary formats. */
const VEHICLE_REGEX = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;
const HSN_REGEX = /^[0-9]{4}(?:[0-9]{2})?(?:[0-9]{2})?$/;

export function isValidPan(pan: string): boolean {
  return PAN_REGEX.test(pan.trim().toUpperCase());
}

export function isValidPincode(pincode: string): boolean {
  return PINCODE_REGEX.test(pincode.trim());
}

/** Vehicle numbers are compared without spaces/hyphens, as the EWB API expects. */
export function normaliseVehicleNo(vehicleNo: string): string {
  return vehicleNo.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidVehicleNo(vehicleNo: string): boolean {
  return VEHICLE_REGEX.test(normaliseVehicleNo(vehicleNo));
}

/** HSN must be 4, 6 or 8 digits; SAC is 6 digits starting with 99. */
export function isValidHsn(code: string): boolean {
  return HSN_REGEX.test(code.trim());
}

export function isSacCode(code: string): boolean {
  return code.trim().startsWith("99") && code.trim().length === 6;
}

/**
 * Transporter ID is either a GSTIN or a 15-character TRANSIN issued to
 * unregistered transporters (state code + PAN-like body + check digit).
 */
export function isValidTransporterId(id: string): boolean {
  const t = id.trim().toUpperCase();
  return t.length === 15 && isValidStateCode(t.slice(0, 2));
}

export function isValidIrn(irn: string): boolean {
  return /^[a-f0-9]{64}$/i.test(irn.trim());
}

export function isValidEwbNumber(ewb: string): boolean {
  return /^[0-9]{12}$/.test(ewb.trim());
}
