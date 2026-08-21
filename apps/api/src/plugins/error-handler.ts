import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "@ewayvo/shared";

/**
 * One error shape for the whole API:
 *   { "error": { "code", "message", "details?", "requestId" } }
 *
 * A stable `code` lets clients branch without parsing prose, and the
 * `requestId` ties a user-visible failure to the server logs.
 */
/**
 * Safe wording for the failures Fastify raises before our code runs.
 *
 * Keyed by Fastify error code, falling back to the status. Anything not listed
 * gets the generic sentence — silence is better than leaking a framework
 * message we have not read.
 */
const CLIENT_ERRORS: Record<string, { code: string; message: string }> = {
  FST_ERR_CTP_EMPTY_JSON_BODY: { code: "VALIDATION_FAILED", message: "The request was empty" },
  FST_ERR_CTP_INVALID_JSON_BODY: {
    code: "VALIDATION_FAILED",
    message: "The request could not be read",
  },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "That content type is not supported",
  },
  FST_ERR_CTP_BODY_TOO_LARGE: { code: "PAYLOAD_TOO_LARGE", message: "That upload is too large" },
  FST_REQ_FILE_TOO_LARGE: { code: "PAYLOAD_TOO_LARGE", message: "That file is too large" },
  FST_PARTS_LIMIT: { code: "PAYLOAD_TOO_LARGE", message: "Too many files in one upload" },
  "404": { code: "NOT_FOUND", message: "Not found" },
  "405": { code: "BAD_REQUEST", message: "That action is not allowed here" },
  "413": { code: "PAYLOAD_TOO_LARGE", message: "That upload is too large" },
  "415": { code: "UNSUPPORTED_MEDIA_TYPE", message: "That content type is not supported" },
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      // 5xx is our fault; anything else is the caller's and stays at warn.
      const log = error.status >= 500 ? request.log.error : request.log.warn;
      log.call(request.log, { err: error, code: error.code }, error.message);
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, details: error.details, requestId },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields need attention",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
          requestId,
        },
      });
    }

    // Fastify's own errors (bad JSON, payload too large, rate limit).
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    const status = fastifyError.statusCode ?? 500;

    // Rate limiting is surfaced with our own code so a client can back off on
    // `code` rather than parsing a plugin-specific message.
    if (status === 429) {
      request.log.warn({ ip: request.ip, url: request.url }, "rate limited");
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many attempts. Please wait a moment and try again.",
          requestId,
        },
      });
    }

    if (status < 500) {
      // Fastify's own text names internals ("body must be object",
      // "FST_ERR_CTP_INVALID_MEDIA_TYPE") and, for multipart, echoes the
      // configured limits. Log it, send our own wording.
      request.log.warn({ err: error, code: fastifyError.code }, "request rejected");
      const known = CLIENT_ERRORS[fastifyError.code ?? ""] ?? CLIENT_ERRORS[String(status)];
      return reply.status(status).send({
        error: {
          code: known?.code ?? "BAD_REQUEST",
          message: known?.message ?? "The request could not be processed",
          requestId,
        },
      });
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL",
        // Never leak an internal message to the client.
        message: "Something went wrong on our side. The team has been notified.",
        requestId,
      },
    });
  });

  // The not-found handler is registered in app.ts: when a web build is
  // present it must fall through to the SPA shell for client-side routes.
}
