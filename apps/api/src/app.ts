import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Container } from "@traxac/core";
import { registerAuth } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { authRoutes } from "./routes/auth.js";
import { complianceRoutes } from "./routes/compliance.js";
import { healthRoutes } from "./routes/health.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { masterRoutes } from "./routes/masters.js";
import { miscRoutes } from "./routes/misc.js";
import { reportRoutes } from "./routes/reports.js";

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
    max: config.isProduction ? 300 : 2000,
    timeWindow: "1 minute",
    // Rate limit per tenant when authenticated, per IP otherwise.
    keyGenerator: (request) => request.auth?.tenantId ?? request.ip,
    allowList: (request) => request.url.startsWith("/health"),
  });

  registerErrorHandler(app);
  registerAuth(app, container);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(masterRoutes, { prefix: "/v1" });
  await app.register(invoiceRoutes, { prefix: "/v1/invoices" });
  await app.register(complianceRoutes, { prefix: "/v1" });
  await app.register(reportRoutes, { prefix: "/v1/reports" });
  await app.register(miscRoutes, { prefix: "/v1" });

  /** Machine-readable route list — a stand-in until OpenAPI is generated. */
  app.get("/v1", async () => ({
    name: "Traxac API",
    version: "1",
    routes: app.printRoutes({ commonPrefix: false }).split("\n").filter(Boolean),
  }));

  await registerWebApp(app);
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
async function registerWebApp(app: FastifyInstance): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = process.env["WEB_DIST_PATH"]
    ? resolve(process.env["WEB_DIST_PATH"])
    : resolve(here, "../../web/dist");

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
    // Hashed asset filenames can be cached hard; index.html must not be.
    setHeaders: (response, path) => {
      if (path.endsWith("index.html")) {
        response.setHeader("cache-control", "no-cache");
      } else if (path.includes("/assets/")) {
        response.setHeader("cache-control", "public, max-age=31536000, immutable");
      }
    },
  });

  // Client-side routing: anything that is not an API route falls back to the
  // SPA shell, while unknown API paths keep returning a JSON 404.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/v1") || request.url.startsWith("/health")) {
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
