import { expect, test } from "@playwright/test";
import { login, newAccount, signUp } from "./helpers.js";

test.describe("signing in", () => {
  test("a new business can sign up and lands in the app", async ({ page }) => {
    const account = newAccount("signup");
    await page.goto("/login");
    await page.getByRole("button", { name: /create an account/i }).click();
    await page.getByLabel(/your name/i).fill(account.name);
    await page.getByLabel(/business name/i).fill(account.businessName);
    await page.getByLabel(/email/i).fill(account.email);
    await page.getByLabel(/password/i).fill(account.password);
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/invoices/);
    await expect(page.getByRole("link", { name: /customers/i })).toBeVisible();
  });

  test("an existing user can sign in and out", async ({ page }) => {
    const account = await signUp(page);
    await page.goto("/settings?tab=security");
    await page
      .getByRole("button", { name: /sign out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, account);
    await expect(page).toHaveURL(/\/invoices/);
  });

  test("a wrong password is refused without revealing whether the account exists", async ({
    page,
  }) => {
    const account = await signUp(page);
    await page.goto("/settings?tab=security");
    await page
      .getByRole("button", { name: /sign out/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, { ...account, password: "definitely-not-it" });
    const alert = page.getByRole("alert").first();
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/not found|no such|unknown user/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("an expired session drops the user back to sign-in", async ({ page, context }) => {
    await signUp(page);
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: /customers/i }).first()).toBeVisible();

    // Exactly what happens when the cookie lapses server-side.
    await context.clearCookies();
    await page.getByRole("link", { name: /items/i }).click();

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
