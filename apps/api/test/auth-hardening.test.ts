import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Container } from "@traxac/core";
import { buildApp } from "../src/app.js";
import { resetDatabase, testContainer } from "../../../packages/core/test/helpers.js";

/**
 * Authentication hardening.
 *
 * Covers the three defects the audit found: a wrong password answered 422 with
 * the password policy instead of 401, sign-in shared the generous global rate
 * limit, and the Secure cookie flag depended on an environment variable that
 * production could silently omit.
 */
describe("authentication hardening", () => {
  let container: Container;
  let app: FastifyInstance;
  const email = "hardening@example.test";
  const password = "CorrectHorse123!";

  beforeAll(async () => {
    container = await testContainer();
    await resetDatabase(container);
    await container.auth.register({
      name: "Hardening",
      email,
      password,
      businessName: "Hardening Co",
    });
    app = await buildApp(container);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await container?.shutdown();
  });

  const login = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/auth/login", payload });

  it("returns 401 for a wrong password, whatever its length", async () => {
    for (const wrong of ["x", "short", "a-long-but-wrong-password"]) {
      const res = await login({ email, password: wrong });
      expect(res.statusCode, `password: ${wrong}`).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("never discloses the password policy on a failed sign-in", async () => {
    const res = await login({ email, password: "x" });
    expect(res.body).not.toMatch(/at least|character|uppercase|minimum/i);
  });

  it("gives the same answer for an unknown account as for a wrong password", async () => {
    const unknown = await login({ email: "nobody@example.test", password: "whatever123" });
    const wrong = await login({ email, password: "whatever123" });
    expect(unknown.statusCode).toBe(wrong.statusCode);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it("still rejects a malformed email as a validation error", async () => {
    const res = await login({ email: "not-an-email", password: "whatever123" });
    expect(res.statusCode).toBe(422);
  });

  it("issues a session cookie that scripts cannot read", async () => {
    const res = await login({ email, password });
    expect(res.statusCode).toBe(200);
    const cookie = res.headers["set-cookie"];
    const value = Array.isArray(cookie) ? cookie[0] : cookie;
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Lax");
    expect(value).toContain("Path=/");
  });

  it("rate-limits repeated sign-in attempts from one address", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 14; attempt++) {
      const res = await login({ email, password: "definitely-wrong" });
      statuses.push(res.statusCode);
    }
    expect(statuses).toContain(429);
    // The limit must bite well before the global 300/minute ceiling.
    expect(statuses.indexOf(429)).toBeLessThan(13);
  });

  it("explains the wait rather than failing opaquely", async () => {
    const res = await login({ email, password: "definitely-wrong" });
    if (res.statusCode === 429) {
      expect(res.json().error.code).toBe("RATE_LIMITED");
      expect(res.json().error.message).toMatch(/try again/i);
    }
  });
});

describe("secure cookies in production", () => {
  it("marks the cookie Secure whenever NODE_ENV is production", async () => {
    // The flag is derived, not read: an omitted COOKIE_SECURE in production
    // must not be able to put a session cookie on the wire in clear text.
    const container = await testContainer({ NODE_ENV: "production", COOKIE_SECURE: false });
    try {
      expect(container.config.cookieSecure).toBe(true);
    } finally {
      await container.shutdown();
    }
  });

  it("leaves it off outside production unless asked for", async () => {
    const container = await testContainer({ NODE_ENV: "test", COOKIE_SECURE: false });
    try {
      expect(container.config.cookieSecure).toBe(false);
    } finally {
      await container.shutdown();
    }
  });
});
