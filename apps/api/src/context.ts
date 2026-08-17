import type { FastifyRequest } from "fastify";
import type { AuthContext, Container } from "@traxac/core";
import { AppError } from "@traxac/shared";

/**
 * Every route handler works from an `AuthContext`, never from the raw request.
 * Reading it through this helper is the single place a missing session turns
 * into a 401, so no handler can accidentally run unauthenticated.
 */
declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    container: Container;
  }
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError("UNAUTHENTICATED", "Sign in to continue");
  return request.auth;
}

export function optionalAuth(request: FastifyRequest): AuthContext | undefined {
  return request.auth;
}
