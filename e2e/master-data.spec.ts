import { expect, test } from "@playwright/test";
import { makeGstin, signUp } from "./helpers.js";
import { createCustomer, createItem } from "./fixtures.js";

test.describe("master data", () => {
  test("a customer can be created and opened", async ({ page }) => {
    await signUp(page);
    const gstin = makeGstin("27");
    await createCustomer(page, "Emirates Ispat Pvt Ltd", gstin);

    await page
      .getByRole("link", { name: /Emirates Ispat/ })
      .first()
      .click();
    await expect(page.getByText(gstin).first()).toBeVisible();
  });

  test("an item can be created and opened", async ({ page }) => {
    await signUp(page);
    await createItem(page, "Mill Scale");

    await page
      .getByRole("link", { name: /Mill Scale/ })
      .first()
      .click();
    await expect(page.getByText("26190090").first()).toBeVisible();
  });

  test("a malformed GSTIN is rejected before it can be saved", async ({ page }) => {
    await signUp(page);
    await page.goto("/customers");
    await page.getByRole("button", { name: "Add customer", exact: true }).last().click();
    await page.locator('input[name="name"]').fill("Bad GSTIN Traders");
    await page.locator('input[name="gstin"]').fill("27AAAAA0000A1Z9");
    await page.locator('select[name="stateCode"]').selectOption("27");
    await page.getByRole("button", { name: /save customer/i }).click();

    // Either the field or the banner must say so; what matters is that the
    // save did not silently succeed.
    await expect(page.getByText(/gstin/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /save customer/i })).toBeVisible();
  });

  test("suppliers are filtered separately from customers", async ({ page }) => {
    await signUp(page);
    await createCustomer(page, "Only A Customer Ltd");

    await page.goto("/customers");
    await page.getByRole("button", { name: "Suppliers", exact: true }).click();
    await expect(page.getByText("Only A Customer Ltd")).toHaveCount(0);

    await page.getByRole("button", { name: "Everyone", exact: true }).click();
    await expect(page.getByText("Only A Customer Ltd").first()).toBeVisible();
  });
});
