/**
 * Development seed: reference data plus one worked example that exercises the
 * hard parts of the model — a Bill-To/Ship-To consignment dispatched from a
 * plant, multiple HSNs and tax rates, freight, and a transporter with a
 * vehicle. Run with `pnpm db:seed`.
 *
 * Safe to re-run: it upserts by natural key and never touches an existing
 * finalized invoice.
 */
import { createContainer, seedReferenceData, type AuthContext } from "@traxac/core";
import { eq } from "drizzle-orm";
import { tenants, users } from "@traxac/database";

const DEMO_EMAIL = "owner@demo.traxac.in";
const DEMO_PASSWORD = "TraxacDemo2026!";

async function main(): Promise<void> {
  const container = createContainer({ processName: "traxac-seed" });
  const { database, logger, auth, masters, invoices } = container;

  try {
    await seedReferenceData(database);
    logger.info("reference data ready (UQC units, common HSN/SAC)");

    const [existingUser] = await database.db.select().from(users)
      .where(eq(users.email, DEMO_EMAIL)).limit(1);

    let ctx: AuthContext;
    if (existingUser) {
      const session = await auth.login(DEMO_EMAIL, DEMO_PASSWORD);
      ctx = {
        userId: session.user.userId,
        email: session.user.email,
        name: session.user.name,
        tenantId: session.user.tenantId,
        role: session.user.role,
        actor: "session",
      };
      logger.info({ tenantId: ctx.tenantId }, "reusing the existing demo business");
    } else {
      const registered = await auth.register({
        name: "Demo Owner",
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        businessName: "Sundar Steel Traders",
      });
      ctx = {
        userId: registered.user.userId,
        email: registered.user.email,
        name: registered.user.name,
        tenantId: registered.user.tenantId,
        role: registered.user.role,
        actor: "session",
      };
      logger.info({ tenantId: ctx.tenantId }, "created the demo business");
    }

    // --- Registration and plant ------------------------------------------
    const gstinList = await masters.listGstins(ctx);
    const gstin = gstinList[0] ?? await masters.createGstin(ctx, {
      gstin: "27AAPFU0939F1ZV",
      legalName: "Sundar Steel Traders LLP",
      tradeName: "Sundar Steel Traders",
      registrationType: "regular",
      addressLine1: "Unit 14, Bhosari Industrial Estate",
      addressLine2: "MIDC Road",
      city: "Pune",
      stateCode: "27",
      pincode: "411026",
      phone: "02027121212",
      email: "accounts@sundarsteel.example",
      einvoiceEnabled: true,
      ewbEnabled: true,
      isPrimary: true,
    });

    const branches = await masters.listBranches(ctx, gstin.id);
    const plant = branches.find((b) => b.kind === "plant") ?? await masters.createBranch(ctx, {
      gstinId: gstin.id,
      code: "PLT-01",
      name: "Chakan Rolling Plant",
      kind: "plant",
      addressLine1: "Plot 88, Chakan MIDC Phase II",
      addressLine2: "",
      city: "Chakan",
      stateCode: "27",
      pincode: "410501",
      phone: "",
      isDefault: false,
    });

    // --- Customer with a separate delivery site ---------------------------
    const parties = await masters.listParties(ctx, { q: "Meridian" });
    const buyer = parties.items[0] ?? await masters.createParty(ctx, {
      name: "Meridian Infra Projects",
      legalName: "Meridian Infra Projects Private Limited",
      partyType: "customer",
      gstin: "29AAGCB7383J1Z4",
      pan: "",
      registrationType: "regular",
      email: "purchase@meridian.example",
      phone: "9845012345",
      addressLine1: "5th Floor, Prestige Atrium, Central Street",
      addressLine2: "",
      city: "Bengaluru",
      stateCode: "29",
      pincode: "560001",
      country: "IN",
      defaultPlaceOfSupply: "29",
      notes: "",
    });

    const buyerDetail = await masters.getPartyWithAddresses(ctx, buyer.id);
    const shipTo = buyerDetail.addresses[0] ?? await masters.addPartyAddress(ctx, buyer.id, {
      label: "Hosur Site Store",
      kind: "shipping",
      gstin: "",
      name: "Meridian Infra Projects — Hosur Site",
      addressLine1: "Survey 214, Hosur–Krishnagiri Highway",
      addressLine2: "",
      city: "Hosur",
      stateCode: "33",
      pincode: "635109",
      phone: "9840011223",
      isDefault: true,
    });

    // --- Catalogue ---------------------------------------------------------
    const productList = await masters.listProducts(ctx, { limit: 50 });
    const ensureProduct = async (input: Parameters<typeof masters.createProduct>[1]) =>
      productList.items.find((p) => p.name === input.name)
        ?? await masters.createProduct(ctx, input);

    const beam = await ensureProduct({
      name: "MS Structural Beam ISMB 200",
      description: "Hot-rolled mild steel I-beam, 200mm, 12m length",
      sku: "ISMB-200",
      hsnSac: "7308",
      isService: false,
      gstRate: 18,
      cessRate: 0,
      unit: "MTS",
      unitPrice: 62500,
    });
    const bolts = await ensureProduct({
      name: "HT Bolt M20 x 80 (Grade 8.8)",
      description: "High-tensile hex bolt with nut and washer",
      sku: "HTB-M20-80",
      hsnSac: "7318",
      isService: false,
      gstRate: 18,
      cessRate: 0,
      unit: "NOS",
      unitPrice: 48.5,
    });
    const primer = await ensureProduct({
      name: "Red Oxide Primer 20L",
      description: "Anti-corrosive primer for structural steel",
      sku: "ROP-20",
      hsnSac: "3208",
      isService: false,
      gstRate: 18,
      cessRate: 0,
      unit: "CAN",
      unitPrice: 3150,
    });

    // --- Logistics ---------------------------------------------------------
    const transporterList = await masters.listTransporters(ctx, { q: "Deccan" });
    const transporter = transporterList.items[0] ?? await masters.createTransporter(ctx, {
      name: "Deccan Roadlines",
      transporterId: "27AAACT2727Q1ZM",
      phone: "9822001100",
      email: "",
      addressLine1: "Transport Nagar, Pune",
      city: "Pune",
      stateCode: "27",
      pincode: "411019",
    });
    await masters.createVehicle(ctx, {
      vehicleNo: "MH12QR4455",
      vehicleType: "R",
      transporterId: transporter.id,
      driverName: "Ramesh Pawar",
      driverPhone: "9822114455",
    });

    // --- A worked example invoice -----------------------------------------
    const existingDrafts = await invoices.list(ctx, {
      limit: 1, page: 1, sort: "createdAt", order: "desc",
    });
    if (existingDrafts.total > 0) {
      logger.info({ count: existingDrafts.total }, "invoices already present; skipping the sample");
    } else {
      const draft = await invoices.createDraft(ctx, {
        gstinId: gstin.id,
        branchId: null,
        docType: "invoice",
        series: "INV",
        invoiceNumber: "",
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        buyerPartyId: buyer.id,
        // Bill To Bengaluru, Ship To Hosur, dispatched from the Chakan plant:
        // EWB transaction type 4 (Bill-To/Ship-To plus Dispatch-From).
        shipToAddressId: shipTo.id,
        dispatchFromBranchId: plant.id,
        supplyCategory: "b2b",
        placeOfSupply: "29",
        reverseCharge: false,
        igstOnIntra: false,
        currency: "INR",
        exchangeRate: 1,
        lines: [
          {
            productId: beam.id,
            name: beam.name,
            description: beam.description ?? "",
            hsnSac: beam.hsnSac,
            isService: false,
            quantity: 12.5,
            unit: "MTS",
            unitPrice: 62500,
            discountPercent: 2,
            discountAmount: 0,
            gstRate: 18,
            cessRate: 0,
            cessNonAdvol: 0,
            stateCess: 0,
            batchNo: "",
            barcode: "",
          },
          {
            productId: bolts.id,
            name: bolts.name,
            description: bolts.description ?? "",
            hsnSac: bolts.hsnSac,
            isService: false,
            quantity: 1500,
            unit: "NOS",
            unitPrice: 48.5,
            discountPercent: 0,
            discountAmount: 0,
            gstRate: 18,
            cessRate: 0,
            cessNonAdvol: 0,
            stateCess: 0,
            batchNo: "",
            barcode: "",
          },
          {
            productId: primer.id,
            name: primer.name,
            description: primer.description ?? "",
            hsnSac: primer.hsnSac,
            isService: false,
            quantity: 8,
            unit: "CAN",
            unitPrice: 3150,
            discountPercent: 0,
            discountAmount: 0,
            gstRate: 18,
            cessRate: 0,
            cessNonAdvol: 0,
            stateCess: 0,
            batchNo: "",
            barcode: "",
          },
        ],
        charges: [
          { label: "Freight to Hosur", kind: "freight", hsnSac: "996511", amount: 18500, gstRate: 5 },
          { label: "Loading and packing", kind: "packing", hsnSac: "", amount: 4200, gstRate: 18 },
        ],
        transport: {
          transporterId: transporter.id,
          transportMode: 1,
          distanceKm: 840,
          vehicleNo: "MH12QR4455",
          vehicleType: "R",
          transportDocNo: "DRL/2026/44120",
          transportDocDate: new Date(),
          subSupplyType: "1",
        },
        poNumber: "MIP/PO/2026/0871",
        poDate: new Date(Date.now() - 6 * 86_400_000),
        notes: "Material to be unloaded at the site store between 9am and 5pm.",
        terms: "Payment within 30 days. Interest at 18% p.a. on delayed payments.",
      });

      logger.info(
        {
          invoiceId: draft.invoice.id,
          grandTotal: draft.invoice.grandTotal / 100,
          ewbRequired: draft.invoice.ewbRequired,
          ewbTransactionType: draft.invoice.ewbTransactionType,
        },
        "created the sample draft invoice",
      );
    }

    logger.info(
      { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      "seed complete — sign in with these credentials",
    );
  } finally {
    await container.shutdown();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
