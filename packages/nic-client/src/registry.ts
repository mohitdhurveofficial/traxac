import type { EinvoiceProvider, EwbProvider, GatewayRegistry } from "@ewayvo/gst-gateway";
import { UnknownProviderError } from "@ewayvo/gst-gateway";
import { NicEinvoiceProvider } from "./einvoice-provider.js";
import { NicEwbProvider } from "./ewb-provider.js";
import { NicSessionManager, type NicClientOptions } from "./session.js";

/**
 * Builds the provider pair for both environments. Sandbox and production
 * differ only in host and key material, so one manager serves both and the
 * environment travels with each request context.
 */
/** The provider id stored on credentials that talk to NIC directly. */
export const NIC_PROVIDER_ID = "nic";

export function createNicRegistry(options: NicClientOptions): GatewayRegistry {
  const sessions = new NicSessionManager(options);
  const einvoiceProvider = new NicEinvoiceProvider(sessions, options);
  const ewbProvider = new NicEwbProvider(sessions, options);

  /*
   * Only NIC direct is implemented here. A GSP speaks its own protocol with
   * its own credentials, so it belongs in its own registry rather than being
   * approximated by this one.
   *
   * An unrecognised provider throws. Falling back to NIC would take a GSP's
   * credentials and send them to a system that never issued them.
   */
  const assertNic = (provider: string, service: string): void => {
    if (provider !== NIC_PROVIDER_ID) throw new UnknownProviderError(provider, service);
  };

  return {
    einvoice: (provider): EinvoiceProvider => {
      assertNic(provider, "e-Invoice");
      return einvoiceProvider;
    },
    ewb: (provider): EwbProvider => {
      assertNic(provider, "e-Way Bill");
      return ewbProvider;
    },
    available: () => [
      {
        id: NIC_PROVIDER_ID,
        label: "Direct NIC API",
        connectivity: "direct",
        services: ["einvoice", "ewb"],
      },
    ],
  };
}
