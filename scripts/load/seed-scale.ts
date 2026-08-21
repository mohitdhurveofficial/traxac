/**
 * Seed a realistic multi-tenant workload.
 *
 * The point is to make the query planner behave the way it will in
 * production: many tenants, a wide spread of invoices per tenant, and enough
 * rows that an unindexed scan actually hurts. A single fat tenant would not
 * exercise the tenant predicate at all.
 *
 *   pnpm load:seed -- --tenants 50 --invoices 200
 */
import { createContainer, type AuthContext, type Container } from "@ewayvo/core";

interface Options {
  tenants: number;
  invoicesPerTenant: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const read = (flag: string, fallback: number): number => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = Number(args[index + 1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return { tenants: read("--tenants", 25), invoicesPerTenant: read("--invoices", 100) };
}

const STATES = ["27", "29", "24", "33", "07", "19", "36", "23"] as const;
const ITEMS = [
  { name: "MS Structural Beam", hsn: "72169910", unit: "MTS", price: 62_500 },
  { name: "TMT Bar Fe500D", hsn: "72142090", unit: "MTS", price: 54_900 },
  { name: "HT Bolt M20", hsn: "73181500", unit: "NOS", price: 48 },
  { name: "Binding Wire", hsn: "72179099", unit: "KGS", price: 82 },
  { name: "Red Oxide Primer", hsn: "32081090", unit: "CAN", price: 3_150 },
];

async function main(): Promise<void> {
  const options = parseArgs();
  const container = createContainer({ processName: "ewayvo-load-seed" });
  const startedAt = Date.now();

  console.log(
    `[load] seeding ${options.tenants} businesses × ${options.invoicesPerTenant} invoices ` +
      `(~${(options.tenants * options.invoicesPerTenant).toLocaleString("en-IN")} invoices)`,
  );

  try {
    for (let t = 0; t < options.tenants; t++) {
      const ctx = await createTenant(container, t);
      await seedTenant(container, ctx, t, options.invoicesPerTenant);
      if ((t + 1) % 5 === 0 || t === options.tenants - 1) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`[load] ${t + 1}/${options.tenants} businesses seeded (${elapsed}s)`);
      }
    }

    const counts = await container.database.client<Array<{ table: string; n: string }>>`
      SELECT 'tenants' AS table, count(*)::text AS n FROM tenants
      UNION ALL SELECT 'invoices', count(*)::text FROM invoices
      UNION ALL SELECT 'invoice_lines', count(*)::text FROM invoice_lines
      UNION ALL SELECT 'parties', count(*)::text FROM parties
      UNION ALL SELECT 'products', count(*)::text FROM products
    `;
    console.log("[load] database now holds:");
    for (const row of counts) console.log(`         ${row.table.padEnd(15)} ${row.n}`);

    // The planner needs current statistics or it will pick sequential scans
    // on tables that just grew by two orders of magnitude.
    await container.database.client.unsafe("ANALYZE");
    console.log("[load] ANALYZE complete");
  } finally {
    await container.shutdown();
  }
}

async function createTenant(container: Container, index: number): Promise<AuthContext> {
  const slug = `load${index}`;
  const registered = await container.auth.register({
    name: `Load Owner ${index}`,
    email: `${slug}@load.test`,
    password: "LoadTestPassw0rd!",
    businessName: `Load Traders ${index}`,
  });
  return {
    userId: registered.user.userId,
    email: registered.user.email,
    name: registered.user.name,
    tenantId: registered.user.tenantId,
    role: "owner",
    actor: "session",
  };
}

async function seedTenant(
  container: Container,
  ctx: AuthContext,
  index: number,
  invoiceCount: number,
): Promise<void> {
  const stateCode = STATES[index % STATES.length] as string;
  const gstin = await container.masters.createGstin(ctx, {
    gstin: syntheticGstin(stateCode, index),
    legalName: `Load Traders ${index} LLP`,
    tradeName: `Load Traders ${index}`,
    registrationType: "regular",
    addressLine1: `Unit ${index}, Industrial Estate`,
    addressLine2: "",
    city: "Testville",
    stateCode,
    pincode: "400001",
    phone: "",
    email: "",
    einvoiceEnabled: true,
    ewbEnabled: true,
    isPrimary: true,
  });

  // A realistic spread: a few customers take most of the invoices.
  const customers: Array<{ id: string; defaultPlaceOfSupply: string | null }> = [];
  for (let c = 0; c < 12; c++) {
    customers.push(
      await container.masters.createParty(ctx, {
        name: `Customer ${index}-${c}`,
        legalName: "",
        partyType: "customer",
        gstin: "",
        pan: "",
        registrationType: "unregistered",
        email: "",
        phone: `98${String(index).padStart(4, "0")}${String(c).padStart(4, "0")}`,
        addressLine1: `${c} Market Road`,
        addressLine2: "",
        city: "Buyertown",
        stateCode: STATES[(index + c) % STATES.length],
        pincode: "560001",
        country: "IN",
        defaultPlaceOfSupply: STATES[(index + c) % STATES.length],
        notes: "",
      }),
    );
  }

  const products: Array<{ id: string }> = [];
  for (const item of ITEMS) {
    products.push(
      await container.masters.createProduct(ctx, {
        name: item.name,
        description: "",
        sku: "",
        hsnSac: item.hsn,
        isService: false,
        gstRate: 18,
        cessRate: 0,
        unit: item.unit,
        unitPrice: item.price,
      }),
    );
  }

  for (let i = 0; i < invoiceCount; i++) {
    const customer = customers[i % customers.length]!;
    const lineCount = 1 + (i % 4);
    const draft = await container.invoices.createDraft(ctx, {
      gstinId: gstin.id,
      branchId: null,
      docType: "invoice",
      invoiceNumber: "",
      // Spread across a year so date-range queries have work to do.
      invoiceDate: new Date(Date.now() - (i % 365) * 86_400_000),
      dueDate: null,
      buyerPartyId: customer.id,
      shipToAddressId: null,
      dispatchFromBranchId: null,
      supplyCategory: "b2b",
      placeOfSupply: customer.defaultPlaceOfSupply ?? stateCode,
      reverseCharge: false,
      igstOnIntra: false,
      currency: "INR",
      exchangeRate: 1,
      lines: Array.from({ length: lineCount }, (_, l) => {
        const item = ITEMS[(i + l) % ITEMS.length]!;
        return {
          productId: products[(i + l) % products.length]!.id,
          name: item.name,
          description: "",
          hsnSac: item.hsn,
          isService: false,
          quantity: 1 + ((i + l) % 20),
          unit: item.unit,
          unitPrice: item.price,
          discountPercent: 0,
          discountAmount: 0,
          gstRate: 18,
          cessRate: 0,
          cessNonAdvol: 0,
          stateCess: 0,
          batchNo: "",
          barcode: "",
          expiryDate: null,
        };
      }),
      charges: [],
      poNumber: "",
      notes: "",
      terms: "",
    } as never);

    // Most invoices are issued; a few stay draft, as in real books.
    if (i % 10 !== 0) await container.invoices.finalize(ctx, draft.invoice.id);
  }
}

/** A checksum-valid but entirely synthetic GSTIN. */
function syntheticGstin(stateCode: string, index: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const body = `AAA${String.fromCharCode(65 + (index % 26))}A${String(1000 + (index % 9000))}A1Z`;
  const base = `${stateCode}${body}`.slice(0, 14).padEnd(14, "A");
  let factor = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    const value = chars.indexOf(base[i] as string) * factor;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(value / 36) + (value % 36);
  }
  return base + chars[(36 - (sum % 36)) % 36];
}

main().catch((err) => {
  console.error("[load] seed failed:", err);
  process.exit(1);
});
