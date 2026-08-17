import type { EinvoiceProvider, EwbProvider, GatewayRegistry } from "@traxac/gst-gateway";
import { NicEinvoiceProvider } from "./einvoice-provider.js";
import { NicEwbProvider } from "./ewb-provider.js";
import { NicSessionManager, type NicClientOptions } from "./session.js";

/**
 * Builds the provider pair for both environments. Sandbox and production
 * differ only in host and key material, so one manager serves both and the
 * environment travels with each request context.
 */
export function createNicRegistry(options: NicClientOptions): GatewayRegistry {
  const sessions = new NicSessionManager(options);
  const einvoiceProvider = new NicEinvoiceProvider(sessions, options);
  const ewbProvider = new NicEwbProvider(sessions, options);
  return {
    einvoice: (): EinvoiceProvider => einvoiceProvider,
    ewb: (): EwbProvider => ewbProvider,
  };
}
