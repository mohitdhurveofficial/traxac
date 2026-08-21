import type { GatewayRequestContext, GatewayResult } from "./types.js";
import type { IrnDetails, IrnResult, IrpInvoicePayload } from "./einvoice-types.js";
import type { GstinDetails, TransporterDetails } from "./registry-types.js";
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

  /**
   * Resolve a taxpayer from the IRP master register.
   *
   * Used to fill in a customer or supplier from their GSTIN. Returns only
   * what the portal actually sent — a field the portal omitted stays absent.
   */
  getGstinDetails(ctx: GatewayRequestContext, gstin: string): Promise<GatewayResult<GstinDetails>>;

  /**
   * Force the IRP to re-read a taxpayer from the GST Common Portal.
   *
   * `getGstinDetails` serves the IRP's own copy, which can lag. This is what
   * an explicit user refresh should call, or the refresh just re-reads the
   * same stale answer.
   */
  syncGstinDetails(ctx: GatewayRequestContext, gstin: string): Promise<GatewayResult<GstinDetails>>;

  /**
   * Read the e-Way Bill the IRP holds for an IRN.
   *
   * Lets an invoice that already has an IRN show its e-Way Bill without the
   * user re-entering anything, and lets reconciliation confirm what the
   * portal believes.
   */
  getEwbByIrn(
    ctx: GatewayRequestContext,
    irn: string,
  ): Promise<
    GatewayResult<{
      ewbNumber: string | null;
      ewbDate: Date | null;
      validUntil: Date | null;
      status: string;
    }>
  >;
}

/** e-Way Bill portal capabilities. */
export interface EwbProvider {
  readonly id: "ewb";

  verify(ctx: GatewayRequestContext): Promise<GatewayResult<{ verifiedAt: Date }>>;

  /** Resolve a taxpayer from the e-Way Bill master register. */
  getGstinDetails(ctx: GatewayRequestContext, gstin: string): Promise<GatewayResult<GstinDetails>>;

  /**
   * Resolve an *enrolled* transporter by TRANSIN.
   *
   * A separate register from GSTIN with a separate endpoint. The portal also
   * accepts a registered transporter's GSTIN here, but the response carries
   * no registration status either way, so the result is never treated as
   * proof that a GSTIN is active.
   */
  getTransporterDetails(
    ctx: GatewayRequestContext,
    transin: string,
  ): Promise<GatewayResult<TransporterDetails>>;

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
/**
 * How a GSTIN reaches the government.
 *
 * Not every taxpayer is eligible for direct NIC API access — it requires
 * separate onboarding and IP whitelisting. The rest integrate through an
 * authorised GSP, which speaks its own protocol with its own credentials.
 * The two are not interchangeable, so the connection records which it is.
 */
export type ConnectivityModel =
  /** Onboarded with NIC for direct API access. */
  | "direct"
  /** Routed through an authorised GST Suvidha Provider. */
  | "gsp";

/**
 * Resolves the implementation for a connection.
 *
 * Keyed by **provider as well as environment**. The provider is recorded on
 * every credential and is part of its unique key, so routing on environment
 * alone would send a GSP's credentials to NIC — an authentication failure at
 * best, and at worst a request to the wrong system carrying someone's real
 * credentials.
 *
 * An unknown provider must raise `UnknownProviderError`, never fall back to a
 * default. Silently substituting NIC is precisely the bug this signature
 * exists to prevent.
 */
export interface GatewayRegistry {
  einvoice(provider: string, environment: "sandbox" | "production"): EinvoiceProvider;
  ewb(provider: string, environment: "sandbox" | "production"): EwbProvider;
  /** Providers this deployment can actually route to. */
  available(): ProviderDescriptor[];
}

export interface ProviderDescriptor {
  /** Stored on the credential, e.g. "nic". */
  id: string;
  /** Shown to the customer, e.g. "Direct NIC API". */
  label: string;
  connectivity: ConnectivityModel;
  services: Array<"einvoice" | "ewb">;
}

/** Raised when a credential names a provider this deployment cannot route to. */
export class UnknownProviderError extends Error {
  readonly code = "PROVIDER_NOT_CONFIGURED";
  constructor(provider: string, service: string) {
    super(
      `No ${service} integration is configured for provider "${provider}". ` +
        "The connection names a provider this deployment cannot reach — reconnect " +
        "the GSTIN choosing a provider that is available.",
    );
    this.name = "UnknownProviderError";
  }
}
