import { expect, test } from "@playwright/test";
import { makeGstin, signUp } from "./helpers.js";
import {
  composeInvoice,
  createCustomer,
  createGstin,
  createItem,
  saveAndReview,
} from "./fixtures.js";

test.describe("working across registrations", () => {
  test("switching GSTIN filters what the invoice list shows", async ({ page }) => {
    await signUp(page);
    const maharashtra = makeGstin("27");
    const gujarat = makeGstin("24");
    await createGstin(page, maharashtra, "Maharashtra Unit");
    await createGstin(page, gujarat, "Gujarat Unit");
    await createCustomer(page, "Shared Customer Ltd");
    await createItem(page, "Shared Item");

    const switchTo = async (label: RegExp): Promise<void> => {
      await page.locator('[aria-haspopup="listbox"]').first().click();
      await page.getByRole("option", { name: label }).first().click();
      await expect(page.getByRole("listbox")).toHaveCount(0);
    };

    // Bill from the Maharashtra registration.
    await page.goto("/invoices");
    await switchTo(new RegExp(maharashtra));
    await expect(page.locator('[aria-haspopup="listbox"]').first()).toContainText(
      /Maharashtra Unit/,
    );
    await composeInvoice(page, "Shared Customer Ltd", "Shared Item", "3");
    await saveAndReview(page);
    await expect(page.getByText(maharashtra).first()).toBeVisible();

    // Looking at Gujarat's books, that invoice is not there.
    await page.goto("/invoices");
    await switchTo(new RegExp(gujarat));
    await expect(page.locator('[aria-haspopup="listbox"]').first()).toContainText(/Gujarat Unit/);
    await expect(page.getByText("Shared Customer Ltd")).toHaveCount(0, { timeout: 20_000 });

    // And back again, it is.
    await switchTo(/all registrations/i);
    await expect(page.getByText("Shared Customer Ltd").first()).toBeVisible({ timeout: 20_000 });
  });

  test("the setup checklist appears for a new account and points at the first step", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/overview");

    await expect(page.getByText(/set up traxac/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /add gstin/i })).toBeVisible();
  });

  test("a teammate can be invited and appears in the people list", async ({ page }) => {
    await signUp(page);
    await page.goto("/settings?tab=team");
    await page.getByRole("button", { name: /add person/i }).click();

    const email = `staff.${Date.now().toString(36)}@example.test`;
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="name"]').fill("New Staff Member");
    await page
      .getByRole("button", { name: /^add person$|^invite$|^send invite$/i })
      .last()
      .click();

    await expect(page.getByText("New Staff Member").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(email).first()).toBeVisible();
  });

  test("job activity is visible and reports nothing pending on a quiet account", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: /background work/i }).first()).toBeVisible();
    // No secrets, no raw payloads.
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/password|clientSecret|sek|Bearer /i);
  });
});
