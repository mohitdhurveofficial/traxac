import type { Database } from "@ewayvo/database";
import { gatewayCalls } from "@ewayvo/database";
import type { GatewayTelemetry } from "@ewayvo/gst-gateway";

/**
 * Persists every outbound government API call. When a portal disputes what was
 * filed, this table is the record. Credentials are stripped before writing —
 * the payload builders never place secrets in the body, and the header block
 * is not recorded at all.
 */
export class DatabaseGatewayTelemetry implements GatewayTelemetry {
  constructor(
    private readonly database: Database,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  async record(entry: Parameters<GatewayTelemetry["record"]>[0]): Promise<void> {
    try {
      await this.database.db.insert(gatewayCalls).values({
        tenantId: entry.tenantId,
        gateway: entry.gateway,
        operation: entry.operation,
        endpoint: entry.endpoint,
        gstin: entry.gstin,
        idempotencyKey: entry.idempotencyKey,
        attempt: entry.attempt,
        requestPayload: entry.requestPayload ?? null,
        responseStatus: entry.responseStatus ?? null,
        responsePayload: entry.responsePayload ?? null,
        errorCode: entry.errorCode ?? null,
        durationMs: entry.durationMs,
      });
    } catch (err) {
      this.onError(err);
    }
  }
}
