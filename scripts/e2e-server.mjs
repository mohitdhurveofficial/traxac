/**
 * Boots the application the way production does, for browser tests.
 *
 * One process serving both the API and the built SPA on a single origin, so
 * the tests exercise the real routing rather than a dev proxy. The database is
 * a dedicated `traxac_e2e` so a test run can never touch development data.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env["E2E_PORT"] ?? "4319";
const databaseUrl = process.env["E2E_DATABASE_URL"] ?? "postgres://localhost:5432/traxac_e2e";

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

// The database is created if missing; `createdb` failing because it already
// exists is the normal case on a repeat run.
// Local convenience only: CI provisions the database as a service container,
// and `createdb` failing because it already exists is the normal case here.
try {
  execFileSync("createdb", [new URL(databaseUrl).pathname.slice(1)], { stdio: "ignore" });
} catch {
  /* already there, or createdb is not on PATH */
}

run("npx", ["tsx", "src/migrate.ts"], {
  cwd: resolve(root, "packages/database"),
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

if (!existsSync(resolve(root, "apps/web/dist/index.html"))) {
  run("pnpm", ["--filter", "@traxac/web", "build"]);
}

const env = {
  ...process.env,
  // Not "production": that mode rejects local file storage, and these tests
  // must not depend on an S3 bucket. The property under test is the
  // single-origin routing, which comes from WEB_DIST_PATH being set.
  NODE_ENV: "development",
  PORT: port,
  LOG_LEVEL: "warn",
  DATABASE_URL: databaseUrl,
  // Deterministic key: these are throwaway databases, and a rotating key
  // would make stored credentials unreadable between runs.
  TRAXAC_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
  TRAXAC_MASTER_KEY_VERSION: "1",
  COOKIE_SECURE: "false",
  // The suite signs in and registers repeatedly from one address; the real
  // limits (300/min global, 10 per 5 min on credentials) exist to stop
  // guessing attacks and stay in force everywhere else.
  RATE_LIMIT_MAX: "100000",
  AUTH_RATE_LIMIT_MAX: "100000",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "./.storage-e2e",
  WEB_DIST_PATH: "apps/web/dist",
  // Jobs are polled fast so a browser test does not sit waiting on a PDF.
  WORKER_POLL_INTERVAL_MS: "300",
};

const server = spawn("npx", ["tsx", "apps/api/src/server.ts"], { cwd: root, stdio: "inherit", env });
// The real deployment runs the worker as its own process; PDFs and other
// deferred work never happen without it, so the browser tests get one too.
const worker = spawn("npx", ["tsx", "apps/worker/src/worker.ts"], {
  cwd: root,
  stdio: "inherit",
  env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal);
    worker.kill(signal);
  });
}
server.on("exit", (code) => {
  worker.kill("SIGTERM");
  process.exit(code ?? 0);
});
