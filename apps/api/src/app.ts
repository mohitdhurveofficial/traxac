import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { randomUUID } from "node:crypto";
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

  return app;
}
