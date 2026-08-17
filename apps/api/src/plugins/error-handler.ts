import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "@traxac/shared";

/**
 * One error shape for the whole API:
 *   { "error": { "code", "message", "details?", "requestId" } }
 *
 * A stable `code` lets clients branch without parsing prose, and the
 * `requestId` ties a user-visible failure to the server logs.
 */
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
    if (status < 500) {
      request.log.warn({ err: error }, "request rejected");
      return reply.status(status).send({
        error: {
          code: fastifyError.code ?? "BAD_REQUEST",
          message: fastifyError.message ?? "The request could not be processed",
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
