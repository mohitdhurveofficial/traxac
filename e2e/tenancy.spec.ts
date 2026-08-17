import { expect, test } from "@playwright/test";
import { makeGstin, newAccount, signUp } from "./helpers.js";
import {
  composeInvoice,
  createCustomer,
  createGstin,
  createItem,
  saveAndReview,
} from "./fixtures.js";

/**
 * Two businesses on one deployment.
 *
 * The service layer already has isolation tests; these prove the same holds
 * through the browser, where a stale link or a guessed id is the realistic
 * attack — and where a leak would be invisible to any server-side test.
 */
test.describe("tenant isolation", () => {
  test("one business cannot open another's invoice by its id", async ({ page, browser }) => {
    await signUp(page, newAccount("tenant-a"));
    await createGstin(page, makeGstin("27"), "Tenant A Steel");
    await createCustomer(page, "A Customer Ltd");
    await createItem(page, "A Item");
    await composeInvoice(page, "A Customer Ltd", "A Item", "5");
    const invoiceId = await saveAndReview(page);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage, newAccount("tenant-b"));

    // The direct link, exactly as it would be pasted from a chat message.
    await otherPage.goto(`/invoices/${invoiceId}`);
    await expect(otherPage.getByText("A Customer Ltd")).toHaveCount(0);
    await expect(
      otherPage.getByText(/no longer exists|not here|do not have access/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // And the API says the same thing, with no detail about what was asked for.
    const response = await otherPage.request.get(`/api/v1/invoices/${invoiceId}`);
    expect([403, 404]).toContain(response.status());
    expect(await response.text()).not.toContain("A Customer Ltd");
    await other.close();
  });

  test("one business never sees another's customers in search", async ({ page, browser }) => {
    await signUp(page, newAccount("tenant-c"));
    await createCustomer(page, "Confidential Buyer Pvt Ltd");

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage, newAccount("tenant-d"));
    await otherPage.goto("/customers");
    await otherPage.getByPlaceholder(/Name, GSTIN, city/i).fill("Confidential");
    await expect(otherPage.getByText("Confidential Buyer Pvt Ltd")).toHaveCount(0);
    await other.close();
  });

  test("invoice numbering restarts per business", async ({ page, browser }) => {
    await signUp(page, newAccount("tenant-e"));
    await createGstin(page, makeGstin("27"), "Tenant E Steel");
    await createCustomer(page, "E Customer Ltd");
    await createItem(page, "E Item");
    await composeInvoice(page, "E Customer Ltd", "E Item", "1");
    await saveAndReview(page);
    await page.getByRole("button", { name: "Issue invoice", exact: true }).first().click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: /issue/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.getByText(/\/0*1$/).first()).toBeVisible({ timeout: 20_000 });

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage, newAccount("tenant-f"));
    await createGstin(otherPage, makeGstin("27"), "Tenant F Steel");
    await createCustomer(otherPage, "F Customer Ltd");
    await createItem(otherPage, "F Item");
    await composeInvoice(otherPage, "F Customer Ltd", "F Item", "1");
    await saveAndReview(otherPage);
    await otherPage.getByRole("button", { name: "Issue invoice", exact: true }).first().click();
    const otherConfirm = otherPage
      .getByRole("dialog")
      .getByRole("button", { name: /issue/i })
      .last();
    if (await otherConfirm.isVisible().catch(() => false)) await otherConfirm.click();
    // Its own series, starting at one — not continuing the first business's.
    await expect(otherPage.getByText(/\/0*1$/).first()).toBeVisible({ timeout: 20_000 });
    await other.close();
  });
});
