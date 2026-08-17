/**
 * e-Invoice schema INV-01 as accepted by the IRP.
 *
 * Field names are the portal's own (`SupTyp`, `SellerDtls`, …) rather than
 * friendlier ones, because a rename here is a rejected invoice there. The
 * builder that produces these objects lives alongside so the mapping from the
 * Traxac domain model is in exactly one place.
 */

export interface IrpTransactionDetails {
  TaxSch: "GST";
  /** B2B | SEZWP | SEZWOP | EXPWP | EXPWOP | DEXP */
  SupTyp: string;
  /** Y when tax is payable by the recipient under reverse charge. */
  RegRev?: "Y" | "N";
  /** Y for e-commerce operator transactions. */
  EcmGstin?: string | null;
  /** Y when IGST applies despite an intra-state place of supply. */
  IgstOnIntra?: "Y" | "N";
}

export interface IrpDocumentDetails {
  /** INV | CRN | DBN */
  Typ: string;
  No: string;
  /** dd/mm/yyyy */
  Dt: string;
}

export interface IrpParty {
  Gstin: string;
  LglNm: string;
  TrdNm?: string | null;
  Addr1: string;
  Addr2?: string | null;
  Loc: string;
  Pin: number;
  Stcd: string;
  Ph?: string | null;
  Em?: string | null;
}

/** Ship-To uses the same shape but permits a URP/blank GSTIN. */
export interface IrpShipDetails extends Omit<IrpParty, "Gstin"> {
  Gstin?: string | null;
}

export interface IrpDispatchDetails {
  Nm: string;
  Addr1: string;
  Addr2?: string | null;
  Loc: string;
  Pin: number;
  Stcd: string;
}

export interface IrpItem {
  SlNo: string;
  PrdDesc: string;
  /** Y when the line is a service. */
  IsServc: "Y" | "N";
  HsnCd: string;
  Barcde?: string | null;
  Qty?: number;
  FreeQty?: number;
  Unit?: string | null;
  UnitPrice: number;
  TotAmt: number;
  Discount?: number;
  PreTaxVal?: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt?: number;
  CgstAmt?: number;
  SgstAmt?: number;
  CesRt?: number;
  CesAmt?: number;
  CesNonAdvlAmt?: number;
  StateCesRt?: number;
  StateCesAmt?: number;
  StateCesNonAdvlAmt?: number;
  OthChrg?: number;
  TotItemVal: number;
  OrdLineRef?: string | null;
  BchDtls?: { Nm: string; ExpDt?: string | null; WrDt?: string | null } | null;
}

export interface IrpValueDetails {
  AssVal: number;
  CgstVal?: number;
  SgstVal?: number;
  IgstVal?: number;
  CesVal?: number;
  StCesVal?: number;
  Discount?: number;
  OthChrg?: number;
  RndOffAmt?: number;
  TotInvVal: number;
  TotInvValFc?: number;
}

export interface IrpEwbDetails {
  TransId?: string | null;
  TransName?: string | null;
  Distance: number;
  TransDocNo?: string | null;
  TransDocDt?: string | null;
  VehNo?: string | null;
  VehType?: "R" | "O" | null;
  /** 1=Road 2=Rail 3=Air 4=Ship */
  TransMode?: string | null;
}

export interface IrpExportDetails {
  ShipBNo?: string | null;
  ShipBDt?: string | null;
  Port?: string | null;
  RefClm?: "Y" | "N";
  ForCur?: string | null;
  CntCode?: string | null;
}

export interface IrpInvoicePayload {
  Version: string;
  TranDtls: IrpTransactionDetails;
  DocDtls: IrpDocumentDetails;
  SellerDtls: IrpParty;
  BuyerDtls: IrpParty & { Pos: string };
  DispDtls?: IrpDispatchDetails | null;
  ShipDtls?: IrpShipDetails | null;
  ItemList: IrpItem[];
  ValDtls: IrpValueDetails;
  RefDtls?: {
    InvRm?: string | null;
    DocPerdDtls?: { InvStDt: string; InvEndDt: string } | null;
    PrecDocDtls?: Array<{ InvNo: string; InvDt: string; OthRefNo?: string | null }> | null;
  } | null;
  ExpDtls?: IrpExportDetails | null;
  EwbDtls?: IrpEwbDetails | null;
  /**
   * Optional groups in the NIC schema that the invoice model does not collect
   * today. Declared so the payload shape is complete and a caller that does
   * have the data can pass it without a type change; omitted otherwise rather
   * than sent empty.
   *
   * @see https://einv-apisandbox.nic.in/version1.03/generate-irn.html
   */
  PayDtls?: IrpPaymentDetails | null;
  AddlDocDtls?: IrpAdditionalDocument[] | null;
}

/** Payment terms and banking details — optional per the NIC schema. */
export interface IrpPaymentDetails {
  Nm?: string | null;
  AccDet?: string | null;
  Mode?: string | null;
  FinInsBr?: string | null;
  PayTerm?: string | null;
  PayInstr?: string | null;
  CrTrn?: string | null;
  DirDr?: string | null;
  CrDay?: number | null;
  PaidAmt?: number | null;
  PaymtDue?: number | null;
}

/** Supporting documents attached to the e-Invoice — optional per the schema. */
export interface IrpAdditionalDocument {
  Url?: string | null;
  Docs?: string | null;
  Info?: string | null;
}

/** Successful IRN generation, normalised from the portal response. */
export interface IrnResult {
  irn: string;
  ackNumber: string;
  /** Portal acknowledgement timestamp, already parsed to a real Date. */
  ackDate: Date;
  /** Signed invoice JWS. */
  signedInvoice: string;
  /** Signed QR JWS — this is what gets printed as the QR code. */
  signedQrCode: string;
  /** Present when the IRP generated the e-Way Bill in the same call. */
  ewbNumber?: string | null;
  ewbDate?: Date | null;
  ewbValidUntil?: Date | null;
  status: string;
  alert?: string | null;
  /**
   * Whether the portal's JWS signatures were checked, and the outcome.
   * "unverified" means no signing certificate is configured — it is never a
   * claim that the signature was validated.
   */
  signedInvoiceSignature?: string;
  signedQrSignature?: string;
}

export interface IrnDetails {
  irn: string;
  ackNumber?: string;
  ackDate?: Date;
  status: string;
  signedInvoice?: string;
  signedQrCode?: string;
  ewbNumber?: string | null;
  ewbDate?: Date | null;
  ewbValidUntil?: Date | null;
  cancelDate?: Date | null;
  remarks?: string | null;
  signedInvoiceSignature?: string;
  signedQrSignature?: string;
}
