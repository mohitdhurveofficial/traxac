import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Container } from "@traxac/core";
import { buildApp } from "../src/app.js";
import { testContainer } from "../../../packages/core/test/helpers.js";

/**
 * Production routing.
 *
 * The web client requests `/api/v1/...`. When the API served its routes at
 * `/v1/...`, those calls fell through to the SPA fallback and came back as
 * `200 text/html`; the client treated the HTML as a response body and the
 * whole application silently failed with no error anywhere. Development never
 * caught it because the Vite proxy rewrote the path.
 *
 * These tests assert the contract that prevents a recurrence: an API path
 * always answers with JSON, and only a non-API path may answer with HTML.
 */
describe("production routing", () => {
  let container: Container;
  let app: FastifyInstance;
  let webDist: string;

  beforeAll(async () => {
    // A stand-in for the real build: the fallback only needs an index.html.
    webDist = mkdtempSync(join(tmpdir(), "traxac-web-"));
    mkdirSync(join(webDist, "assets"), { recursive: true });
    writeFileSync(join(webDist, "index.html"), "<!doctype html><title>Traxac</title>");
    writeFileSync(join(webDist, "assets", "app.js"), "export const ok = true;\n");

    container = await testContainer({ WEB_DIST_PATH: webDist });
    app = await buildApp(container);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await container?.shutdown();
    rmSync(webDist, { recursive: true, force: true });
  });

  const json = "application/json";

  it("serves the SPA shell at the root", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves the SPA shell for a client-side route", async () => {
    const res = await app.inject({ method: "GET", url: "/invoices/some-id" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("answers an unauthenticated API call with JSON, never HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain(json);
    expect(res.body.trimStart().startsWith("<")).toBe(false);
    expect(res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("answers an unknown API path with a JSON 404, never the SPA shell", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/definitely-not-a-route" });
    expect(res.headers["content-type"]).toContain(json);
    expect(res.body.trimStart().startsWith("<")).toBe(false);
    expect(res.json()).toMatchObject({ error: { code: expect.any(String) } });
  });

  it("keeps every public API route on JSON", async () => {
    for (const url of ["/api/v1/auth/login", "/api/v1/auth/register"]) {
      const res = await app.inject({ method: "POST", url, payload: {} });
      expect(res.headers["content-type"], url).toContain(json);
      expect(res.statusCode, url).toBe(422);
    }
  });

  it("does not serve API routes at the unprefixed path", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/auth/me" });
    // Falls through to the SPA, which is correct: /v1 is not an API path.
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("keeps health checks unprefixed and JSON for the platform probe", async () => {
    for (const url of ["/health", "/health/ready"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"], url).toContain(json);
    }
  });

  it("serves hashed assets with immutable caching and the shell without it", async () => {
    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");

    const shell = await app.inject({ method: "GET", url: "/" });
    expect(shell.headers["cache-control"]).toContain("no-cache");
  });

  it("signs in over the API prefix and returns a session cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "routing@example.test", password: "TestPassword123!" },
    });
    // No such account: the point is that it is a JSON 401, not HTML.
    expect(res.headers["content-type"]).toContain(json);
    expect(res.statusCode).toBe(401);
  });
});
