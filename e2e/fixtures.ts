import { expect, type Page } from "@playwright/test";

/**
 * Creating the things every flow needs, through the interface.
 *
 * Deliberately not through the API: if the customer form breaks, the invoice
 * tests should fail too, because a user cannot raise an invoice without it.
 */
/**
 * Registers the GSTIN the business bills from.
 *
 * A fresh account has none, and without one the invoice editor cannot save —
 * which is correct behaviour, and the reason this is step one of the
 * on-screen setup checklist.
 */
export async function createGstin(page: Page, gstin: string, legalName: string): Promise<void> {
  await page.goto("/settings?tab=business");
  await page.getByRole("button", { name: "Add GSTIN", exact: true }).last().click();
  await page.locator('input[name="gstin"]').fill(gstin);
  await page.locator('input[name="legalName"]').fill(legalName);
  await page.locator('input[name="tradeName"]').fill(legalName);
  await page.locator('input[name="addressLine1"]').fill("Gala 7, Steel Market");
  await page.locator('input[name="city"]').fill("Mumbai");
  await page.locator('input[name="pincode"]').fill("400009");
  // The state must agree with the GSTIN's first two digits, which the form
  // checks — so derive it rather than assuming Maharashtra.
  await page.locator('select[name="stateCode"]').selectOption(gstin.slice(0, 2));
  await page
    .getByRole("button", { name: /^add gstin$|^save gstin$|^save$/i })
    .last()
    .click();
  await expect(page.getByText(gstin).first()).toBeVisible();
}

export async function createCustomer(page: Page, name: string, gstin?: string): Promise<void> {
  await page.goto("/customers");
  await page.getByRole("button", { name: "Add customer", exact: true }).last().click();
  await page.locator('input[name="name"]').fill(name);
  if (gstin) await page.locator('input[name="gstin"]').fill(gstin);
  await page.locator('select[name="stateCode"]').selectOption("27");
  await page.locator('input[name="addressLine1"]').fill("Plot 14, MIDC Industrial Area");
  await page.locator('input[name="city"]').fill("Pune");
  await page.locator('input[name="pincode"]').fill("411019");
  await page.getByRole("button", { name: /save customer/i }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

export async function createItem(page: Page, name: string, price = "2500"): Promise<void> {
  await page.goto("/items");
  await page.getByRole("button", { name: "Add item", exact: true }).last().click();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="hsnSac"]').fill("26190090");
  await page.locator('select[name="gstRate"]').selectOption("18");
  await page.locator('input[name="unitPrice"]').fill(price);
  await page.getByRole("button", { name: /save item/i }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

/** Picks an option out of the type-ahead used for customers and items. */
export async function pick(page: Page, placeholder: RegExp, label: string): Promise<void> {
  const input = page.getByPlaceholder(placeholder);
  await input.click();
  await input.fill(label.slice(0, 8));
  await page
    .getByRole("button", { name: new RegExp(escapeRegExp(label)) })
    .first()
    .click();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fills a new invoice with one line and leaves it unsaved. */
export async function composeInvoice(
  page: Page,
  customer: string,
  item: string,
  quantity = "10",
): Promise<void> {
  await page.goto("/invoices/new");
  await pick(page, /Search customers/i, customer);
  await pick(page, /Search your items/i, item);
  const quantityField = page.getByTestId("line-quantity").first();
  await quantityField.fill(quantity);
  await quantityField.blur();
}

/**
 * Composes and saves a draft, landing on the invoice record.
 *
 * "Save draft" deliberately keeps the user in the editor; "Save and review" is
 * the one that opens the record, which is where every later step happens.
 */
export async function saveAndReview(page: Page): Promise<string> {
  await page.getByRole("button", { name: /save and review/i }).click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  return page.url().split("/").pop() as string;
}

/** Takes a draft through to a numbered, issued invoice. */
export async function issue(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Issue invoice", exact: true }).first().click();
  const confirm = page.getByRole("button", { name: /^issue invoice$|^confirm|^yes/i }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole("button", { name: "Issue invoice", exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
}
