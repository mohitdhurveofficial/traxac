import { expect, type Page } from "@playwright/test";

/** A distinct business per test, so runs never collide on unique columns. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export interface Account {
  email: string;
  password: string;
  businessName: string;
  name: string;
}

export function newAccount(label = "owner"): Account {
  const suffix = uniqueSuffix();
  return {
    email: `${label}.${suffix}@example.test`,
    password: "Correct-Horse-9!",
    businessName: `Test Traders ${suffix.slice(-6).toUpperCase()}`,
    name: "Test Owner",
  };
}

/**
 * Registers a business through the real HTTP API, then lands the browser in
 * the application.
 *
 * Sign-up is exercised once by its own test; every other test uses this so a
 * failure in a shared prerequisite does not read as a failure of the flow
 * under test.
 */
export async function signUp(page: Page, account = newAccount()): Promise<Account> {
  const response = await page.request.post("/api/v1/auth/register", {
    data: {
      email: account.email,
      password: account.password,
      name: account.name,
      businessName: account.businessName,
    },
  });
  expect(response.ok(), `register failed: ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: /invoices/i }).first()).toBeVisible();
  return account;
}

export async function login(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
}

/** A GSTIN with a valid checksum for the given state, unique per call. */
export function makeGstin(stateCode = "27"): string {
  const digits = uniqueSuffix()
    .replace(/[^0-9]/g, "")
    .padEnd(4, "0")
    .slice(0, 4);
  const pan = `AA${randomLetters(3)}${digits}${randomLetters(1)}`;
  const body = `${stateCode}${pan}1Z`;
  return `${body}${checksum(body)}`;
}

function randomLetters(count: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from(
    { length: count },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

/** The GSTIN check character, same algorithm the portal uses. */
function checksum(first14: string): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let index = 0; index < first14.length; index += 1) {
    const value = alphabet.indexOf(first14[index] as string);
    const weighted = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(weighted / alphabet.length) + (weighted % alphabet.length);
  }
  return alphabet[(alphabet.length - (sum % alphabet.length)) % alphabet.length] as string;
}
