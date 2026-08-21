/**
 * Load test.
 *
 * Exercises the paths a busy office actually hammers: signing in, opening the
 * invoice list, searching for a customer or product, and raising an invoice.
 * Reads and writes are measured separately because they have very different
 * budgets — a list must feel instant, a write only has to feel prompt.
 *
 *   pnpm load:seed -- --tenants 25 --invoices 200
 *   pnpm load:run
 *
 * Requires the API to be running.
 */
import autocannon, { type Result } from "autocannon";

const BASE = process.env["LOAD_TARGET"] ?? "http://localhost:3000";
const DURATION = Number(process.env["LOAD_DURATION"] ?? 10);
const CONNECTIONS = Number(process.env["LOAD_CONNECTIONS"] ?? 20);

interface Scenario {
  name: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** Reads should be quick; writes do real work. */
  budgetMs: number;
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Sign-in failed for ${email}: HTTP ${response.status}`);
  }
  const cookie = response.headers.get("set-cookie");
  const match = cookie?.match(/ewayvo_session=([^;]+)/);
  if (!match) throw new Error("No session cookie returned");
  return `ewayvo_session=${match[1]}`;
}

async function run(scenario: Scenario, cookie: string): Promise<Result> {
  return autocannon({
    url: `${BASE}${scenario.path}`,
    method: scenario.method ?? "GET",
    connections: CONNECTIONS,
    duration: DURATION,
    headers: {
      cookie,
      ...(scenario.body ? { "content-type": "application/json" } : {}),
    },
    ...(scenario.body ? { body: JSON.stringify(scenario.body) } : {}),
  });
}

async function main(): Promise<void> {
  console.log(`[load] target ${BASE}, ${CONNECTIONS} connections, ${DURATION}s per scenario`);
  console.log(
    "[load] the API must be started with a raised ceiling, e.g. " +
      "RATE_LIMIT_MAX=1000000 pnpm start — otherwise every request is rate limited\n",
  );

  // Two tenants so the run is genuinely multi-tenant rather than one hot set
  // of rows sitting in cache.
  const cookies: string[] = [];
  for (const email of ["load0@load.test", "load1@load.test"]) {
    try {
      cookies.push(await signIn(email, "LoadTestPassw0rd!"));
    } catch {
      // Fall back to the demo account so the script is useful before seeding.
    }
  }
  if (cookies.length === 0) {
    cookies.push(await signIn("owner@demo.ewayvo.in", "EwayvoDemo2026!"));
    console.log("[load] using the demo account — run `pnpm load:seed` for a realistic dataset\n");
  }

  /*
   * The write scenario is pinned to one tenant and its own registration.
   *
   * Rotating cookies across scenarios while reusing a single GSTIN id sends
   * tenant B a reference to tenant A's registration, which the API correctly
   * rejects — the load run then measures 404s rather than throughput.
   */
  const writeCookie = cookies[0]!;
  const gstinResponse = await fetch(`${BASE}/api/v1/gstins`, { headers: { cookie: writeCookie } });
  const gstins = (await gstinResponse.json()) as { items: Array<{ id: string }> };
  const gstinId = gstins.items[0]?.id;

  const scenarios: Scenario[] = [
    { name: "auth: whoami", path: "/api/v1/auth/me", budgetMs: 100 },
    { name: "invoices: first page", path: "/api/v1/invoices?limit=25&page=1", budgetMs: 300 },
    { name: "invoices: deep page", path: "/api/v1/invoices?limit=25&page=8", budgetMs: 400 },
    { name: "invoices: text search", path: "/api/v1/invoices?q=Customer&limit=25", budgetMs: 500 },
    {
      name: "invoices: status filter",
      path: "/api/v1/invoices?status=pending&limit=25",
      budgetMs: 300,
    },
    { name: "customers: search", path: "/api/v1/parties?q=Customer&limit=25", budgetMs: 250 },
    { name: "products: search", path: "/api/v1/products?q=Bar&limit=25", budgetMs: 250 },
    { name: "dashboard", path: "/api/v1/reports/dashboard", budgetMs: 600 },
    { name: "receivables", path: "/api/v1/receivables", budgetMs: 600 },
  ];

  if (gstinId) {
    scenarios.push({
      name: "invoice: tax preview",
      path: "/api/v1/invoices/preview",
      method: "POST",
      budgetMs: 200,
      body: {
        gstinId,
        placeOfSupply: "27",
        supplyCategory: "b2b",
        lines: [
          {
            name: "Load item",
            hsnSac: "72169910",
            quantity: 5,
            unit: "MTS",
            unitPrice: 62500,
            gstRate: 18,
          },
        ],
        charges: [],
      },
    });
  }

  const failures: string[] = [];
  console.log(
    "  scenario".padEnd(30) +
      "req/s".padStart(9) +
      "p50".padStart(8) +
      "p99".padStart(8) +
      "errors".padStart(9) +
      "  budget",
  );
  console.log("  " + "-".repeat(70));

  for (const scenario of scenarios) {
    // Reads rotate across tenants so the run is genuinely multi-tenant;
    // the write stays with the tenant whose registration it references.
    const cookie =
      scenario.method === "POST"
        ? writeCookie
        : cookies[scenarios.indexOf(scenario) % cookies.length]!;
    const result = await run(scenario, cookie);
    const p50 = result.latency.p50;
    const p99 = result.latency.p99;
    const errors = result.non2xx + result.errors;
    const withinBudget = p99 <= scenario.budgetMs && errors === 0;
    if (!withinBudget) {
      failures.push(
        `${scenario.name}: p99 ${p99}ms (budget ${scenario.budgetMs}ms), ${errors} errors`,
      );
    }
    console.log(
      `  ${scenario.name}`.padEnd(30) +
        String(Math.round(result.requests.average)).padStart(9) +
        `${p50}ms`.padStart(8) +
        `${p99}ms`.padStart(8) +
        String(errors).padStart(9) +
        `  ${scenario.budgetMs}ms ${withinBudget ? "ok" : "OVER"}`,
    );
  }

  console.log("");
  if (failures.length) {
    console.log("[load] scenarios outside budget:");
    for (const failure of failures) console.log(`         ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("[load] every scenario within budget");
  }
}

main().catch((err) => {
  console.error("[load] failed:", err);
  process.exit(1);
});
