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

const CUSTOMER = "Emirates Ispat Pvt Ltd";
const ITEM = "Mill Scale";

/**
 * The path a real invoice takes.
 *
 * Compose, save, check the arithmetic, issue, get paid — driven entirely
 * through the interface, because that is the only way to prove the product
 * works rather than that the services do.
 */
test.describe("the invoice lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page);
    await createGstin(page, makeGstin("27"), "Probe Steel Works");
    await createCustomer(page, CUSTOMER, makeGstin("27"));
    await createItem(page, ITEM);
  });

  test("a draft can be saved, reopened, and still edited", async ({ page }) => {
    await composeInvoice(page, CUSTOMER, ITEM, "35.38");
    await page.getByRole("button", { name: /save draft/i }).click();
    // Saving a draft keeps the user in the editor, now with an id.
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 });

    await page.reload();
    // Quantities round-trip at the three decimals the UQC allows.
    await expect(page.getByTestId("line-quantity").first()).toHaveValue(/^35\.380?$/);
    await expect(page.getByText(CUSTOMER).first()).toBeVisible();
  });

  test("tax is split by place of supply, and the total is arithmetic", async ({ page }) => {
    await composeInvoice(page, CUSTOMER, ITEM, "10");
    await saveAndReview(page);

    const body = await page.locator("main").innerText();
    // 10 × ₹2,500 = ₹25,000 taxable, 18% within Maharashtra → CGST 9 + SGST 9.
    expect(body).toMatch(/25,000\.00/);
    expect(body).toMatch(/CGST/);
    expect(body).toMatch(/SGST/);
    expect(body).not.toMatch(/IGST/);
    expect(body).toMatch(/2,250\.00/);
    expect(body).toMatch(/29,500\.00/);
  });

  test("an interstate customer is taxed as IGST instead", async ({ page }) => {
    await page.goto("/customers");
    await page.getByRole("button", { name: "Add customer", exact: true }).last().click();
    await page.locator('input[name="name"]').fill("Gujarat Rolling Mills");
    await page.locator('select[name="stateCode"]').selectOption("24");
    await page.locator('input[name="addressLine1"]').fill("GIDC Phase 2");
    await page.locator('input[name="city"]').fill("Surat");
    await page.locator('input[name="pincode"]').fill("395003");
    await page.getByRole("button", { name: /save customer/i }).click();
    await expect(page.getByText("Gujarat Rolling Mills").first()).toBeVisible();

    await composeInvoice(page, "Gujarat Rolling Mills", ITEM, "10");
    await saveAndReview(page);

    const body = await page.locator("main").innerText();
    expect(body).toMatch(/IGST/);
    expect(body).not.toMatch(/CGST/);
    expect(body).toMatch(/4,500\.00/);
  });

  test("issuing assigns a number and closes editing", async ({ page }) => {
    await composeInvoice(page, CUSTOMER, ITEM, "10");
    await saveAndReview(page);
    await expect(page.getByText(/draft/i).first()).toBeVisible();

    await issue(page);

    // A numbered invoice, and no way back into the editor.
    await expect(page.getByText(/INV\/\d{4}-\d{2}\/\d+/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  });

  test("a payment can be recorded against an issued invoice", async ({ page }) => {
    await composeInvoice(page, CUSTOMER, ITEM, "10");
    await saveAndReview(page);
    await issue(page);

    await page
      .getByRole("button", { name: /record payment/i })
      .first()
      .click();
    // Scoped to the dialog: the button that opened it carries the same name.
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="amount"]').fill("29500");
    await dialog.getByRole("button", { name: "Record", exact: true }).click();

    await expect(page.getByText(/^Paid$/).first()).toBeVisible({ timeout: 20_000 });
  });

  test("an attachment can be uploaded and is listed against the invoice", async ({ page }) => {
    await composeInvoice(page, CUSTOMER, ITEM, "10");
    await saveAndReview(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: "purchase-order.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% e2e fixture\n"),
    });

    await expect(page.getByText("purchase-order.pdf").first()).toBeVisible({ timeout: 25_000 });
  });

  test("the invoice list finds an invoice and filters it away again", async ({ page }) => {
    await composeInvoice(page, CUSTOMER, ITEM, "10");
    await saveAndReview(page);

    await page.goto("/invoices");
    const search = page.getByPlaceholder(/Invoice no, customer/i);
    await search.fill("Emirates");
    await expect(page.getByText(CUSTOMER).first()).toBeVisible({ timeout: 20_000 });

    await search.fill("No Such Business Anywhere");
    await expect(page.getByText(CUSTOMER)).toHaveCount(0, { timeout: 20_000 });
  });

  test("the history records who did what", async ({ page }) => {
    await composeInvoice(page, CUSTOMER, ITEM, "10");
    await saveAndReview(page);
    await issue(page);

    const history = page.getByText(/history/i).first();
    await expect(history).toBeVisible();
    const body = await page.locator("main").innerText();
    expect(body).toMatch(/draft created/i);
    expect(body).toMatch(/issued|finalis|finaliz/i);
  });
});
