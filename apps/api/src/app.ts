import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Container } from "@ewayvo/core";
import { API_PREFIX, isApiPath, registerAuth } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerDbScope } from "./plugins/db-scope.js";
import { registerOpenApi } from "./plugins/openapi.js";
import { authRoutes } from "./routes/auth.js";
import { complianceRoutes } from "./routes/compliance.js";
import { healthRoutes } from "./routes/health.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { masterRoutes } from "./routes/masters.js";
import { miscRoutes } from "./routes/misc.js";
import { reportRoutes } from "./routes/reports.js";
import { commercialRoutes } from "./routes/commercial.js";

/**
 * Builds the HTTP application.
 *
 * Kept separate from `server.ts` so tests can construct an app against a test
 * container without binding a port. Every route lives under `/v1` so a future
 * breaking change can ship as `/v2` while the mobile app keeps working.
 */
export async function buildApp(container: Container): Promise<FastifyInstance> {
  const { config, logger } = container;

  const app = Fastify({
    // Cast keeps Fastify on its default logger generic while still writing
    // through the shared pino instance, so plugin types stay assignable.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    genReqId: (req) => (req.headers["x-request-id"] as string) ?? randomUUID(),
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(sensible);
  await app.register(helmet, {
    // The API serves JSON and PDFs, never HTML, so CSP is unnecessary here.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, {
    // Global ceiling. Credential endpoints declare a much tighter per-route
    // budget of their own — see CREDENTIAL_RATE_LIMIT in routes/auth.ts.
    max: config.RATE_LIMIT_MAX ?? (config.isProduction ? 300 : 2000),
    timeWindow: "1 minute",
    // Per tenant when authenticated, per IP otherwise.
    keyGenerator: (request) => request.auth?.tenantId ?? request.ip,
    allowList: (request) => request.url.startsWith("/health"),
  });

  registerErrorHandler(app);
  registerAuth(app, container);
  // Must come after registerAuth: the wrapper reads the resolved tenant, and
  // onRoute hooks apply to routes registered after this point.
  registerDbScope(app, container);

  // Registered before the routes so every one of them is captured.
  await registerOpenApi(app, container);

  // Health lives outside the API prefix: the platform probe hits it directly
  // and it must never require a session or a version negotiation.
  await app.register(healthRoutes);

  /*
   * Every API route is mounted under `/api`, which is the same path the web
   * client requests in development and in production. Previously the client
   * called `/api/v1/...` while the server served `/v1/...`; the SPA fallback
   * then answered those calls with `200 text/html`, and the client silently
   * treated the HTML as a response body. One prefix, asserted by a test, is
   * what stops that from recurring.
   */
  await app.register(
    async (api) => {
      await api.register(authRoutes, {
        prefix: "/v1/auth",
        authRateLimitMax: config.AUTH_RATE_LIMIT_MAX,
      });
      await api.register(masterRoutes, { prefix: "/v1" });
      await api.register(invoiceRoutes, { prefix: "/v1/invoices" });
      await api.register(complianceRoutes, { prefix: "/v1" });
      await api.register(reportRoutes, { prefix: "/v1/reports" });
      await api.register(miscRoutes, { prefix: "/v1" });
      await api.register(commercialRoutes, { prefix: "/v1" });

      /** Machine-readable route list — a stand-in until OpenAPI is generated. */
      api.get("/v1", async () => ({
        name: "Ewayvo API",
        version: "1",
        routes: app.printRoutes({ commonPrefix: false }).split("\n").filter(Boolean),
      }));
    },
    { prefix: API_PREFIX },
  );

  await registerWebApp(app, config);
  return app;
}

/**
 * Serve the built web app from the API when it is present.
 *
 * Running both on one origin is deliberate: the session cookie stays
 * first-party, there is no CORS to configure, and a deploy cannot leave the
 * UI and the API on mismatched versions. In development Vite serves the UI
 * instead and proxies /api here, so the two setups behave identically.
 */
async function registerWebApp(app: FastifyInstance, config: Container["config"]): Promise<void> {
  const webDist = config.webDistPath;

  if (!existsSync(resolve(webDist, "index.html"))) {
    app.log.info({ webDist }, "no web build found; serving the API only");
    app.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: `No route for ${request.method} ${request.url}`,
          requestId: request.id,
        },
      });
    });
    return;
  }

  await app.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    // Own the header entirely: the plugin's default `public, max-age=0` is
    // applied after setHeaders and would otherwise win.
    cacheControl: false,
    setHeaders: (response, path) => {
      // Vite emits content-hashed filenames under /assets, so those are
      // immutable. index.html must always be revalidated or a deploy would
      // keep serving the previous bundle's asset references.
      const immutable = path.includes(`${sep}assets${sep}`) && !path.endsWith("index.html");
      response.header(
        "cache-control",
        immutable ? "public, max-age=31536000, immutable" : "no-cache",
      );
    },
  });

  // Client-side routing: anything that is not an API route falls back to the
  // SPA shell, while unknown API paths keep returning a JSON 404. An API path
  // must never be answered with HTML — that failure mode is invisible to the
  // client, which is exactly why it went unnoticed before.
  app.setNotFoundHandler((request, reply) => {
    if (isApiPath(request.url)) {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: `No route for ${request.method} ${request.url}`,
          requestId: request.id,
        },
      });
    }
    return reply.type("text/html").sendFile("index.html");
  });

  app.log.info({ webDist }, "serving the web application");
}
