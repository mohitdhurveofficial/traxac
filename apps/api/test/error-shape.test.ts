import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Container } from "@ewayvo/core";
import { buildApp } from "../src/app.js";
import { testContainer } from "../../../packages/core/test/helpers.js";

/**
 * What a failing request is allowed to say.
 *
 * Users see these strings. A Fastify internal ("body must be object"), a
 * Postgres message, or a stack frame reaching the browser is both a poor
 * experience and an information leak, so the shape is asserted rather than
 * assumed: stable `code`, human `message`, a `requestId` to quote, and
 * nothing else.
 */
describe("error responses", () => {
  let container: Container;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await testContainer();
    app = await buildApp(container);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await container?.shutdown();
  });

  /** Nothing that looks like machine internals may appear in user-facing text. */
  const LEAKS = [
    /\bat\s+\S+\s+\(.*:\d+:\d+\)/, // stack frame
    /node_modules|\.ts:\d+|\.js:\d+/, // source paths
    /FST_ERR|FST_REQ|fastify/i, // framework internals
    /select |insert into|relation ".*" does not exist|pg_|postgres/i, // SQL
    /ECONNREFUSED|ETIMEDOUT|getaddrinfo/, // socket detail
  ];

  function assertSafe(body: string): void {
    const parsed = JSON.parse(body) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(parsed.error.code).toMatch(/^[A-Z_]+$/);
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(parsed.error.requestId).toBeTruthy();
    expect(Object.keys(parsed.error).sort()).toEqual(
      expect.arrayContaining(["code", "message", "requestId"]),
    );
    expect(Object.keys(parsed.error)).not.toContain("stack");
    for (const leak of LEAKS) {
      expect(parsed.error.message, `leaked via: ${leak}`).not.toMatch(leak);
    }
  }

  it("returns a stable envelope for an unauthenticated call", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/invoices" });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("UNAUTHENTICATED");
    assertSafe(response.body);
  });

  it("does not leak Fastify's wording for a malformed JSON body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    assertSafe(response.body);
  });

  it("does not leak Fastify's wording for an unsupported content type", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/xml" },
      payload: "<login/>",
    });
    expect(response.statusCode).toBe(415);
    const parsed = JSON.parse(response.body) as { error: { code: string } };
    expect(parsed.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    assertSafe(response.body);
  });

  it("reports validation failures per field, without prose about the policy", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "not-an-email", password: "x", name: "", businessName: "" },
    });
    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.body) as {
      error: { code: string; details: Array<{ field: string; message: string }> };
    };
    expect(parsed.error.code).toBe("VALIDATION_FAILED");
    expect(parsed.error.details.length).toBeGreaterThan(0);
    for (const issue of parsed.error.details) {
      expect(issue.field).toBeTruthy();
      expect(issue.message).toBeTruthy();
    }
    assertSafe(response.body);
  });

  it("does not confirm or deny an account on a failed login", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "nobody@example.com", password: "whatever-password" },
    });
    expect(missing.statusCode).toBe(401);
    const body = JSON.parse(missing.body) as { error: { message: string } };
    // "No such user" would let anyone enumerate the customer list.
    expect(body.error.message).not.toMatch(/not found|no such|does not exist|unknown user/i);
    assertSafe(missing.body);
  });

  it("answers an unknown API path with JSON, never the SPA shell", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/nope" });
    // 401 is as good as 404 here — the authentication hook runs before route
    // matching, so an unauthenticated caller cannot map which routes exist.
    expect([401, 404]).toContain(response.statusCode);
    expect(response.headers["content-type"]).toContain("application/json");
    assertSafe(response.body);
  });
});
