import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ewayBills, parties, products, transporters, vehicles } from "@traxac/database";
import type { AuthContext, Container } from "../src/index.js";
import {
  createBusiness,
  invoiceInput,
  resetDatabase,
  testContainer,
  type TestBusiness,
} from "./helpers.js";

/**
 * Regression suite.
 *
 * One test per defect found during the audit and integration passes, named
 * after the bug rather than the feature, so a failure here says exactly which
 * old mistake has come back. Behavioural coverage of these areas lives in the
 * feature suites; this file exists to make each specific regression loud.
 */
describe("regressions", () => {
  let container: Container;
  let business: TestBusiness;
  let second: string;

  const inRegistration = (gstinId: string | null): AuthContext => ({
    ...business.ctx,
    activeGstinId: gstinId,
  });

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "regress",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    const other = await container.masters.createGstin(business.ctx, {
      gstin: "29AAGCB7383J1Z4",
      legalName: "Regress Traders LLP",
      tradeName: "Regress Karnataka",
      registrationType: "regular",
      addressLine1: "9 Second Street",
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
    second = other.id;
  }, 60_000);

  afterAll(async () => await container?.shutdown());

  /**
   * Bug 1 — resolveSession selected activeGstinId but never copied it onto
   * the returned context, so every GSTIN filter downstream silently did
   * nothing and multi-registration scoping appeared to work while doing
   * nothing at all.
   */
  it("bug 1: session resolution carries the active registration", async () => {
    const login = await container.auth.login("regress@example.test", "TestPassword123!");
    const before = await container.auth.resolveSession(login.token);
    expect(before?.activeGstinId ?? null).toBeNull();

    await container.auth.setActiveGstin(before!, second);

    const after = await container.auth.resolveSession(login.token);
    expect(after?.activeGstinId, "the chosen registration must survive a round trip").toBe(second);
  });

  /**
   * Bug 2 — master-data inserts never wrote gstinId, so the scoping predicate
   * had nothing to filter on and every row behaved as shared.
   */
  it("bug 2: every master-data insert stamps the active registration", async () => {
    const ctx = inRegistration(second);

    const party = await container.masters.createParty(ctx, {
      name: "Stamped Buyer",
      legalName: "",
      partyType: "customer",
      gstin: "",
      pan: "",
      registrationType: "unregistered",
      email: "",
      phone: "",
      addressLine1: "1 Road",
      addressLine2: "",
      city: "Bengaluru",
      stateCode: "29",
      pincode: "560001",
      country: "IN",
      defaultPlaceOfSupply: "29",
      notes: "",
    });
    const product = await container.masters.createProduct(ctx, {
      name: "Stamped Item",
      description: "",
      sku: "",
      hsnSac: "7308",
      isService: false,
      gstRate: 18,
      cessRate: 0,
      unit: "NOS",
      unitPrice: 100,
    });
    const transporter = await container.masters.createTransporter(ctx, {
      name: "Stamped Carriers",
      transporterId: "",
      phone: "",
      email: "",
      addressLine1: "",
      city: "",
      stateCode: "",
      pincode: "",
    });
    const vehicle = await container.masters.createVehicle(ctx, {
      vehicleNo: "KA51ZZ9090",
      vehicleType: "R",
      transporterId: null,
      driverName: "",
      driverPhone: "",
    });

    const rows = await Promise.all([
      container.database.db
        .select({ g: parties.gstinId })
        .from(parties)
        .where(eq(parties.id, party.id)),
      container.database.db
        .select({ g: products.gstinId })
        .from(products)
        .where(eq(products.id, product.id)),
      container.database.db
        .select({ g: transporters.gstinId })
        .from(transporters)
        .where(eq(transporters.id, transporter.id)),
      container.database.db
        .select({ g: vehicles.gstinId })
        .from(vehicles)
        .where(eq(vehicles.id, vehicle.id)),
    ]);

    for (const [index, row] of rows.entries()) {
      expect(row[0]?.g, `insert ${index} lost its registration`).toBe(second);
    }
  });

  /**
   * Bug 3 — setActiveGstin returned early when the context had no session,
   * before checking ownership, so a caller could aim at another business's
   * registration and be told nothing was wrong.
   */
  it("bug 3: ownership is verified before the session short-circuit", async () => {
    const other = await createBusiness(container, {
      slug: "regress-other",
      gstin: "24AAACC4175D1Z4",
      stateCode: "24",
    });

    // No sessionId on this context: the old code returned before checking.
    const sessionless: AuthContext = { ...other.ctx, sessionId: undefined };
    await expect(
      container.auth.setActiveGstin(sessionless, second),
      "a foreign registration must be refused even with no session",
    ).rejects.toThrow(/not found/i);
  });

  /**
   * Bug 4 — GSTR-1 interpolated JS Date objects into a raw sql template,
   * which bypasses the driver's type mapping and throws at bind time. The
   * same class of bug had already broken notifications once.
   */
  it("bug 4: GSTR-1 builds without interpolating a Date into raw SQL", async () => {
    const draft = await container.invoices.createDraft(
      inRegistration(null),
      invoiceInput(business, { invoiceDate: new Date("2026-09-10T06:00:00Z") }),
    );
    await container.invoices.finalize(inRegistration(null), draft.invoice.id);

    // Threw "must be of type string ... Received an instance of Date" before.
    const prepared = await container.gstr1.prepare(business.ctx, business.gstinId, "092026");
    expect(prepared.invoiceCount).toBeGreaterThan(0);
    expect(prepared.payload.hsn.data.length).toBeGreaterThan(0);
  });

  /**
   * Bug 5 — an e-Way Bill generated without vehicle details sits in
   * "part_b_pending". The short-circuit only recognised "generated", so a
   * retry sent a second generate request and produced a duplicate bill for
   * the same consignment.
   */
  it("bug 5: a Part-A-only e-Way Bill is not generated twice", async () => {
    const ctx = inRegistration(null);
    const draft = await container.invoices.createDraft(ctx, invoiceInput(business));
    const invoice = await container.invoices.finalize(ctx, draft.invoice.id);

    // Stand in for a portal round trip that returned Part-A only.
    await container.database.db.insert(ewayBills).values({
      tenantId: business.tenantId,
      invoiceId: invoice.id,
      gstin: "27AAPFU0939F1ZV",
      environment: "sandbox",
      ewbNumber: "391000777888",
      status: "part_b_pending",
      generatedAt: new Date(),
    });

    const again = await container.compliance.generateEwb(ctx, invoice.id, { distanceKm: 100 });
    expect(again.ewbNumber).toBe("391000777888");

    const all = await container.database.db
      .select({ id: ewayBills.id })
      .from(ewayBills)
      .where(eq(ewayBills.invoiceId, invoice.id));
    expect(all, "a retry must not create a second e-Way Bill").toHaveLength(1);
  });

  /**
   * Bug 6 — the load script read a GSTIN as one tenant and posted invoices as
   * another. Tenant isolation correctly refused, and the run measured 404s
   * instead of throughput. The guard is that a registration id is only ever
   * usable by the tenant that owns it.
   */
  it("bug 6: a registration id is unusable by another tenant", async () => {
    const other = await createBusiness(container, {
      slug: "regress-load",
      gstin: "33AAACT2727Q1Z3",
      stateCode: "33",
    });

    await expect(
      container.invoices.preview(other.ctx, {
        gstinId: business.gstinId,
        placeOfSupply: "27",
        supplyCategory: "b2b",
        igstOnIntra: false,
        insuranceAmount: 0,
        insuranceGstRate: 18,
        tcsRate: 0,
        lines: [
          {
            productId: null,
            name: "Cross tenant",
            description: "",
            hsnSac: "7308",
            isService: false,
            quantity: 1,
            unit: "NOS",
            unitPrice: 100,
            discountPercent: 0,
            discountAmount: 0,
            gstRate: 18,
            cessRate: 0,
            cessNonAdvol: 0,
            stateCess: 0,
            batchNo: "",
            barcode: "",
            expiryDate: null,
          },
        ],
        charges: [],
      } as never),
    ).rejects.toThrow(/gstin you are billing from|not found/i);

    await expect(
      container.invoices.createDraft(
        other.ctx,
        invoiceInput(business, { gstinId: business.gstinId }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
