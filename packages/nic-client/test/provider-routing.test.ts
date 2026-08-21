import { describe, expect, it } from "vitest";
import { UnknownProviderError } from "@ewayvo/gst-gateway";
import { createNicRegistry, NIC_PROVIDER_ID } from "../src/registry.js";
import { MemorySessionStore } from "../src/session.js";

/**
 * A connection must reach the provider it names.
 *
 * `gst_credentials.provider` is part of the credential's unique key, but the
 * registry used to resolve on environment alone and always returned the NIC
 * client. A GSP connection would therefore have had its credentials sent to
 * NIC — a system that never issued them.
 *
 * Failing loudly is the point. A default would restore exactly that bug.
 */
describe("provider routing", () => {
  const registry = createNicRegistry({
    publicKeys: { sandbox: undefined, production: undefined },
    timeoutMs: 1000,
    store: new MemorySessionStore(),
  });

  it("routes a NIC connection to the NIC client", () => {
    expect(registry.einvoice(NIC_PROVIDER_ID, "sandbox").id).toBe("irp");
    expect(registry.ewb(NIC_PROVIDER_ID, "sandbox").id).toBe("ewb");
  });

  it("refuses a provider it cannot reach rather than falling back to NIC", () => {
    expect(() => registry.einvoice("some-gsp", "sandbox")).toThrow(UnknownProviderError);
    expect(() => registry.ewb("some-gsp", "production")).toThrow(UnknownProviderError);
  });

  it("names the provider and the fix in the error", () => {
    try {
      registry.einvoice("acme-gsp", "sandbox");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownProviderError);
      const message = (error as Error).message;
      expect(message).toContain("acme-gsp");
      expect(message).toMatch(/reconnect/i);
      // The code is what the API maps to a user-facing message.
      expect((error as UnknownProviderError).code).toBe("PROVIDER_NOT_CONFIGURED");
    }
  });

  it("advertises only what this deployment can actually route to", () => {
    const available = registry.available();
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({
      id: NIC_PROVIDER_ID,
      connectivity: "direct",
    });
    // No GSP is claimed, because none is implemented.
    expect(available.some((p) => p.connectivity === "gsp")).toBe(false);
  });

  it("keeps environments separate for the same provider", () => {
    expect(() => registry.einvoice(NIC_PROVIDER_ID, "production")).not.toThrow();
    expect(() => registry.einvoice(NIC_PROVIDER_ID, "sandbox")).not.toThrow();
  });
});
