import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { gstinRegistry } from "@ewayvo/database";
import type {
  EinvoiceProvider,
  EwbProvider,
  GatewayRegistry,
  GatewayRequestContext,
  GatewayResult,
  GstinDetails,
  TransporterDetails,
} from "@ewayvo/gst-gateway";
import { gatewayFail, gatewayOk } from "@ewayvo/gst-gateway";
import { REGISTRY_STALE_AFTER_MS, type Container } from "../src/index.js";
import { createBusiness, resetDatabase, testContainer, type TestBusiness } from "./helpers.js";

/**
 * GSTIN and TRANSIN auto-fill.
 *
 * The provider is a test double — the real one is only exercised against a
 * government sandbox, which no test suite may call. What is under test here is
 * everything *around* the portal call: validation, caching, staleness,
 * provenance, degradation when the portal is unreachable, and the tenant
 * boundary around cached taxpayer data.
 *
 * The double never invents a response the product would accept as real; it
 * returns fixed sandbox-shaped payloads so the mapping and persistence can be
 * checked. Nothing in the product path fabricates anything.
 */

const ALPHA_GSTIN = "27AAPFU0939F1ZV";
const BETA_GSTIN = "29AAGCB7383J1Z4";
/** A real-looking counterparty both tenants might look up. */
const TARGET_GSTIN = "24AAACC4175D1Z4";
const TARGET_TRANSIN = "29AKLPM8755F1Z2";

interface Behaviour {
  gstin?: GatewayResult<GstinDetails>;
  transporter?: GatewayResult<TransporterDetails>;
  onCall?: () => void;
}

/** Counts calls so "served from cache" can be proved, not assumed. */
function stubRegistry(behaviour: Behaviour): {
  registry: GatewayRegistry;
  calls: () => number;
  syncCalls: () => number;
} {
  let calls = 0;
  let syncCalls = 0;
  const bump = (): void => {
    calls += 1;
    behaviour.onCall?.();
  };

  const notUsed = (): never => {
    throw new Error("this provider method must not be reached by a lookup");
  };

  const einvoice = {
    id: "irp",
    verify: async () => gatewayOk({ verifiedAt: new Date() }),
    generateIrn: notUsed,
    cancelIrn: notUsed,
    getIrn: notUsed,
    getIrnByDocument: notUsed,
    async getGstinDetails(_ctx: GatewayRequestContext, gstin: string) {
      bump();
      return (
        behaviour.gstin ??
        gatewayFail<GstinDetails>({
          code: "NOT_CONFIGURED",
          message: `no stub for ${gstin}`,
          retryable: false,
        })
      );
    },
    /** A refresh calls the Common Portal sync, not the plain lookup. */
    async syncGstinDetails(_ctx: GatewayRequestContext, gstin: string) {
      bump();
      syncCalls += 1;
      return (
        behaviour.gstin ??
        gatewayFail<GstinDetails>({
          code: "NOT_CONFIGURED",
          message: `no stub for ${gstin}`,
          retryable: false,
        })
      );
    },
  } as unknown as EinvoiceProvider;

  const ewb = {
    id: "ewb",
    verify: async () => gatewayOk({ verifiedAt: new Date() }),
    generate: notUsed,
    updatePartB: notUsed,
    updateTransporter: notUsed,
    extend: notUsed,
    cancel: notUsed,
    getEwb: notUsed,
    async getGstinDetails() {
      bump();
      return (
        behaviour.gstin ??
        gatewayFail<GstinDetails>({ code: "X", message: "no stub", retryable: false })
      );
    },
    async getTransporterDetails() {
      bump();
      return (
        behaviour.transporter ??
        gatewayFail<TransporterDetails>({ code: "X", message: "no stub", retryable: false })
      );
    },
  } as unknown as EwbProvider;

  return {
    registry: { einvoice: () => einvoice, ewb: () => ewb },
    calls: () => calls,
    syncCalls: () => syncCalls,
  };
}

const ACTIVE_TAXPAYER: GstinDetails = {
  gstin: TARGET_GSTIN,
  legalName: "SANDBOX ISPAT PRIVATE LIMITED",
  tradeName: "Sandbox Ispat",
  status: "ACT",
  statusRaw: "ACT",
  taxpayerType: "REG",
  blockStatus: "unblocked",
  addressLine1: "Survey 118, Rolling Mill Road",
  addressLine2: "Bhavnagar",
  street: null,
  location: null,
  floorNumber: null,
  buildingNumber: null,
  buildingName: null,
  stateCode: "24",
  pincode: "364004",
  // Neither register returns jurisdiction. It must stay null.
  jurisdiction: null,
};

async function withCredentials(container: Container, business: TestBusiness): Promise<void> {
  await container.credentials.save(business.ctx, {
    gstinId: business.gstinId,
    provider: "nic",
    environment: "sandbox",
    service: "einvoice",
    username: "API_USER",
    password: "a-password-value",
    clientId: "client-id",
    clientSecret: "client-secret",
  });
}

describe("GSTIN auto-fill", () => {
  describe("local validation, with no integration at all", () => {
    let container: Container;
    let business: TestBusiness;

    beforeAll(async () => {
      container = await testContainer({}, stubRegistry({}).registry);
      await resetDatabase(container);
      business = await createBusiness(container, {
        slug: "lookup-manual",
        gstin: ALPHA_GSTIN,
        stateCode: "27",
      });
    }, 60_000);

    afterAll(async () => {
      await container?.shutdown();
    });

    it("accepts a checksum-valid GSTIN without contacting anything", () => {
      const result = container.gstinLookup.validate(TARGET_GSTIN);
      expect(result.valid).toBe(true);
      expect(result.normalised).toBe(TARGET_GSTIN);
    });

    it("rejects a bad checksum and explains why", () => {
      // Last character altered: structurally fine, checksum wrong.
      const result = container.gstinLookup.validate("24AAACC4175D1Z9");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/typo|not valid/i);
    });

    it("normalises spacing and case before validating", () => {
      expect(container.gstinLookup.validate(" 24aaacc4175d1z4 ").valid).toBe(true);
    });

    it("refuses a malformed GSTIN through the service", async () => {
      await expect(container.gstinLookup.lookupGstin(business.ctx, "NOTAGSTIN")).rejects.toThrow(
        /valid/i,
      );
    });

    /** The core promise: no credentials must never mean a broken screen. */
    it("reports not_connected rather than failing when nothing is configured", async () => {
      const result = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN);
      expect(result.origin).toBe("not_connected");
      expect(result.details).toBeNull();
      expect(result.fetchedAt).toBeNull();
      expect(result.fetchedFields).toEqual([]);
    });
  });

  describe("fetching, caching and refreshing", () => {
    let container: Container;
    let business: TestBusiness;
    const behaviour: Behaviour = { gstin: gatewayOk(ACTIVE_TAXPAYER) };
    let calls: () => number;

    beforeAll(async () => {
      const stub = stubRegistry(behaviour);
      calls = stub.calls;
      container = await testContainer({}, stub.registry);
      await resetDatabase(container);
      business = await createBusiness(container, {
        slug: "lookup-fetch",
        gstin: ALPHA_GSTIN,
        stateCode: "27",
      });
      await withCredentials(container, business);
    }, 60_000);

    afterAll(async () => {
      await container?.shutdown();
    });

    it("returns the portal's fields and marks them as fetched", async () => {
      const before = calls();
      const result = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN);

      expect(calls()).toBe(before + 1);
      expect(result.origin).toBe("portal");
      expect(result.source).toBe("irp");
      expect(result.fetchedAt).toBeInstanceOf(Date);
      expect(result.stale).toBe(false);

      const details = result.details as GstinDetails;
      expect(details.legalName).toBe("SANDBOX ISPAT PRIVATE LIMITED");
      expect(details.status).toBe("ACT");
      expect(details.stateCode).toBe("24");

      // Provenance: exactly the populated fields, and never the absent ones.
      expect(result.fetchedFields).toContain("legalName");
      expect(result.fetchedFields).toContain("pincode");
      expect(result.fetchedFields).not.toContain("jurisdiction");
    });

    it("never invents a field the portal did not send", async () => {
      const result = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, {
        force: true,
      });
      const details = result.details as GstinDetails;
      // Not derivable from the state code, so it must stay null.
      expect(details.jurisdiction).toBeNull();
      expect(details.buildingName).toBeNull();
    });

    it("serves a second read from cache without calling the portal", async () => {
      await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, { force: true });
      const before = calls();

      const cached = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN);
      expect(calls()).toBe(before);
      expect(cached.origin).toBe("cache");
      expect((cached.details as GstinDetails).legalName).toBe("SANDBOX ISPAT PRIVATE LIMITED");
    });

    it("refresh forces a new call even when the cache is warm", async () => {
      await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN);
      const before = calls();

      const refreshed = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, {
        force: true,
      });
      expect(calls()).toBe(before + 1);
      expect(refreshed.origin).toBe("portal");
    });

    it("stores one row per tenant and identifier, updating in place", async () => {
      await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, { force: true });
      await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, { force: true });

      const rows = await container.database.db
        .select()
        .from(gstinRegistry)
        .where(eq(gstinRegistry.identifier, TARGET_GSTIN));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source).toBe("irp");
      expect(rows[0]?.raw).toBeTruthy();
    });
  });

  describe("a cancelled registration", () => {
    let container: Container;
    let business: TestBusiness;

    beforeAll(async () => {
      const cancelled: GstinDetails = {
        ...ACTIVE_TAXPAYER,
        status: "CNL",
        statusRaw: "CNL",
        blockStatus: "blocked",
      };
      container = await testContainer({}, stubRegistry({ gstin: gatewayOk(cancelled) }).registry);
      await resetDatabase(container);
      business = await createBusiness(container, {
        slug: "lookup-cancelled",
        gstin: ALPHA_GSTIN,
        stateCode: "27",
      });
      await withCredentials(container, business);
    }, 60_000);

    afterAll(async () => {
      await container?.shutdown();
    });

    /**
     * A cancelled GSTIN is a successful lookup with a bad answer, not an
     * error. Throwing would hide the very fact the user needs to see.
     */
    it("returns the details and reports the status truthfully", async () => {
      const result = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN);
      expect(result.origin).toBe("portal");
      const details = result.details as GstinDetails;
      expect(details.status).toBe("CNL");
      expect(details.blockStatus).toBe("blocked");
    });
  });

  describe("when the portal is unavailable", () => {
    let container: Container;
    let business: TestBusiness;
    const behaviour: Behaviour = { gstin: gatewayOk(ACTIVE_TAXPAYER) };

    beforeAll(async () => {
      container = await testContainer({}, stubRegistry(behaviour).registry);
      await resetDatabase(container);
      business = await createBusiness(container, {
        slug: "lookup-outage",
        gstin: ALPHA_GSTIN,
        stateCode: "27",
      });
      await withCredentials(container, business);
    }, 60_000);

    afterAll(async () => {
      await container?.shutdown();
    });

    it("fails with a retryable gateway error when nothing is cached", async () => {
      behaviour.gstin = gatewayFail<GstinDetails>({
        code: "TIMEOUT",
        message: "The portal did not respond",
        retryable: true,
      });
      await expect(
        container.gstinLookup.lookupGstin(business.ctx, "27AAPFU0939F1ZV"),
      ).rejects.toThrow(/did not respond/i);
    });

    /** Losing details the user already had would be worse than showing age. */
    it("falls back to the cached copy, marked stale", async () => {
      behaviour.gstin = gatewayOk(ACTIVE_TAXPAYER);
      await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, { force: true });

      behaviour.gstin = gatewayFail<GstinDetails>({
        code: "TIMEOUT",
        message: "The portal did not respond",
        retryable: true,
      });
      const result = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, {
        force: true,
      });

      expect(result.origin).toBe("cache");
      expect(result.stale).toBe(true);
      expect((result.details as GstinDetails).legalName).toBe("SANDBOX ISPAT PRIVATE LIMITED");
    });
  });

  describe("stale cached data", () => {
    let container: Container;
    let business: TestBusiness;
    let calls: () => number;
    const behaviour: Behaviour = { gstin: gatewayOk(ACTIVE_TAXPAYER) };

    beforeAll(async () => {
      const stub = stubRegistry(behaviour);
      calls = stub.calls;
      container = await testContainer({}, stub.registry);
      await resetDatabase(container);
      business = await createBusiness(container, {
        slug: "lookup-stale",
        gstin: ALPHA_GSTIN,
        stateCode: "27",
      });
      await withCredentials(container, business);
    }, 60_000);

    afterAll(async () => {
      await container?.shutdown();
    });

    it("marks an old row stale and refetches it on the next read", async () => {
      await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN, { force: true });

      // Age the row past the window rather than waiting a week.
      const old = new Date(Date.now() - REGISTRY_STALE_AFTER_MS - 60_000);
      await container.database.db
        .update(gstinRegistry)
        .set({ fetchedAt: old })
        .where(eq(gstinRegistry.identifier, TARGET_GSTIN));

      const cachedView = await container.gstinLookup.cached(business.ctx, TARGET_GSTIN);
      expect(cachedView?.stale).toBe(true);

      // A plain read must not serve a stale row silently.
      const before = calls();
      const refreshed = await container.gstinLookup.lookupGstin(business.ctx, TARGET_GSTIN);
      expect(calls()).toBe(before + 1);
      expect(refreshed.origin).toBe("portal");
      expect(refreshed.stale).toBe(false);
    });
  });

  describe("transporter lookup by TRANSIN", () => {
    let container: Container;
    let business: TestBusiness;

    beforeAll(async () => {
      const transporter: TransporterDetails = {
        transin: TARGET_TRANSIN,
        legalName: "NICTEST",
        tradeName: "XYZ Traders",
        addressLine1: "SOME STREET",
        addressLine2: "SOME CITY",
        stateCode: "29",
        pincode: "560079",
      };
      container = await testContainer(
        {},
        stubRegistry({ transporter: gatewayOk(transporter) }).registry,
      );
      await resetDatabase(container);
      business = await createBusiness(container, {
        slug: "lookup-transin",
        gstin: ALPHA_GSTIN,
        stateCode: "27",
      });
      await container.credentials.save(business.ctx, {
        gstinId: business.gstinId,
        provider: "nic",
        environment: "sandbox",
        service: "ewb",
        username: "EWB_USER",
        password: "a-password-value",
        clientId: "client-id",
        clientSecret: "client-secret",
      });
    }, 60_000);

    afterAll(async () => {
      await container?.shutdown();
    });

    it("resolves an enrolled transporter and stores it separately", async () => {
      const result = await container.gstinLookup.lookupTransporter(business.ctx, TARGET_TRANSIN);
      expect(result.origin).toBe("portal");
      expect(result.kind).toBe("transin");
      expect(result.source).toBe("ewb");

      const details = result.details as TransporterDetails;
      expect(details.legalName).toBe("NICTEST");
      expect(details.pincode).toBe("560079");
    });

    /**
     * The register separation that matters: a transporter record carries no
     * registration status, so it must never satisfy a GSTIN lookup.
     */
    it("does not answer a GSTIN lookup from a transporter record", async () => {
      await container.gstinLookup.lookupTransporter(business.ctx, TARGET_TRANSIN);
      const asGstin = await container.gstinLookup.cached(business.ctx, TARGET_TRANSIN, "gstin");
      expect(asGstin).toBeNull();
    });

    it("keeps the two registers in separate rows", async () => {
      const rows = await container.database.db
        .select({ kind: gstinRegistry.kind })
        .from(gstinRegistry)
        .where(eq(gstinRegistry.identifier, TARGET_TRANSIN));
      expect(rows.map((r) => r.kind)).toEqual(["transin"]);
    });
  });

  describe("tenant isolation", () => {
    let container: Container;
    let alpha: TestBusiness;
    let beta: TestBusiness;

    beforeAll(async () => {
      container = await testContainer(
        {},
        stubRegistry({ gstin: gatewayOk(ACTIVE_TAXPAYER) }).registry,
      );
      await resetDatabase(container);
      alpha = await createBusiness(container, {
        slug: "lookup-alpha",
        gstin: ALPHA_GSTIN,
        stateCode: "27",
      });
      beta = await createBusiness(container, {
        slug: "lookup-beta",
        gstin: BETA_GSTIN,
        stateCode: "29",
      });
      await withCredentials(container, alpha);
    }, 60_000);

    afterAll(async () => {
      await container?.shutdown();
    });

    it("does not serve one tenant's cached lookup to another", async () => {
      await container.gstinLookup.lookupGstin(alpha.ctx, TARGET_GSTIN, { force: true });

      // Beta has no credentials, so if it could see alpha's row it would
      // return cached details instead of not_connected.
      const asBeta = await container.gstinLookup.cached(beta.ctx, TARGET_GSTIN);
      expect(asBeta).toBeNull();

      const lookup = await container.gstinLookup.lookupGstin(beta.ctx, TARGET_GSTIN);
      expect(lookup.origin).toBe("not_connected");
      expect(lookup.details).toBeNull();
    });

    it("lists only the calling tenant's lookups", async () => {
      await container.gstinLookup.lookupGstin(alpha.ctx, TARGET_GSTIN, { force: true });

      expect((await container.gstinLookup.list(alpha.ctx)).length).toBeGreaterThan(0);
      expect(await container.gstinLookup.list(beta.ctx)).toEqual([]);
    });

    it("keeps a row per tenant when both look up the same GSTIN", async () => {
      await withCredentials(container, beta);
      await container.gstinLookup.lookupGstin(alpha.ctx, TARGET_GSTIN, { force: true });
      await container.gstinLookup.lookupGstin(beta.ctx, TARGET_GSTIN, { force: true });

      const [{ count }] = await container.database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(gstinRegistry)
        .where(eq(gstinRegistry.identifier, TARGET_GSTIN));
      expect(count).toBe(2);

      // And each tenant still sees exactly its own.
      expect((await container.gstinLookup.list(alpha.ctx)).length).toBe(1);
      expect((await container.gstinLookup.list(beta.ctx)).length).toBe(1);
    });
  });
});
