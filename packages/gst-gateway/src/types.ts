/**
 * Transport-agnostic gateway contracts. Each government system (IRP for
 * e-Invoice, EWB for e-Way Bill) is a Provider behind this interface so the
 * app talks to NIC direct APIs or any GSP without business-layer changes.
 */

export type GatewayId = "irp" | "ewb";

export interface GatewayRequestContext {
  tenantId: string;
  gstin: string;
  /** Idempotency key for gov API call retries. */
  idempotencyKey: string;
}

export interface GatewayResult<T> {
  ok: boolean;
  data?: T;
  /** Structured error from the government API (error codes are meaningful). */
  error?: GatewayError;
  /** Raw response kept for audit/debugging. */
  raw?: unknown;
}

export interface GatewayError {
  code: string;
  message: string;
  /** True when retrying later could succeed (rate limit, timeout, 5xx). */
  retryable: boolean;
}

export interface EinvoiceProviderSubmitInput {
  invoiceNumber: string;
  invoiceDate: string; // yyyy-mm-dd
  invoiceType: "B2B" | "SEZOP" | "SEZWP" | "DE" | "EXPWP" | "EXPOP";
  sellerGstin: string;
  sellerTradeName: string;
  sellerLegalName: string;
  sellerAddress: string;
  sellerPos: string; // place of supply state code
  buyerGstin: string;
  buyerTradeName: string;
  builderNote?: string;
  payeeName?: string;
  reverseCharge: boolean;
  placeOfSupply: string;
  lines: Array<{
    hsn: string;
    description: string;
    qty: number;
    unit: string;
    rate: number;              // rupees
    taxableValue: number;      // rupees
    gstRate: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
  }>;
  totalTaxableValue: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalCess: number;
  irnCutoffCrossed?: boolean;
}

export interface EinvoiceSubmitResult {
  irn: string;
  ackNumber: number;
  alert?: string;
}
