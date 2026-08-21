import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createContainer,
  resetConfigCache,
  resolveFromRepoRoot,
  type AuthContext,
  type Container,
} from "../src/index.js";

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
  process.env["TEST_DATABASE_URL"] ?? "postgres://localhost:5432/ewayvo_test";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

let migrated = false;

export async function testContainer(
  overrides: Partial<Record<string, unknown>> = {},
  registry?: Parameters<typeof createContainer>[0]["registry"],
): Promise<Container> {
  if (!migrated) {
    await execFileAsync("npx", ["tsx", "src/migrate.ts"], {
      cwd: resolve(here, "../../database"),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
    migrated = true;
  }

  resetConfigCache();
  const base = {
    NODE_ENV: "test",
    PORT: 0,
    LOG_LEVEL: "error",
    DATABASE_URL: TEST_DATABASE_URL,
    // Every unit of work now holds a connection for its duration (the tenant
    // GUC is transaction-local), so the pool must exceed the concurrency the
    // tests exercise — the numbering test alone finalizes 12 invoices at once.
    DATABASE_POOL_MAX: 30,
    EWAYVO_MASTER_KEY: TEST_KEY,
    EWAYVO_MASTER_KEY_VERSION: 1,
    EWAYVO_MASTER_KEY_PREVIOUS: undefined,
    SESSION_TTL_DAYS: 7,
    RATE_LIMIT_MAX: undefined,
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
    NIC_CLIENT_ID: undefined,
    NIC_CLIENT_SECRET: undefined,
    NIC_PUBLIC_KEY_SANDBOX: undefined,
    NIC_PUBLIC_KEY_PRODUCTION: undefined,
    NIC_IRP_SANDBOX_BASE_URL: undefined,
    NIC_IRP_PRODUCTION_BASE_URL: undefined,
    NIC_EWB_SANDBOX_BASE_URL: undefined,
    NIC_EWB_PRODUCTION_BASE_URL: undefined,
    WEB_DIST_PATH: undefined,
    RAILWAY_REPLICA_ID: undefined,
    GATEWAY_TIMEOUT_MS: 5000,
    WORKER_CONCURRENCY: 1,
    WORKER_POLL_INTERVAL_MS: 1000,
    APP_URL: "http://localhost:5173",
    API_URL: "http://localhost:3000",
    isProduction: false,
    isDevelopment: false,
    isTest: true,
    corsOrigins: [],
    cookieSecure: false,
    storageLocalDir: resolveFromRepoRoot(".storage-test"),
    webDistPath: resolveFromRepoRoot("apps/web/dist"),
  };

  const merged = { ...base, ...overrides } as Record<string, unknown>;

  // Derived fields must follow their source. `loadConfig` normally computes
  // these; a test that overrides WEB_DIST_PATH or STORAGE_LOCAL_DIR expects
  // the derived path to change with it.
  merged["cookieSecure"] = merged["NODE_ENV"] === "production" || merged["COOKIE_SECURE"] === true;
  const storageDir = merged["STORAGE_LOCAL_DIR"];
  merged["storageLocalDir"] = resolveFromRepoRoot(
    typeof storageDir === "string" ? storageDir : ".storage-test",
  );
  const webDist = merged["WEB_DIST_PATH"];
  merged["webDistPath"] = resolveFromRepoRoot(
    typeof webDist === "string" && webDist ? webDist : "apps/web/dist",
  );

  const config = merged as Parameters<typeof createContainer>[0]["config"];
  const container = createContainer(
    registry
      ? { processName: "ewayvo-test", config, registry }
      : { processName: "ewayvo-test", config },
  );
  return withTestScopes(container);
}

/**
 * Give test service calls the same database scope the API gives real requests.
 *
 * In production a Fastify `onRoute` wrapper opens a transaction, sets
 * `traxac.tenant_id` on it and publishes it as the ambient scope; services
 * then resolve their executor from that scope and throw if it is missing.
 * Tests call services directly, so without an equivalent every call would
 * fail closed.
 *
 * Rather than weaken the guard for tests, the harness reproduces the wrapper.
 * The tenant is taken from the `AuthContext` the test already passes as the
 * first argument — exactly the value the API takes from the resolved session —
 * so these tests now exercise the real RLS path rather than bypassing it.
 * A call with no AuthContext is platform-level and gets a system scope, which
 * is what the equivalent production path does.
 */
function withTestScopes(container: Container): Container {
  const scoped = new Map<string, unknown>();

  return new Proxy(container, {
    get(target, prop: string, receiver) {
      const value = Reflect.get(target, prop, receiver);
      // Only service objects are wrapped; config, logger, database and the
      // like must stay exactly as they are.
      if (!value || typeof value !== "object" || prop === "database" || prop === "config") {
        return value;
      }
      if (scoped.has(prop)) return scoped.get(prop);

      const wrapped = new Proxy(value as Record<string, unknown>, {
        get(svc, method: string, svcReceiver) {
          const fn = Reflect.get(svc, method, svcReceiver);
          if (typeof fn !== "function") return fn;
          /*
           * Synchronous methods cannot perform database I/O — every drizzle
           * query is async — so they need no scope, and wrapping them would
           * turn a plain return value into a promise the caller never awaits.
           */
          if (fn.constructor.name !== "AsyncFunction") {
            return (...args: unknown[]) => Reflect.apply(fn, svc, args) as unknown;
          }
          return (...args: unknown[]) => {
            const first = args[0] as { tenantId?: string } | undefined;
            const tenantId =
              first && typeof first === "object" && typeof first.tenantId === "string"
                ? first.tenantId
                : undefined;
            const origin = `test:${prop}.${method}`;
            /*
             * Mirrors the worker: a service that records failure state and
             * then throws must keep that state. Catching inside the scope
             * lets the transaction commit before the error is rethrown, which
             * is what production does — otherwise these tests would pass
             * against semantics the real system does not have.
             */
            const capture = async (): Promise<
              { ok: true; value: unknown } | { ok: false; error: unknown }
            > => {
              try {
                return { ok: true, value: await Reflect.apply(fn, svc, args) };
              } catch (error) {
                return { ok: false, error };
              }
            };
            const settle = (
              outcome: { ok: true; value: unknown } | { ok: false; error: unknown },
            ): unknown => {
              if (!outcome.ok) throw outcome.error;
              return outcome.value;
            };
            return tenantId
              ? container.database.withTenantScope(tenantId, origin, capture).then(settle)
              : container.database.withSystemScope(origin, capture).then(settle);
          };
        },
      });
      scoped.set(prop, wrapped);
      return wrapped;
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

  return {
    ctx,
    tenantId: ctx.tenantId,
    gstinId: gstin.id,
    partyId: party.id,
    productId: product.id,
  };
}

/** Minimal valid invoice input for the given business. */
export function invoiceInput(business: TestBusiness, overrides: Record<string, unknown> = {}) {
  return {
    gstinId: business.gstinId,
    branchId: null,
    docType: "invoice" as const,
    // Series is deliberately omitted: the document type picks its own default
    // (INV / CRN / DBN), which is the behaviour worth exercising.
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
    lines: [
      {
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
      },
    ],
    charges: [],
    poNumber: "",
    notes: "",
    terms: "",
    ...overrides,
  } as never;
}
