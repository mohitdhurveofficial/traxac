import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level tests.
 *
 * These exist because unit tests could not have caught the failure that hurt
 * most: the SPA calling `/api/v1/...` while the server answered at `/v1/...`,
 * which produced no error anywhere — only a page that never filled in. Every
 * flow here is driven through the built application exactly as it is served
 * in production: one process, API and static assets on the same origin.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 4319);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    testIdAttribute: "data-testid",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_PORT: String(PORT) },
  },
});
