import type { GatewayRequestContext, GatewayResult } from "./types.js";

/** Parties + goods for EWB Part-A (from/to + item summary). */
export interface EwbPartAInput {
  supplyType: "I" | "O";
  subType: string;
  docType: "INV" | "CHL" | "BOP" | "BOE" | "CRN" | "OTH";
  docNumber: string;
  docDate: string; // dd/mm/yyyy
  /** 1=regular, 2=Bill To/Ship To, 3=Bill From/Dispatch From. */
  transactionType: 1 | 2 | 3;
  from: EwbPartyInput;
  to: EwbPartyInput;
  items: EwbItemInput[];
  totalInvoiceValue: number;
  mainHsnCode: string;
}

export interface EwbPartyInput {
  gstin: string;
  tradeName: string;
  address1: string;
  address2?: string;
  place: string;
  pincode: string;
  stateCode: string;
}

export interface EwbItemInput {
  hsn: string;
  qty: number;
  taxableValue: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

/** EWB Part-B (transport details). */
export interface EwbPartBInput {
  vehicleNo?: string;
  transporterId?: string;
  transporterName?: string;
  transporterDocNo?: string;  // LR/RR/Airway Bill
  transporterDocDate?: string;
  vehicleType?: "R" | "O";
  distanceKm?: number;
  mode: 1 | 2 | 3 | 4; // Road/Rail/Air/Ship
}

export interface EwbGenerateResult {
  ewbNumber: string;
  validUntil: string;
  alert?: string;
}
