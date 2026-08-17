/**
 * Development seed.
 *
 * Creates a business with enough real-shaped history that every screen has
 * something to show: customers across states, a catalogue, transporters, and
 * invoices spread across the lifecycle — drafts, issued, part-paid, paid,
 * cancelled, and one carrying a live e-Way Bill that is about to expire.
 *
 * Compliance state is written directly here rather than called through the
 * portal, because there is no portal to call without credentials. Those rows
 * are marked `environment: "seed"` so they are never mistaken for something a
 * government system returned.
 *
 * Safe to re-run: it reuses the existing business and skips invoice creation
 * if any already exist.
 */
import { eq } from "drizzle-orm";
import {
  createContainer, seedReferenceData, type AuthContext, type Container,
} from "@traxac/core";
import { einvoices, ewayBills, invoices, users } from "@traxac/database";
import { computeValidity } from "@traxac/shared";

const DEMO_EMAIL = "owner@demo.traxac.in";
const DEMO_PASSWORD = "TraxacDemo2026!";

const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);

async function main(): Promise<void> {
  const container = createContainer({ processName: "traxac-seed" });
  const { database, logger, auth, masters, invoices: invoiceService } = container;

  try {
    await seedReferenceData(database);
    logger.info("reference data ready (UQC units, common HSN/SAC)");

    const ctx = await ensureOwner(container);

    /* ---------------------------- registration --------------------------- */
    const existingGstins = await masters.listGstins(ctx);
    const gstin = existingGstins[0] ?? await masters.createGstin(ctx, {
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

    const branchList = await masters.listBranches(ctx, gstin.id);
    const plant = branchList.find((b) => b.kind === "plant") ?? await masters.createBranch(ctx, {
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

    /* ------------------------------ customers ---------------------------- */
    const customerSpecs = [
      {
        name: "Meridian Infra Projects",
        legalName: "Meridian Infra Projects Private Limited",
        gstin: "29AAGCB7383J1Z4",
        city: "Bengaluru", stateCode: "29", pincode: "560001",
        addressLine1: "5th Floor, Prestige Atrium, Central Street",
        phone: "9845012345",
      },
      {
        name: "Konkan Fabricators",
        legalName: "Konkan Fabricators LLP",
        gstin: "27AAACT2727Q1ZY",
        city: "Pune", stateCode: "27", pincode: "411019",
        addressLine1: "Gat 220, Talegaon Industrial Area",
        phone: "9822004411",
      },
      {
        name: "Deccan Engineering Works",
        legalName: "Deccan Engineering Works",
        gstin: "24AAACC4175D1Z4",
        city: "Ahmedabad", stateCode: "24", pincode: "380015",
        addressLine1: "Shed 7, Vatva GIDC Phase III",
        phone: "9879001122",
      },
      {
        name: "Nagpur Hardware Mart",
        legalName: "",
        gstin: "",
        city: "Nagpur", stateCode: "27", pincode: "440018",
        addressLine1: "Shop 12, Itwari Market",
        phone: "9764003311",
      },
    ];

    const customers = [];
    for (const spec of customerSpecs) {
      const found = await masters.listParties(ctx, { q: spec.name, limit: 1 });
      customers.push(found.items[0] ?? await masters.createParty(ctx, {
        name: spec.name,
        legalName: spec.legalName,
        partyType: "customer",
        gstin: spec.gstin,
        pan: "",
        registrationType: spec.gstin ? "regular" : "unregistered",
        email: "",
        phone: spec.phone,
        addressLine1: spec.addressLine1,
        addressLine2: "",
        city: spec.city,
        stateCode: spec.stateCode,
        pincode: spec.pincode,
        country: "IN",
        defaultPlaceOfSupply: spec.stateCode,
        notes: "",
      }));
    }
    const [meridian, konkan, deccan, nagpur] = customers;

    // A delivery site in a third state — this is what makes a Bill-To/Ship-To.
    const meridianDetail = await masters.getPartyWithAddresses(ctx, meridian!.id);
    const hosurSite = meridianDetail.addresses[0] ?? await masters.addPartyAddress(ctx, meridian!.id, {
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

    /* ------------------------------ catalogue ---------------------------- */
    const catalogue = [
      { name: "MS Structural Beam ISMB 200", sku: "ISMB-200", hsn: "7308", unit: "MTS", price: 62500, rate: 18,
        description: "Hot-rolled mild steel I-beam, 200mm, 12m length" },
      { name: "MS Angle 50x50x6", sku: "ANG-50", hsn: "7308", unit: "MTS", price: 58400, rate: 18,
        description: "Equal angle, 6mm thickness" },
      { name: "HT Bolt M20 x 80 (Grade 8.8)", sku: "HTB-M20-80", hsn: "7318", unit: "NOS", price: 48.5, rate: 18,
        description: "High-tensile hex bolt with nut and washer" },
      { name: "TMT Bar Fe500D 16mm", sku: "TMT-16", hsn: "7214", unit: "MTS", price: 54900, rate: 18,
        description: "Thermo-mechanically treated reinforcement bar" },
      { name: "Red Oxide Primer 20L", sku: "ROP-20", hsn: "3208", unit: "CAN", price: 3150, rate: 18,
        description: "Anti-corrosive primer for structural steel" },
      { name: "MS Plate 10mm", sku: "PLT-10", hsn: "7208", unit: "MTS", price: 61200, rate: 18,
        description: "Hot-rolled mild steel plate" },
      { name: "Fabrication and erection charges", sku: "SVC-FAB", hsn: "998399", unit: "NOS", price: 25000, rate: 18,
        description: "On-site fabrication and erection", service: true },
    ];

    const existingProducts = await masters.listProducts(ctx, { limit: 100 });
    const products = new Map<string, { id: string; hsnSac: string; unit: string; unitPrice: number; gstRate: string; description: string | null }>();
    for (const item of catalogue) {
      const found = existingProducts.items.find((p) => p.name === item.name);
      const product = found ?? await masters.createProduct(ctx, {
        name: item.name,
        description: item.description,
        sku: item.sku,
        hsnSac: item.hsn,
        isService: item.service ?? false,
        gstRate: item.rate,
        cessRate: 0,
        unit: item.unit,
        unitPrice: item.price,
      });
      products.set(item.name, product);
    }

    /* ------------------------------ logistics ---------------------------- */
    const transporterList = await masters.listTransporters(ctx, { q: "Deccan Roadlines" });
    const transporter = transporterList.items[0] ?? await masters.createTransporter(ctx, {
      name: "Deccan Roadlines",
      transporterId: "27AAACT2727QY",
      phone: "9822001100",
      email: "",
      addressLine1: "Transport Nagar, Pune",
      city: "Pune",
      stateCode: "27",
      pincode: "411019",
    });
    for (const vehicleNo of ["MH12QR4455", "MH14AB7788", "KA05CD1290"]) {
      await masters.createVehicle(ctx, {
        vehicleNo, vehicleType: "R", transporterId: transporter.id,
        driverName: "", driverPhone: "",
      });
    }

    /* ------------------------------- invoices ---------------------------- */
    const already = await invoiceService.list(ctx, {
      limit: 1, page: 1, sort: "createdAt", order: "desc",
    } as never);
    if (already.total > 0) {
      logger.info({ count: already.total }, "invoices already present; leaving them alone");
      logger.info({ email: DEMO_EMAIL }, "seed complete");
      return;
    }

    const line = (name: string, quantity: number, discountPercent = 0) => {
      const product = products.get(name)!;
      return {
        productId: product.id,
        name,
        description: product.description ?? "",
        hsnSac: product.hsnSac,
        isService: product.hsnSac.startsWith("99"),
        quantity,
        unit: product.unit,
        unitPrice: product.unitPrice / 100,
        discountPercent,
        discountAmount: 0,
        gstRate: Number(product.gstRate),
        cessRate: 0,
        cessNonAdvol: 0,
        stateCess: 0,
        batchNo: "",
        barcode: "",
        expiryDate: null,
      };
    };

    const base = (overrides: Record<string, unknown>) => ({
      gstinId: gstin.id,
      branchId: null,
      docType: "invoice",
      series: "INV",
      invoiceNumber: "",
      dueDate: null,
      shipToAddressId: null,
      dispatchFromBranchId: null,
      supplyCategory: "b2b",
      reverseCharge: false,
      igstOnIntra: false,
      currency: "INR",
      exchangeRate: 1,
      charges: [],
      poNumber: "",
      notes: "",
      terms: "Payment within 30 days. Interest at 18% p.a. on delayed payments.",
      ...overrides,
    });

    // 1. The complex one: Bill-To Bengaluru, Ship-To Hosur, dispatched from the
    //    Chakan plant. EWB transaction type 4, multiple HSNs, freight and packing.
    const complex = await invoiceService.createDraft(ctx, base({
      invoiceDate: daysAgo(2),
      dueDate: new Date(Date.now() + 28 * 86_400_000),
      buyerPartyId: meridian!.id,
      shipToAddressId: hosurSite.id,
      dispatchFromBranchId: plant.id,
      placeOfSupply: "29",
      lines: [line("MS Structural Beam ISMB 200", 12.5, 2), line("HT Bolt M20 x 80 (Grade 8.8)", 1500), line("Red Oxide Primer 20L", 8)],
      charges: [
        { label: "Freight to Hosur", kind: "freight", hsnSac: "996511", amount: 18500, gstRate: 5 },
        { label: "Loading and packing", kind: "packing", hsnSac: "", amount: 4200, gstRate: 18 },
      ],
      transport: {
        transporterId: transporter.id, transportMode: 1, distanceKm: 840,
        vehicleNo: "MH12QR4455", vehicleType: "R",
        transportDocNo: "DRL/2026/44120", transportDocDate: daysAgo(2), subSupplyType: "1",
      },
      poNumber: "MIP/PO/2026/0871",
      poDate: daysAgo(8),
      notes: "Material to be unloaded at the site store between 9am and 5pm.",
    }) as never);
    await invoiceService.finalize(ctx, complex.invoice.id);
    await markCompliant(container, ctx, complex.invoice.id, { withEwb: true, distanceKm: 840, expiresInHours: 9, vehicleNo: "MH12QR4455" });

    // 2. Intra-state, paid in full.
    const paid = await invoiceService.createDraft(ctx, base({
      invoiceDate: daysAgo(21),
      buyerPartyId: konkan!.id,
      placeOfSupply: "27",
      lines: [line("MS Angle 50x50x6", 6), line("MS Plate 10mm", 3.2)],
      poNumber: "KF/2026/112",
    }) as never);
    await invoiceService.finalize(ctx, paid.invoice.id);
    await markCompliant(container, ctx, paid.invoice.id, {});
    await invoiceService.recordPayment(ctx, paid.invoice.id, {
      amount: paid.invoice.grandTotal / 100, method: "rtgs", reference: "RTGS/2026/88120",
    } as never);

    // 3. Inter-state, part paid, overdue.
    const partPaid = await invoiceService.createDraft(ctx, base({
      invoiceDate: daysAgo(45),
      dueDate: daysAgo(15),
      buyerPartyId: deccan!.id,
      placeOfSupply: "24",
      lines: [line("TMT Bar Fe500D 16mm", 18)],
      transport: {
        transporterId: transporter.id, transportMode: 1, distanceKm: 620,
        vehicleNo: "MH14AB7788", vehicleType: "R",
        transportDocNo: "DRL/2026/43880", transportDocDate: daysAgo(45), subSupplyType: "1",
      },
    }) as never);
    await invoiceService.finalize(ctx, partPaid.invoice.id);
    await markCompliant(container, ctx, partPaid.invoice.id, { withEwb: true, distanceKm: 620, expiresInHours: -72, vehicleNo: "MH14AB7788" });
    await invoiceService.recordPayment(ctx, partPaid.invoice.id, {
      amount: 250000, method: "neft", reference: "NEFT/2026/5510",
    } as never);

    // 4. Small unregistered walk-in — no e-Invoice, no e-Way Bill.
    const walkIn = await invoiceService.createDraft(ctx, base({
      invoiceDate: daysAgo(5),
      buyerPartyId: nagpur!.id,
      placeOfSupply: "27",
      lines: [line("HT Bolt M20 x 80 (Grade 8.8)", 200), line("Red Oxide Primer 20L", 2)],
      terms: "Cash on delivery.",
    }) as never);
    await invoiceService.finalize(ctx, walkIn.invoice.id);
    await invoiceService.recordPayment(ctx, walkIn.invoice.id, {
      amount: walkIn.invoice.grandTotal / 100, method: "cash",
    } as never);

    // 5. A services invoice — no movement of goods.
    const services = await invoiceService.createDraft(ctx, base({
      invoiceDate: daysAgo(12),
      buyerPartyId: konkan!.id,
      placeOfSupply: "27",
      lines: [line("Fabrication and erection charges", 4)],
    }) as never);
    await invoiceService.finalize(ctx, services.invoice.id);
    await markCompliant(container, ctx, services.invoice.id, {});

    // 6. A cancelled invoice, so the status filter has something to show.
    const cancelled = await invoiceService.createDraft(ctx, base({
      invoiceDate: daysAgo(30),
      buyerPartyId: deccan!.id,
      placeOfSupply: "24",
      lines: [line("MS Plate 10mm", 1)],
    }) as never);
    await invoiceService.finalize(ctx, cancelled.invoice.id);
    await invoiceService.cancel(ctx, cancelled.invoice.id, "2: Order cancelled by the customer");

    // 7. An open draft.
    await invoiceService.createDraft(ctx, base({
      invoiceDate: new Date(),
      buyerPartyId: meridian!.id,
      placeOfSupply: "29",
      lines: [line("MS Structural Beam ISMB 200", 4)],
    }) as never);

    const summary = await invoiceService.list(ctx, {
      limit: 50, page: 1, sort: "invoiceDate", order: "desc",
    } as never);
    logger.info({ invoices: summary.total, customers: customers.length, products: products.size },
      "sample data created");
    logger.info({ email: DEMO_EMAIL, password: DEMO_PASSWORD },
      "seed complete — sign in with these credentials");
  } finally {
    await container.shutdown();
  }
}

async function ensureOwner(container: Container): Promise<AuthContext> {
  const { database, auth, logger } = container;
  const [existing] = await database.db.select().from(users)
    .where(eq(users.email, DEMO_EMAIL)).limit(1);

  const session = existing
    ? await auth.login(DEMO_EMAIL, DEMO_PASSWORD)
    : await auth.register({
        name: "Demo Owner",
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        businessName: "Sundar Steel Traders",
      });

  logger.info({ tenantId: session.user.tenantId },
    existing ? "reusing the demo business" : "created the demo business");

  return {
    userId: session.user.userId,
    email: session.user.email,
    name: session.user.name,
    tenantId: session.user.tenantId,
    role: session.user.role,
    actor: "session",
  };
}

/**
 * Write the compliance rows a successful portal round-trip would have left.
 *
 * Marked `environment: "seed"` and given an IRN that is visibly not a real
 * 64-character hash, so nothing here can be confused for a document the
 * Government actually issued.
 */
async function markCompliant(
  container: Container,
  ctx: AuthContext,
  invoiceId: string,
  options: { withEwb?: boolean; distanceKm?: number; expiresInHours?: number; vehicleNo?: string },
): Promise<void> {
  const { database } = container;
  const [invoice] = await database.db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) return;

  const ackDate = invoice.invoiceDate;
  await database.db.insert(einvoices).values({
    tenantId: ctx.tenantId,
    invoiceId,
    gstin: invoice.billFrom.gstin ?? "",
    provider: "seed",
    environment: "seed",
    status: "generated",
    irn: `seed-${invoiceId.replace(/-/g, "")}`,
    ackNumber: String(112_000_000_000 + Math.floor(Number(invoice.grandTotal) % 900_000)),
    ackDate,
    signedInvoice: null,
    signedQrCode: null,
  }).onConflictDoNothing();

  await database.db.update(invoices)
    .set({ einvoiceStatus: "generated", status: invoice.status === "pending" ? "generated" : invoice.status })
    .where(eq(invoices.id, invoiceId));

  if (!options.withEwb) return;

  const generatedAt = invoice.invoiceDate;
  const validUntil = options.expiresInHours !== undefined
    ? new Date(Date.now() + options.expiresInHours * 3_600_000)
    : computeValidity({ distanceKm: options.distanceKm ?? 100, generatedAt }).validUntil;
  const expired = validUntil.getTime() < Date.now();

  await database.db.insert(ewayBills).values({
    tenantId: ctx.tenantId,
    invoiceId,
    gstin: invoice.billFrom.gstin ?? "",
    provider: "seed",
    environment: "seed",
    ewbNumber: String(391_000_000_000 + Math.floor(Math.abs(hash(invoiceId)) % 900_000_000)),
    status: expired ? "expired" : "generated",
    generatedAt,
    validFrom: generatedAt,
    validUntil,
    distanceKm: options.distanceKm ?? null,
    transporterName: "Deccan Roadlines",
    transportMode: 1,
    vehicleNo: options.vehicleNo ?? null,
    vehicleType: "R",
  }).onConflictDoNothing();

  await database.db.update(invoices)
    .set({ ewbStatus: expired ? "expired" : "generated" })
    .where(eq(invoices.id, invoiceId));
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
