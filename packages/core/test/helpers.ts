import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, resetConfigCache, type AuthContext, type Container } from "../src/index.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Integration-test harness.
 *
 * These tests run against a real Postgres because the properties they check —
 * tenant isolation and number allocation under concurrency — are enforced by
 * SQL predicates and row locks. A mocked database would assert nothing.
 */
export const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgres://localhost:5432/traxac_test";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

let migrated = false;

export async function testContainer(): Promise<Container> {
  if (!migrated) {
    await execFileAsync("npx", ["tsx", "src/migrate.ts"], {
      cwd: resolve(here, "../../database"),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
    migrated = true;
  }

  resetConfigCache();
  return createContainer({
    processName: "traxac-test",
    config: {
      NODE_ENV: "test",
      PORT: 0,
      LOG_LEVEL: "error",
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_POOL_MAX: 5,
      TRAXAC_MASTER_KEY: TEST_KEY,
      TRAXAC_MASTER_KEY_VERSION: 1,
      TRAXAC_MASTER_KEY_PREVIOUS: undefined,
      SESSION_TTL_DAYS: 7,
      CORS_ORIGINS: "",
      COOKIE_DOMAIN: undefined,
      COOKIE_SECURE: false,
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: "./.storage-test",
      S3_BUCKET: undefined,
      S3_REGION: "auto",
      S3_ENDPOINT: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      S3_FORCE_PATH_STYLE: true,
      GST_ENVIRONMENT: "sandbox",
      IRP_SANDBOX_BASE_URL: "https://einv-apisandbox.nic.in",
      IRP_PRODUCTION_BASE_URL: "https://einvoice1.gst.gov.in",
      EWB_SANDBOX_BASE_URL: "https://einv-apisandbox.nic.in",
      EWB_PRODUCTION_BASE_URL: "https://ewaybillgst.gov.in",
      NIC_CLIENT_ID: undefined,
      NIC_CLIENT_SECRET: undefined,
      GATEWAY_TIMEOUT_MS: 5000,
      WORKER_CONCURRENCY: 1,
      WORKER_POLL_INTERVAL_MS: 1000,
      APP_URL: "http://localhost:5173",
      API_URL: "http://localhost:3000",
      isProduction: false,
      isDevelopment: false,
      isTest: true,
      corsOrigins: [],
    },
  });
}

/** Wipe every tenant-owned table between tests. */
export async function resetDatabase(container: Container): Promise<void> {
  await container.database.client.unsafe(`
    TRUNCATE tenants, users, hsn_codes, units RESTART IDENTITY CASCADE
  `);
}

export interface TestBusiness {
  ctx: AuthContext;
  tenantId: string;
  gstinId: string;
  partyId: string;
  productId: string;
}

/** Create an isolated business with one GSTIN, one customer and one product. */
export async function createBusiness(
  container: Container,
  options: { slug: string; gstin: string; stateCode: string },
): Promise<TestBusiness> {
  const registered = await container.auth.register({
    name: `${options.slug} owner`,
    email: `${options.slug}@example.test`,
    password: "TestPassword123!",
    businessName: `${options.slug} Traders`,
  });

  const ctx: AuthContext = {
    userId: registered.user.userId,
    email: registered.user.email,
    name: registered.user.name,
    tenantId: registered.user.tenantId,
    role: "owner",
    actor: "session",
  };

  const gstin = await container.masters.createGstin(ctx, {
    gstin: options.gstin,
    legalName: `${options.slug} Traders LLP`,
    tradeName: `${options.slug} Traders`,
    registrationType: "regular",
    addressLine1: "1 Test Road",
    addressLine2: "",
    city: "Testville",
    stateCode: options.stateCode,
    pincode: "400001",
    phone: "",
    email: "",
    einvoiceEnabled: true,
    ewbEnabled: true,
    isPrimary: true,
  });

  const party = await container.masters.createParty(ctx, {
    name: `${options.slug} customer`,
    legalName: "",
    partyType: "customer",
    gstin: "",
    pan: "",
    registrationType: "unregistered",
    email: "",
    phone: "",
    addressLine1: "2 Buyer Street",
    addressLine2: "",
    city: "Buyertown",
    stateCode: options.stateCode,
    pincode: "560001",
    country: "IN",
    defaultPlaceOfSupply: options.stateCode,
    notes: "",
  });

  const product = await container.masters.createProduct(ctx, {
    name: `${options.slug} widget`,
    description: "",
    sku: "",
    hsnSac: "7308",
    isService: false,
    gstRate: 18,
    cessRate: 0,
    unit: "NOS",
    unitPrice: 1000,
  });

  return { ctx, tenantId: ctx.tenantId, gstinId: gstin.id, partyId: party.id, productId: product.id };
}

/** Minimal valid invoice input for the given business. */
export function invoiceInput(business: TestBusiness, overrides: Record<string, unknown> = {}) {
  return {
    gstinId: business.gstinId,
    branchId: null,
    docType: "invoice" as const,
    series: "INV",
    invoiceNumber: "",
    invoiceDate: new Date("2026-08-17T06:00:00Z"),
    dueDate: null,
    buyerPartyId: business.partyId,
    shipToAddressId: null,
    dispatchFromBranchId: null,
    supplyCategory: "b2b" as const,
    placeOfSupply: "27",
    reverseCharge: false,
    igstOnIntra: false,
    currency: "INR",
    exchangeRate: 1,
    lines: [{
      productId: business.productId,
      name: "Widget",
      description: "",
      hsnSac: "7308",
      isService: false,
      quantity: 2,
      unit: "NOS",
      unitPrice: 1000,
      discountPercent: 0,
      discountAmount: 0,
      gstRate: 18,
      cessRate: 0,
      cessNonAdvol: 0,
      stateCess: 0,
      batchNo: "",
      barcode: "",
      expiryDate: null,
    }],
    charges: [],
    poNumber: "",
    notes: "",
    terms: "",
    ...overrides,
  } as never;
}
