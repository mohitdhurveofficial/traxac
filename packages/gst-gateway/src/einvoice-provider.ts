import type {
  GatewayRequestContext, GatewayResult,
} from "./types.js";
import type {
  EinvoiceProviderSubmitInput, EinvoiceSubmitResult,
} from "./types.js";

/** e-Invoice (IRP) provider capabilities used by the app. */
export interface EinvoiceProvider {
  readonly id: "irp";

  /** Authenticate and return an opaque session handle (token cached per GSP). */
  authenticate(ctx: GatewayRequestContext): Promise<GatewayResult<{ token: string; expiresAt: string }>>;

  /** Generate IRN (Gerete/GenIRN). Idempotent per invoice. */
  generateIrn(
    ctx: GatewayRequestContext,
    input: EinvoiceProviderSubmitInput,
  ): Promise<GatewayResult<EinvoiceSubmitResult>>;

  /** Cancel IRN within 24h window: reason 1=Mistake, 2=Order cancelled, 3=Duplicate. */
  cancelIrn(
    ctx: GatewayRequestContext,
    irn: string,
    reason: 1 | 2 | 3,
    remark: string,
  ): Promise<GatewayResult<{ cancelled: true }>>;

  /** Fetch IRN details by number (for reconciliation). */
  getIrnDetails(
    ctx: GatewayRequestContext,
    irn: string,
  ): Promise<GatewayResult<unknown>>;
}
