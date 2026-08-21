import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Container } from "@ewayvo/core";
import { API_PREFIX } from "./auth.js";

/**
 * OpenAPI specification for Ewayvo's own API.
 *
 * Generated from the live route table rather than hand-maintained, so it
 * cannot drift from what the server actually serves. The document is served
 * at /api/openapi.json and browsable at /api/docs.
 *
 * Nothing secret appears here: no example carries a real GSTIN, credential or
 * token, and the credential endpoints document only their masked responses.
 */
export async function registerOpenApi(app: FastifyInstance, container: Container): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Ewayvo API",
        version: "1.0.0",
        description: [
          "Multi-tenant Indian GST billing API.",
          "",
          "Every endpoint is scoped to the authenticated tenant; there is no",
          "cross-tenant read or write. The same endpoints serve the web app and",
          "any other client, so a mobile app needs no separate surface.",
          "",
          "**Compliance endpoints require GST API credentials.** Without them",
          "they return `CREDENTIALS_MISSING` — nothing is ever simulated.",
        ].join("\n"),
      },
      servers: [{ url: container.config.API_URL, description: "This deployment" }],
      tags: [
        { name: "auth", description: "Sign in, sessions, team and API keys" },
        { name: "tenants", description: "Business, registrations and settings" },
        { name: "customers", description: "Customers, suppliers and their addresses" },
        { name: "products", description: "Items, HSN/SAC and units" },
        { name: "invoices", description: "Drafts, issuing, credit and debit notes" },
        { name: "payments", description: "Payment recording and receivables" },
        { name: "documents", description: "PDFs and attachments" },
        { name: "compliance", description: "e-Invoice and e-Way Bill" },
        { name: "reports", description: "Sales, tax, GSTR-1 and reconciliation" },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "ewayvo_session",
            description: "Set by POST /api/v1/auth/login. httpOnly.",
          },
          bearerToken: {
            type: "http",
            scheme: "bearer",
            description:
              "A session token, or a machine API key prefixed `txk_`. " +
              "API keys carry a role and are hashed at rest.",
          },
        },
        schemas: {
          Error: {
            type: "object",
            properties: {
              error: {
                type: "object",
                required: ["code", "message"],
                properties: {
                  code: {
                    type: "string",
                    description: "Stable machine-readable code; branch on this, not the message.",
                    examples: [
                      "VALIDATION_FAILED",
                      "UNAUTHENTICATED",
                      "FORBIDDEN",
                      "NOT_FOUND",
                      "CONFLICT",
                      "INVALID_STATE",
                      "CREDENTIALS_MISSING",
                      "GATEWAY_ERROR",
                      "RATE_LIMITED",
                    ],
                  },
                  message: { type: "string", description: "Safe to show a user." },
                  details: { description: "Field-level problems on a 422." },
                  requestId: { type: "string", description: "Ties the failure to server logs." },
                },
              },
            },
          },
          Money: {
            type: "integer",
            description:
              "An amount in paise. Every monetary value in this API is an integer " +
              "number of paise; there are no floating-point rupees.",
            examples: [104340000],
          },
          Paginated: {
            type: "object",
            properties: {
              items: { type: "array", items: {} },
              total: { type: "integer" },
              limit: { type: "integer" },
              page: { type: "integer" },
              hasMore: { type: "boolean" },
            },
          },
        },
      },
      security: [{ sessionCookie: [] }, { bearerToken: [] }],
    },
    // Tag and describe routes from their path, so the document stays in step
    // with the router without every handler carrying a schema block.
    transform: ({ schema, url }) => {
      const tag = tagFor(url);
      return {
        schema: {
          ...schema,
          tags: schema?.tags ?? (tag ? [tag] : undefined),
          summary: schema?.summary ?? summaryFor(url),
          response: {
            ...(schema?.response ?? {}),
            ...(url.startsWith(`${API_PREFIX}/`)
              ? {
                  401: { $ref: "Error#" },
                  403: { $ref: "Error#" },
                  422: { $ref: "Error#" },
                }
              : {}),
          },
        },
        url,
      };
    },
  });

  await app.register(swaggerUi, {
    routePrefix: `${API_PREFIX}/docs`,
    uiConfig: { docExpansion: "list", deepLinking: true, tryItOutEnabled: true },
    staticCSP: true,
  });

  /*
   * A stable, documented location for the specification.
   *
   * swagger-ui serves it under its own prefix, which is an implementation
   * detail that would move if the UI were swapped out. Clients generating
   * SDKs should not have to care.
   */
  app.get(`${API_PREFIX}/openapi.json`, { schema: { hide: true } }, async (_request, reply) =>
    reply.type("application/json").send(app.swagger()),
  );

  app.log.info(
    { spec: `${API_PREFIX}/openapi.json`, ui: `${API_PREFIX}/docs` },
    "OpenAPI specification published",
  );
}

/** Group a route by the resource in its path. */
function tagFor(url: string): string | undefined {
  const path = url.replace(`${API_PREFIX}/v1/`, "");
  if (path.startsWith("auth")) return "auth";
  if (path.startsWith("invoices")) return "invoices";
  if (path.startsWith("parties") || path.startsWith("party-addresses")) return "customers";
  if (path.startsWith("products") || path.startsWith("reference")) return "products";
  if (path.startsWith("payments") || path.startsWith("receivables")) return "payments";
  if (path.startsWith("documents")) return "documents";
  if (path.startsWith("credentials") || path.includes("/ewb") || path.includes("/einvoice")) {
    return "compliance";
  }
  if (path.startsWith("reports") || path.startsWith("gstr1") || path.startsWith("reconciliation")) {
    return "reports";
  }
  if (
    path.startsWith("gstins") ||
    path.startsWith("branches") ||
    path.startsWith("settings") ||
    path.startsWith("payment-terms") ||
    path.startsWith("number-series")
  ) {
    return "tenants";
  }
  return undefined;
}

function summaryFor(url: string): string | undefined {
  const known: Record<string, string> = {
    [`${API_PREFIX}/v1/auth/login`]: "Sign in and receive a session cookie",
    [`${API_PREFIX}/v1/auth/me`]: "Current user, registrations and businesses",
    [`${API_PREFIX}/v1/auth/active-gstin`]: "Choose the registration to work in",
    [`${API_PREFIX}/v1/invoices`]: "Billing history, filtered and paginated",
    [`${API_PREFIX}/v1/invoices/preview`]: "Tax preview without saving anything",
    [`${API_PREFIX}/v1/gstr1/export`]: "Download GSTR-1 JSON (filing is not connected)",
    "/health/ready": "Readiness probe including the database",
  };
  return known[url];
}
