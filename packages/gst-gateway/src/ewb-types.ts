/**
 * e-Way Bill API payloads (NIC EWB API v1.03). Field names mirror the portal.
 */

export interface EwbItem {
  productName?: string | null;
  productDesc?: string | null;
  hsnCode: number;
  quantity: number;
  qtyUnit: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
  cessNonAdvol: number;
  taxableAmount: number;
}

export interface EwbGeneratePayload {
  /** O = Outward, I = Inward */
  supplyType: "O" | "I";
  /** 1=Supply 2=Import 3=Export 4=Job Work ... */
  subSupplyType: string;
  subSupplyDesc?: string;
  /** INV | CHL | BIL | BOE | CNT | OTH */
  docType: string;
  docNo: string;
  /** dd/mm/yyyy */
  docDate: string;

  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2?: string;
  fromPlace: string;
  fromPincode: number;
  /** State of the supplier's registration. */
  actFromStateCode: number;
  /** State goods actually move from (differs for Dispatch From). */
  fromStateCode: number;

  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2?: string;
  toPlace: string;
  toPincode: number;
  /** State of the buyer's registration. */
  actToStateCode: number;
  /** State goods actually move to (differs for Ship To). */
  toStateCode: number;

  transactionType: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  cessNonAdvolValue: number;
  otherValue: number;
  totInvValue: number;

  transporterId?: string;
  transporterName?: string;
  transDocNo?: string;
  transDocDate?: string;
  transMode?: string;
  transDistance: string;
  vehicleNo?: string;
  vehicleType?: string;

  itemList: EwbItem[];
  mainHsnCode?: number;
}

export interface EwbGenerateResult {
  ewbNumber: string;
  generatedAt: Date;
  validUntil: Date;
  alert?: string | null;
}

export interface EwbPartBPayload {
  ewbNo: number;
  vehicleNo?: string;
  fromPlace: string;
  fromState: number;
  /** 1=Due to Break Down 2=Due to Transhipment 3=Others 4=First Time */
  reasonCode: string;
  reasonRem: string;
  transDocNo?: string;
  transDocDate?: string;
  transMode: string;
  vehicleType?: string;
}

export interface EwbExtendPayload {
  ewbNo: number;
  vehicleNo?: string;
  fromPlace: string;
  fromState: number;
  remainingDistance: string;
  transDocNo?: string;
  transDocDate?: string;
  transMode: string;
  /** 1=Natural Calamity 2=Law and Order 4=Transhipment 5=Accident 99=Others */
  extnRsnCode: string;
  extnRemarks: string;
  /** 1=In Transit, 2=In Movement */
  consignmentStatus: string;
  /** Required when consignmentStatus is In Transit. */
  transitType?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
}

export interface EwbCancelPayload {
  ewbNo: number;
  /** 1=Duplicate 2=Order Cancelled 3=Data Entry mistake 4=Others */
  cancelRsnCode: number;
  cancelRmrk: string;
}

export interface EwbUpdateTransporterPayload {
  ewbNo: number;
  transporterId: string;
}

export interface EwbDetails {
  ewbNumber: string;
  status: string;
  generatedAt?: Date;
  validUntil?: Date;
  vehicleNo?: string | null;
  transporterId?: string | null;
  cancelledAt?: Date | null;
}
