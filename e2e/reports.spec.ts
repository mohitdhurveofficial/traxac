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

test.describe("reports and documents", () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page);
    await createGstin(page, makeGstin("27"), "Reporting Steel");
    await createCustomer(page, "Emirates Ispat Pvt Ltd", makeGstin("27"));
    await createItem(page, "Mill Scale");
    await composeInvoice(page, "Emirates Ispat Pvt Ltd", "Mill Scale", "10");
    await saveAndReview(page);
    await issue(page);
  });

  test("the invoice appears in the sales report and the totals agree", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByText(/29,500/).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "By customer", exact: true }).click();
    await expect(page.getByText("Emirates Ispat Pvt Ltd").first()).toBeVisible();
  });

  test("a report can be downloaded as CSV", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("button", { name: "Sales register", exact: true }).click();

    const download = page.waitForEvent("download", { timeout: 25_000 });
    await page
      .getByRole("button", { name: /download|csv/i })
      .first()
      .click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
  });

  test("issuing an invoice produces a PDF, with no portal connection", async ({ page }) => {
    const invoiceId = page.url().split("/").pop() as string;

    // Rendering happens on the worker; poll the way the interface does.
    await expect
      .poll(async () => (await page.request.get(`/api/v1/invoices/${invoiceId}/pdf`)).status(), {
        timeout: 40_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(200);

    const response = await page.request.get(`/api/v1/invoices/${invoiceId}/pdf`);
    expect(response.headers()["content-type"]).toContain("pdf");
    expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("the PDF button opens the document rather than an error", async ({ page, context }) => {
    const opened = context.waitForEvent("page", { timeout: 40_000 });
    await page.getByRole("button", { name: /^pdf$|preparing/i }).click();
    const pdfTab = await opened;
    await expect
      .poll(async () => (await pdfTab.request.get(pdfTab.url())).status(), { timeout: 20_000 })
      .toBe(200);
  });

  test("another business cannot fetch that PDF", async ({ page, browser }) => {
    const invoiceId = page.url().split("/").pop() as string;
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage);
    const response = await otherPage.request.get(`/api/v1/invoices/${invoiceId}/pdf`);
    expect([403, 404]).toContain(response.status());
    expect(response.headers()["content-type"]).toContain("json");
    await other.close();
  });

  test("receivables lists what is still owed", async ({ page }) => {
    await page.goto("/reports/receivables");
    await expect(page.getByText("Emirates Ispat Pvt Ltd").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/29,500/).first()).toBeVisible();
  });
});
