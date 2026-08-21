import type {
  AddressSnapshot,
  Einvoice,
  Invoice,
  InvoiceCharge,
  InvoiceLine,
} from "@ewayvo/database";
import {
  IRP_DOC_TYPE,
  IRP_SUPPLY_TYPE,
  EWB_DOC_TYPE,
  rupeeNumber,
  toNicDate,
  type DocType,
  type SupplyCategory,
} from "@ewayvo/shared";
import type { EwbGeneratePayload, EwbItem, IrpInvoicePayload, IrpItem } from "@ewayvo/gst-gateway";

/**
 * Maps the Ewayvo domain model onto the government payload schemas.
 *
 * This is the only place where portal field names appear alongside our own, so
 * a schema change from NIC is a single-file edit. Amounts are converted from
 * integer paise to the 2-decimal rupee numbers both APIs expect.
 */

export interface InvoiceBundle {
  invoice: Invoice;
  lines: InvoiceLine[];
  charges: InvoiceCharge[];
}

const URP = "URP";

function pin(value: string): number {
  const digits = value.replace(/\D/g, "");
  // Exports use 999999, which is the portal's placeholder for a foreign PIN.
  return digits.length === 6 ? Number(digits) : 999_999;
}

function stateNumber(stateCode: string): number {
  return Number.parseInt(stateCode, 10);
}

function truncate(value: string | null | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

/* ----------------------------- e-Invoice ------------------------------- */

export function buildIrpPayload(bundle: InvoiceBundle): IrpInvoicePayload {
  const { invoice, lines, charges } = bundle;
  const billFrom = invoice.billFrom;
  const billTo = invoice.billTo;

  // Invoice-level charges ride on the first line's OthChrg, which is how the
  // IRP models freight and similar amounts within the value block.
  const otherCharges = charges.reduce((sum, c) => sum + c.amount + c.taxAmount, 0);

  const items: IrpItem[] = lines.map((line, index) => ({
    SlNo: String(index + 1),
    PrdDesc: truncate(line.description || line.name, 300),
    IsServc: line.isService ? "Y" : "N",
    HsnCd: line.hsnSac,
    Barcde: line.barcode || null,
    Qty: Number(line.quantity),
    Unit: line.isService ? null : line.unit,
    UnitPrice: rupeeNumber(line.unitPrice),
    TotAmt: rupeeNumber(line.grossValue),
    Discount: rupeeNumber(line.discountAmount),
    AssAmt: rupeeNumber(line.taxableValue),
    GstRt: Number(line.gstRate),
    IgstAmt: rupeeNumber(line.igst),
    CgstAmt: rupeeNumber(line.cgst),
    SgstAmt: rupeeNumber(line.sgst),
    CesRt: Number(line.cessRate),
    CesAmt: rupeeNumber(line.cess),
    CesNonAdvlAmt: rupeeNumber(line.cessNonAdvol),
    StateCesAmt: rupeeNumber(line.stateCess),
    TotItemVal: rupeeNumber(line.lineTotal),
    BchDtls: line.batchNo
      ? { Nm: line.batchNo, ExpDt: line.expiryDate ? toNicDate(line.expiryDate) : null }
      : null,
  }));

  const payload: IrpInvoicePayload = {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: IRP_SUPPLY_TYPE[invoice.supplyCategory as SupplyCategory] ?? "B2B",
      RegRev: invoice.reverseCharge ? "Y" : "N",
      IgstOnIntra: invoice.igstOnIntra ? "Y" : "N",
    },
    DocDtls: {
      Typ: IRP_DOC_TYPE[invoice.docType as DocType] ?? "INV",
      No: invoice.invoiceNumber,
      Dt: toNicDate(invoice.invoiceDate),
    },
    SellerDtls: partyBlock(billFrom),
    BuyerDtls: { ...partyBlock(billTo), Pos: invoice.placeOfSupply },
    DispDtls: invoice.dispatchFrom
      ? {
          Nm: truncate(invoice.dispatchFrom.name, 100),
          Addr1: truncate(invoice.dispatchFrom.addressLine1, 100),
          Addr2: invoice.dispatchFrom.addressLine2
            ? truncate(invoice.dispatchFrom.addressLine2, 100)
            : null,
          Loc: truncate(invoice.dispatchFrom.city, 50),
          Pin: pin(invoice.dispatchFrom.pincode),
          Stcd: invoice.dispatchFrom.stateCode,
        }
      : null,
    ShipDtls: invoice.shipTo
      ? {
          Gstin: invoice.shipTo.gstin && invoice.shipTo.gstin !== URP ? invoice.shipTo.gstin : null,
          LglNm: truncate(invoice.shipTo.legalName || invoice.shipTo.name, 100),
          TrdNm: truncate(invoice.shipTo.name, 100),
          Addr1: truncate(invoice.shipTo.addressLine1, 100),
          Addr2: invoice.shipTo.addressLine2 ? truncate(invoice.shipTo.addressLine2, 100) : null,
          Loc: truncate(invoice.shipTo.city, 50),
          Pin: pin(invoice.shipTo.pincode),
          Stcd: invoice.shipTo.stateCode,
        }
      : null,
    ItemList: items,
    ValDtls: {
      AssVal: rupeeNumber(invoice.taxableValue),
      CgstVal: rupeeNumber(invoice.cgst),
      SgstVal: rupeeNumber(invoice.sgst),
      IgstVal: rupeeNumber(invoice.igst),
      CesVal: rupeeNumber(invoice.cess + invoice.cessNonAdvol),
      StCesVal: rupeeNumber(invoice.stateCess),
      Discount: rupeeNumber(invoice.totalDiscount),
      OthChrg: rupeeNumber(otherCharges),
      RndOffAmt: rupeeNumber(invoice.roundOff),
      TotInvVal: rupeeNumber(invoice.grandTotal),
    },
    RefDtls:
      invoice.notes || invoice.referenceInvoiceNumber
        ? {
            InvRm: invoice.notes ? truncate(invoice.notes, 100) : null,
            PrecDocDtls:
              invoice.referenceInvoiceNumber && invoice.referenceInvoiceDate
                ? [
                    {
                      InvNo: invoice.referenceInvoiceNumber,
                      InvDt: toNicDate(invoice.referenceInvoiceDate),
                    },
                  ]
                : null,
          }
        : null,
    ExpDtls: invoice.isExport
      ? {
          ShipBNo: invoice.exportInfo?.shippingBillNo ?? null,
          ShipBDt: invoice.exportInfo?.shippingBillDate
            ? toNicDate(new Date(invoice.exportInfo.shippingBillDate))
            : null,
          Port: invoice.exportInfo?.portCode ?? null,
          RefClm: invoice.exportInfo?.refundClaim ? "Y" : "N",
          ForCur: invoice.currency !== "INR" ? invoice.currency : null,
          CntCode: invoice.exportInfo?.countryCode ?? null,
        }
      : null,
    EwbDtls: null,
  };

  return payload;
}

/** Attach Part-A/Part-B so the IRP issues the e-Way Bill with the IRN. */
export function withEwbDetails(
  payload: IrpInvoicePayload,
  input: {
    transporterId?: string | null;
    transporterName?: string | null;
    distanceKm: number;
    transportDocNo?: string | null;
    transportDocDate?: Date | null;
    vehicleNo?: string | null;
    vehicleType?: string | null;
    transportMode?: number | null;
  },
): IrpInvoicePayload {
  return {
    ...payload,
    EwbDtls: {
      TransId: input.transporterId ?? null,
      TransName: input.transporterName ?? null,
      Distance: input.distanceKm,
      TransDocNo: input.transportDocNo ?? null,
      TransDocDt: input.transportDocDate ? toNicDate(input.transportDocDate) : null,
      VehNo: input.vehicleNo ?? null,
      VehType: (input.vehicleType as "R" | "O" | null) ?? null,
      TransMode: input.transportMode ? String(input.transportMode) : null,
    },
  };
}

function partyBlock(address: AddressSnapshot) {
  return {
    Gstin: address.gstin || URP,
    LglNm: truncate(address.legalName || address.name, 100),
    TrdNm: truncate(address.name, 100),
    Addr1: truncate(address.addressLine1, 100),
    Addr2: address.addressLine2 ? truncate(address.addressLine2, 100) : null,
    Loc: truncate(address.city, 50),
    Pin: pin(address.pincode),
    Stcd: address.stateCode,
    Ph: address.phone ? truncate(address.phone.replace(/\D/g, ""), 12) : null,
    Em: address.email ? truncate(address.email, 100) : null,
  };
}

/* ----------------------------- e-Way Bill ------------------------------ */

export interface EwbBuildInput extends InvoiceBundle {
  transporterId?: string | null;
  transporterName?: string | null;
  distanceKm: number;
}

export function buildEwbPayload(input: EwbBuildInput): EwbGeneratePayload {
  const { invoice, lines, charges } = input;
  const billFrom = invoice.billFrom;
  const billTo = invoice.billTo;
  // Goods physically move from Dispatch From (if set) and to Ship To (if set);
  // the registration states stay those of the invoice parties.
  const dispatch = invoice.dispatchFrom ?? billFrom;
  const ship = invoice.shipTo ?? billTo;

  const items: EwbItem[] = lines.map((line) => ({
    productName: truncate(line.name, 100),
    productDesc: truncate(line.description || line.name, 100),
    hsnCode: Number(line.hsnSac),
    quantity: Number(line.quantity),
    qtyUnit: line.unit,
    cgstRate: line.cgst > 0 ? Number(line.gstRate) / 2 : 0,
    sgstRate: line.sgst > 0 ? Number(line.gstRate) / 2 : 0,
    igstRate: line.igst > 0 ? Number(line.gstRate) : 0,
    cessRate: Number(line.cessRate),
    cessNonAdvol: rupeeNumber(line.cessNonAdvol),
    taxableAmount: rupeeNumber(line.taxableValue),
  }));

  const otherValue = charges.reduce((sum, c) => sum + c.amount, 0);

  return {
    supplyType: "O",
    subSupplyType: invoice.subSupplyType,
    docType: EWB_DOC_TYPE[invoice.docType as DocType] ?? "INV",
    docNo: invoice.invoiceNumber,
    docDate: toNicDate(invoice.invoiceDate),

    fromGstin: billFrom.gstin || URP,
    fromTrdName: truncate(billFrom.name, 100),
    fromAddr1: truncate(dispatch.addressLine1, 120),
    fromAddr2: truncate(dispatch.addressLine2, 120) || undefined,
    fromPlace: truncate(dispatch.city, 50),
    fromPincode: pin(dispatch.pincode),
    actFromStateCode: stateNumber(billFrom.stateCode),
    fromStateCode: stateNumber(dispatch.stateCode),

    toGstin: billTo.gstin || URP,
    toTrdName: truncate(billTo.name, 100),
    toAddr1: truncate(ship.addressLine1, 120),
    toAddr2: truncate(ship.addressLine2, 120) || undefined,
    toPlace: truncate(ship.city, 50),
    toPincode: pin(ship.pincode),
    actToStateCode: stateNumber(billTo.stateCode || invoice.placeOfSupply),
    toStateCode: stateNumber(ship.stateCode),

    transactionType: invoice.ewbTransactionType,
    totalValue: rupeeNumber(invoice.taxableValue),
    cgstValue: rupeeNumber(invoice.cgst),
    sgstValue: rupeeNumber(invoice.sgst),
    igstValue: rupeeNumber(invoice.igst),
    cessValue: rupeeNumber(invoice.cess),
    cessNonAdvolValue: rupeeNumber(invoice.cessNonAdvol),
    otherValue: rupeeNumber(otherValue),
    totInvValue: rupeeNumber(invoice.grandTotal),

    transporterId: input.transporterId ?? undefined,
    transporterName: input.transporterName ?? undefined,
    transDocNo: invoice.transportDocNo ?? undefined,
    transDocDate: invoice.transportDocDate ? toNicDate(invoice.transportDocDate) : undefined,
    transMode: invoice.transportMode ? String(invoice.transportMode) : undefined,
    transDistance: String(input.distanceKm),
    vehicleNo: invoice.vehicleNo ?? undefined,
    vehicleType: invoice.vehicleType ?? undefined,

    itemList: items,
    mainHsnCode: lines[0] ? Number(lines[0].hsnSac) : undefined,
  };
}

/** The QR payload printed on the invoice comes from the IRP, never from us. */
export function qrPayload(einvoice: Einvoice): string | null {
  return einvoice.signedQrCode || null;
}
