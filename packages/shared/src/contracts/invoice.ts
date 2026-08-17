import { z } from "zod";
import {
  addressSnapshotSchema,
  gstRateSchema,
  hsnSchema,
  rupeesSchema,
  stateCodeSchema,
  uqcSchema,
  vehicleNoSchema,
} from "./common.js";
import {
  DOC_TYPES,
  INVOICE_STATUSES,
  EINVOICE_STATUSES,
  EWB_STATUSES,
} from "../constants/status.js";
import { SUPPLY_CATEGORIES } from "../gst/supply.js";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const invoiceLineSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(300),
  description: optionalText(1000),
  hsnSac: hsnSchema,
  isService: z.boolean().default(false),
  quantity: z.coerce.number().positive().max(9_999_999),
  unit: uqcSchema.default("NOS"),
  /** Rupees; converted to paise server-side. */
  unitPrice: rupeesSchema,
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  discountAmount: rupeesSchema.default(0),
  gstRate: gstRateSchema.default(0),
  cessRate: gstRateSchema.default(0),
  cessNonAdvol: rupeesSchema.default(0),
  stateCess: rupeesSchema.default(0),
  batchNo: optionalText(60),
  barcode: optionalText(60),
  expiryDate: z.coerce.date().optional().nullable(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const invoiceChargeSchema = z.object({
  label: z.string().trim().min(1).max(120),
  kind: z.enum(["freight", "insurance", "packing", "loading", "other"]).default("other"),
  hsnSac: hsnSchema.optional().or(z.literal("")),
  amount: rupeesSchema,
  gstRate: gstRateSchema.default(0),
});
export type InvoiceChargeInput = z.infer<typeof invoiceChargeSchema>;

export const transportDetailsSchema = z.object({
  transporterId: z.string().uuid().optional().nullable(),
  /** 1=Road 2=Rail 3=Air 4=Ship */
  transportMode: z.coerce.number().int().min(1).max(4).optional().nullable(),
  distanceKm: z.coerce.number().int().min(0).max(4000).optional().nullable(),
  vehicleNo: vehicleNoSchema.optional().or(z.literal("")),
  vehicleType: z.enum(["R", "O"]).optional().nullable(),
  transportDocNo: optionalText(30),
  transportDocDate: z.coerce.date().optional().nullable(),
  subSupplyType: z.string().trim().max(3).default("1"),
});
export type TransportDetailsInput = z.infer<typeof transportDetailsSchema>;

export const createInvoiceSchema = z
  .object({
    gstinId: z.string().uuid(),
    branchId: z.string().uuid().optional().nullable(),
    docType: z.enum(DOC_TYPES).default("invoice"),
    /**
     * Omit to use the default series for the document type — INV, CRN, DBN.
     * Defaulting this to "INV" put credit notes in the invoice series.
     */
    series: z.string().trim().max(20).optional(),
    /** Omit to auto-assign from the tenant's number series. */
    invoiceNumber: optionalText(40),
    invoiceDate: z.coerce.date(),
    dueDate: z.coerce.date().optional().nullable(),

    buyerPartyId: z.string().uuid().optional().nullable(),
    /** Overrides the party's stored address for this document only. */
    billTo: addressSnapshotSchema.optional(),
    shipToAddressId: z.string().uuid().optional().nullable(),
    shipTo: addressSnapshotSchema.optional().nullable(),
    dispatchFromBranchId: z.string().uuid().optional().nullable(),
    dispatchFrom: addressSnapshotSchema.optional().nullable(),

    supplyCategory: z.enum(SUPPLY_CATEGORIES).default("b2b"),
    placeOfSupply: stateCodeSchema,
    reverseCharge: z.boolean().default(false),
    igstOnIntra: z.boolean().default(false),
    currency: z.string().trim().length(3).default("INR"),
    exchangeRate: z.coerce.number().positive().default(1),
    exportInfo: z
      .object({
        shippingBillNo: optionalText(20),
        shippingBillDate: z.coerce.date().optional().nullable(),
        portCode: optionalText(10),
        countryCode: z.string().trim().length(2).optional().or(z.literal("")),
        refundClaim: z.boolean().default(false),
      })
      .optional()
      .nullable(),

    lines: z.array(invoiceLineSchema).min(1, "Add at least one item"),
    charges: z.array(invoiceChargeSchema).default([]),

    transport: transportDetailsSchema.optional(),
    ewbRequired: z.boolean().optional(),

    referenceInvoiceId: z.string().uuid().optional().nullable(),
    reason: optionalText(200),
    poNumber: optionalText(40),
    poDate: z.coerce.date().optional().nullable(),
    notes: optionalText(2000),
    terms: optionalText(2000),
  })
  .superRefine((value, ctx) => {
    if (!value.buyerPartyId && !value.billTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buyerPartyId"],
        message: "Choose a customer or enter Bill To details",
      });
    }
    if (
      (value.docType === "credit_note" || value.docType === "debit_note") &&
      !value.referenceInvoiceId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceInvoiceId"],
        message: "A credit/debit note must reference the original invoice",
      });
    }
  });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Update accepts the same body; only drafts may be updated. */
export const updateInvoiceSchema = createInvoiceSchema;

export const finalizeInvoiceSchema = z.object({
  /** Submit to the IRP immediately after finalizing. */
  generateEinvoice: z.boolean().optional(),
  /** Generate the e-Way Bill (needs transport details). */
  generateEwb: z.boolean().optional(),
});

export const cancelInvoiceSchema = z.object({
  reasonCode: z.enum(["1", "2", "3", "4"]).default("2"),
  remark: z.string().trim().min(3).max(100),
});
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;

export const recordPaymentSchema = z.object({
  amount: rupeesSchema,
  paidAt: z.coerce.date().optional(),
  method: z.enum(["cash", "upi", "neft", "rtgs", "cheque", "card", "other"]).default("other"),
  reference: optionalText(80),
  notes: optionalText(500),
});

export const invoiceListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  einvoiceStatus: z.enum(EINVOICE_STATUSES).optional(),
  ewbStatus: z.enum(EWB_STATUSES).optional(),
  docType: z.enum(DOC_TYPES).optional(),
  gstinId: z.string().uuid().optional(),
  buyerPartyId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  irn: z.string().trim().optional(),
  ewbNumber: z.string().trim().optional(),
  vehicleNo: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  page: z.coerce.number().int().min(1).default(1),
  sort: z.enum(["invoiceDate", "grandTotal", "createdAt", "invoiceNumber"]).default("invoiceDate"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/** Live preview: same body as create, but nothing is persisted. */
export const previewInvoiceSchema = z.object({
  gstinId: z.string().uuid().optional(),
  supplierStateCode: stateCodeSchema.optional(),
  placeOfSupply: stateCodeSchema,
  supplyCategory: z.enum(SUPPLY_CATEGORIES).default("b2b"),
  igstOnIntra: z.boolean().default(false),
  lines: z.array(invoiceLineSchema).min(1),
  charges: z.array(invoiceChargeSchema).default([]),
});
export type PreviewInvoiceInput = z.infer<typeof previewInvoiceSchema>;
