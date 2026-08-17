import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext, Container } from "../src/index.js";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  type TestBusiness,
} from "./helpers.js";

/**
 * Multi-registration scoping.
 *
 * A business operating several GSTINs keeps separate books per registration.
 * Billing from the wrong one is a filing error, so the active registration
 * has to reach every query — not just the ones someone remembered to filter.
 *
 * Master data with no registration is shared, which is what a single-GSTIN
 * business has and what existing rows migrated to.
 */
describe("multi-GSTIN scoping", () => {
  let container: Container;
  let business: TestBusiness;
  let maharashtra: string;
  let karnataka: string;

  /** The same user, working in a specific registration. */
  const inRegistration = (gstinId: string | null): AuthContext => ({
    ...business.ctx,
    activeGstinId: gstinId,
  });

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "multi",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    maharashtra = business.gstinId;

    const second = await container.masters.createGstin(business.ctx, {
      gstin: "29AAGCB7383J1Z4",
      legalName: "Multi Traders LLP",
      tradeName: "Multi Traders Karnataka",
      registrationType: "regular",
      addressLine1: "12 Industrial Layout",
      addressLine2: "",
      city: "Bengaluru",
      stateCode: "29",
      pincode: "560001",
      phone: "",
      email: "",
      einvoiceEnabled: true,
      ewbEnabled: true,
      isPrimary: false,
    });
    karnataka = second.id;
  }, 60_000);

  afterAll(async () => await container?.shutdown());

  it("keeps both registrations under one business", async () => {
    const list = await container.masters.listGstins(business.ctx);
    expect(list).toHaveLength(2);
    expect(list.map((g) => g.stateCode).sort()).toEqual(["27", "29"]);
  });

  it("confines a customer created in one registration to that registration", async () => {
    await container.masters.createParty(inRegistration(maharashtra), {
      name: "Pune Buyer",
      legalName: "",
      partyType: "customer",
      gstin: "",
      pan: "",
      registrationType: "unregistered",
      email: "",
      phone: "",
      addressLine1: "1 Road",
      addressLine2: "",
      city: "Pune",
      stateCode: "27",
      pincode: "411001",
      country: "IN",
      defaultPlaceOfSupply: "27",
      notes: "",
    });

    const inMaharashtra = await container.masters.listParties(inRegistration(maharashtra), {
      limit: 50,
    });
    const inKarnataka = await container.masters.listParties(inRegistration(karnataka), {
      limit: 50,
    });

    expect(inMaharashtra.items.some((p) => p.name === "Pune Buyer")).toBe(true);
    expect(inKarnataka.items.some((p) => p.name === "Pune Buyer")).toBe(false);
  });

  it("shows shared master data in every registration", async () => {
    // Created with no active registration, so it belongs to all of them.
    await container.masters.createParty(inRegistration(null), {
      name: "Shared Buyer",
      legalName: "",
      partyType: "customer",
      gstin: "",
      pan: "",
      registrationType: "unregistered",
      email: "",
      phone: "",
      addressLine1: "2 Road",
      addressLine2: "",
      city: "Mumbai",
      stateCode: "27",
      pincode: "400001",
      country: "IN",
      defaultPlaceOfSupply: "27",
      notes: "",
    });

    for (const registration of [maharashtra, karnataka]) {
      const list = await container.masters.listParties(inRegistration(registration), { limit: 50 });
      expect(
        list.items.some((p) => p.name === "Shared Buyer"),
        registration,
      ).toBe(true);
    }
  });

  it("scopes items and vehicles the same way", async () => {
    await container.masters.createProduct(inRegistration(karnataka), {
      name: "Karnataka Only Item",
      description: "",
      sku: "",
      hsnSac: "7308",
      isService: false,
      gstRate: 18,
      cessRate: 0,
      unit: "NOS",
      unitPrice: 100,
    });
    await container.masters.createVehicle(inRegistration(karnataka), {
      vehicleNo: "KA05CD1290",
      vehicleType: "R",
      transporterId: null,
      driverName: "",
      driverPhone: "",
    });

    const products = await container.masters.listProducts(inRegistration(maharashtra), {
      limit: 50,
    });
    expect(products.items.some((p) => p.name === "Karnataka Only Item")).toBe(false);

    const vehicles = await container.masters.listVehicles(inRegistration(maharashtra), {
      limit: 50,
    });
    expect(vehicles.items.some((v) => v.vehicleNo === "KA05CD1290")).toBe(false);
  });

  it("filters the billing history by the active registration", async () => {
    const draft = await container.invoices.createDraft(
      inRegistration(maharashtra),
      invoiceInput(business),
    );
    await container.invoices.finalize(inRegistration(maharashtra), draft.invoice.id);

    const fromMaharashtra = await container.invoices.list(inRegistration(maharashtra), {
      limit: 50,
      page: 1,
      sort: "invoiceDate",
      order: "desc",
    } as never);
    const fromKarnataka = await container.invoices.list(inRegistration(karnataka), {
      limit: 50,
      page: 1,
      sort: "invoiceDate",
      order: "desc",
    } as never);
    const everything = await container.invoices.list(inRegistration(null), {
      limit: 50,
      page: 1,
      sort: "invoiceDate",
      order: "desc",
    } as never);

    expect(fromMaharashtra.total).toBeGreaterThan(0);
    expect(fromKarnataka.total).toBe(0);
    expect(everything.total).toBe(fromMaharashtra.total);
  });

  it("numbers each registration in its own series", async () => {
    const first = await container.invoices.createDraft(
      inRegistration(karnataka),
      invoiceInput(business, { gstinId: karnataka, placeOfSupply: "29" }),
    );
    const issued = await container.invoices.finalize(inRegistration(karnataka), first.invoice.id);
    // A fresh registration starts at 0001 regardless of the other's history.
    expect(issued.invoiceNumber).toMatch(/\/0001$/);
  });

  it("refuses to point a session at another business's registration", async () => {
    const other = await createBusiness(container, {
      slug: "multi-other",
      gstin: "24AAACC4175D1Z4",
      stateCode: "24",
    });
    await expect(container.auth.setActiveGstin(other.ctx, maharashtra)).rejects.toThrow(
      /not found/i,
    );
  });

  it("carries the active registration through session resolution", async () => {
    // The bug this guards against: the session stored the choice but the
    // resolved context dropped it, so every GSTIN filter silently did nothing.
    const login = await container.auth.login("multi@example.test", "TestPassword123!");
    const resolved = await container.auth.resolveSession(login.token);
    expect(resolved).not.toBeNull();

    await container.auth.setActiveGstin(resolved!, karnataka);
    const after = await container.auth.resolveSession(login.token);
    expect(after?.activeGstinId).toBe(karnataka);
  });
});
