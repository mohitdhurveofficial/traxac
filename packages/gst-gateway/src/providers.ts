import type { GatewayRequestContext, GatewayResult } from "./types.js";
import type { IrnDetails, IrnResult, IrpInvoicePayload } from "./einvoice-types.js";
import type {
  EwbCancelPayload,
  EwbDetails,
  EwbExtendPayload,
  EwbGeneratePayload,
  EwbGenerateResult,
  EwbPartBPayload,
  EwbUpdateTransporterPayload,
} from "./ewb-types.js";

/** e-Invoice Registration Portal capabilities the application depends on. */
export interface EinvoiceProvider {
  readonly id: "irp";

  /** Verify credentials without side effects — used by the settings screen. */
  verify(ctx: GatewayRequestContext): Promise<GatewayResult<{ verifiedAt: Date }>>;

  generateIrn(
    ctx: GatewayRequestContext,
    payload: IrpInvoicePayload,
  ): Promise<GatewayResult<IrnResult>>;

  /** Cancel within 24 hours of the acknowledgement. */
  cancelIrn(
    ctx: GatewayRequestContext,
    input: { irn: string; reasonCode: string; remark: string },
  ): Promise<GatewayResult<{ irn: string; cancelDate: Date }>>;

  /** Reconciliation: read back what the portal holds for an IRN. */
  getIrn(ctx: GatewayRequestContext, irn: string): Promise<GatewayResult<IrnDetails>>;

  /** Look up an IRN by document number — how a duplicate is recovered. */
  getIrnByDocument(
    ctx: GatewayRequestContext,
    input: { docType: string; docNo: string; docDate: string },
  ): Promise<GatewayResult<IrnDetails>>;
}

/** e-Way Bill portal capabilities. */
export interface EwbProvider {
  readonly id: "ewb";

  verify(ctx: GatewayRequestContext): Promise<GatewayResult<{ verifiedAt: Date }>>;

  generate(
    ctx: GatewayRequestContext,
    payload: EwbGeneratePayload,
  ): Promise<GatewayResult<EwbGenerateResult>>;

  /** Add or change vehicle details (Part-B). */
  updatePartB(
    ctx: GatewayRequestContext,
    payload: EwbPartBPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; validUntil: Date; vehicleNo?: string }>>;

  /** Hand the consignment to a different transporter. */
  updateTransporter(
    ctx: GatewayRequestContext,
    payload: EwbUpdateTransporterPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; transporterId: string }>>;

  /** Extend validity inside the +/- 8 hour window around expiry. */
  extend(
    ctx: GatewayRequestContext,
    payload: EwbExtendPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; validUntil: Date }>>;

  /** Cancel within 24 hours, provided the bill has not been verified in transit. */
  cancel(
    ctx: GatewayRequestContext,
    payload: EwbCancelPayload,
  ): Promise<GatewayResult<{ ewbNumber: string; cancelledAt: Date }>>;

  getEwb(ctx: GatewayRequestContext, ewbNumber: string): Promise<GatewayResult<EwbDetails>>;
}

/** Resolves the provider pair to use for a given environment. */
export interface GatewayRegistry {
  einvoice(environment: "sandbox" | "production"): EinvoiceProvider;
  ewb(environment: "sandbox" | "production"): EwbProvider;
}
