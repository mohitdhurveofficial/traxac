import type { GatewayRequestContext, GatewayResult } from "./types.js";
import type {
  EwbPartAInput, EwbPartBInput, EwbGenerateResult,
} from "./ewb-types.js";

/** e-Way Bill provider capabilities used by the app. */
export interface EwbProvider {
  readonly id: "ewb";

  authenticate(ctx: GatewayRequestContext): Promise<GatewayResult<{ token: string }>>;

  /** Generate EWB (with Part-B) or Part-A only. */
  generate(
    ctx: GatewayRequestContext,
    partA: EwbPartAInput,
    partB?: EwbPartBInput,
  ): Promise<GatewayResult<EwbGenerateResult>>;

  /** Update transporter details (Part-B update / change transporter). */
  updateTransporter(
    ctx: GatewayRequestContext,
    ewbNumber: string,
    partB: EwbPartBInput,
  ): Promise<GatewayResult<{ updated: true }>>;

  /** Extend validity by consignee (before/within 8h after expiry). */
  extend(
    ctx: GatewayRequestContext,
    ewbNumber: string,
    partB: EwbPartBInput,
    remainingDistance: number,
  ): Promise<GatewayResult<{ validUntil: string }>>;

  /** Cancel within 24h of generation (reason 2=Data entry mistake, 3=Order cancelled). */
  cancel(
    ctx: GatewayRequestContext,
    ewbNumber: string,
    reason: 2 | 3,
    remark: string,
  ): Promise<GatewayResult<{ cancelled: true }>>;

  getEwbDetails(
    ctx: GatewayRequestContext,
    ewbNumber: string,
  ): Promise<GatewayResult<unknown>>;
}
