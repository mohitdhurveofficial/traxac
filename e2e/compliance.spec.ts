import { expect, test } from "@playwright/test";
import { makeGstin, signUp } from "./helpers.js";
import {
  composeInvoice,
  createCustomer,
  createGstin,
  createItem,
  issue,
  saveAndReview,
} from "./fixtures.js";

/**
 * What the product says about compliance before any portal is connected.
 *
 * The rule this guards: with no GST credentials saved, the application must
 * say so plainly and must not offer an action that can only fail. It must
 * never display an IRN or an e-Way Bill number, because none exists.
 */
test.describe("compliance state without a portal connection", () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page);
    await createGstin(page, makeGstin("27"), "Unconnected Steel");
    await createCustomer(page, "Emirates Ispat Pvt Ltd", makeGstin("27"));
    await createItem(page, "Mill Scale", "900000");
  });

  test("an issued invoice says the portal is not connected", async ({ page }) => {
    await composeInvoice(page, "Emirates Ispat Pvt Ltd", "Mill Scale", "10");
    await saveAndReview(page);
    await issue(page);

    await expect(page.getByText(/gst portal not connected/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /connect gst portal/i })).toBeVisible();

    // Nothing may look like a real government identifier.
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/\bIRN\b\s*[:#]?\s*[0-9a-f]{64}/i);
    expect(body).not.toMatch(/e-Way Bill\s*[:#]?\s*\d{12}/i);
  });

  test("no portal action is offered that could only fail", async ({ page }) => {
    await composeInvoice(page, "Emirates Ispat Pvt Ltd", "Mill Scale", "10");
    await saveAndReview(page);
    await issue(page);

    await expect(page.getByRole("button", { name: /generate e-invoice/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /generate e-way bill/i })).toHaveCount(0);
  });

  test("the GST connection screen leads with the fact that it is optional", async ({ page }) => {
    await page.goto("/settings?tab=gst");
    await expect(page.getByText(/you do not need this/i).first()).toBeVisible();
  });

  test("GSTR-1 preparation never claims to have filed anything", async ({ page }) => {
    await composeInvoice(page, "Emirates Ispat Pvt Ltd", "Mill Scale", "10");
    await saveAndReview(page);
    await issue(page);

    await page.goto("/reports");
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/filed with the government|submitted to gstn|return filed/i);
  });
});

test.describe("error handling", () => {
  test("a failed action reports itself in plain language, with no internals", async ({ page }) => {
    await signUp(page);
    await page.goto("/customers");

    // Force a server failure on the next save.
    await page.route("**/api/v1/parties", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "INTERNAL", message: "…", requestId: "req-e2e-1234" },
        }),
      });
    });

    await page.getByRole("button", { name: "Add customer", exact: true }).last().click();
    await page.locator('input[name="name"]').fill("Doomed Trader");
    await page.locator('select[name="stateCode"]').selectOption("27");
    await page.getByRole("button", { name: /save customer/i }).click();

    const alert = page.getByRole("alert").first();
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/something went wrong on our side/i);
    await expect(alert).not.toContainText(/at .*:\d+|node_modules|fastify|select |INTERNAL/i);
  });

  test("a validation failure is shown against the fields, not as a scary banner", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/items");
    await page.getByRole("button", { name: "Add item", exact: true }).last().click();
    await page.locator('input[name="name"]').fill("No HSN Item");
    await page.locator('input[name="hsnSac"]').fill("1");
    await page.getByRole("button", { name: /save item/i }).click();

    await expect(page.getByText(/need|fix|invalid|hsn/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/something went wrong on our side/i)).toHaveCount(0);
  });

  test("going offline is announced, and a queued save says so", async ({ page, context }) => {
    await signUp(page);
    await page.goto("/customers");
    await page.getByRole("button", { name: "Add customer", exact: true }).last().click();
    await page.locator('input[name="name"]').fill("Offline Trader");
    await page.locator('select[name="stateCode"]').selectOption("27");

    await context.setOffline(true);
    await expect(page.getByText(/you are offline/i).first()).toBeVisible({ timeout: 15_000 });

    // React Query holds the mutation until the connection is back; the button
    // must say that rather than appearing to do nothing.
    await page.getByRole("button", { name: /save customer/i }).click();
    await expect(page.getByRole("button", { name: /waiting for connection/i })).toBeVisible({
      timeout: 15_000,
    });

    // Reconnecting completes the save that was queued.
    await context.setOffline(false);
    await expect(page.getByText("Offline Trader").first()).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/you are offline/i)).toHaveCount(0);
  });
});
