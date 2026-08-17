import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "@traxac/core";

const SESSION_COOKIE = "traxac_session";

/**
 * Every API route hangs off this prefix, and the web client requests the same
 * path in development and production. Keeping it in one exported constant
 * means the auth guard, the SPA fallback and the route registration cannot
 * disagree about what counts as an API path.
 */
export const API_PREFIX = "/api";

/** True for anything the API owns — used to keep HTML out of API responses. */
export function isApiPath(url: string): boolean {
  const pathname = url.split("?")[0] ?? "";
  return (
    pathname === API_PREFIX ||
    pathname.startsWith(`${API_PREFIX}/`) ||
    pathname === "/health" ||
    pathname.startsWith("/health/")
  );
}

/** API routes reachable without a session. Every other one needs a session. */
const PUBLIC_PATHS = new Set([`${API_PREFIX}/v1/auth/login`, `${API_PREFIX}/v1/auth/register`]);

/**
 * Only the API surface is guarded. Health checks stay open for the platform
 * probe, and the static web assets must be reachable so an unauthenticated
 * visitor can load the app and see the sign-in screen.
 */
function requiresAuth(pathname: string): boolean {
  if (!pathname.startsWith(`${API_PREFIX}/`)) return false;
  return !PUBLIC_PATHS.has(pathname);
}

/**
 * Resolves the caller on every request.
 *
 * Two credentials are accepted: the browser session cookie, and an
 * `Authorization: Bearer` token that may be either a session token or a
 * machine API key. A mobile client therefore uses exactly the same endpoints.
 */
export function registerAuth(app: FastifyInstance, container: Container): void {
  app.addHook("onRequest", async (request) => {
    request.container = container;
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!requiresAuth(request.url.split("?")[0] ?? "")) return;

    const token = extractToken(request);
    if (!token) {
      return reply.status(401).send({
        error: { code: "UNAUTHENTICATED", message: "Sign in to continue", requestId: request.id },
      });
    }

    const meta = {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    };

    // API keys carry a recognisable prefix, so there is no ambiguity.
    const auth = token.startsWith("txk_")
      ? await container.auth.resolveApiKey(token, meta)
      : await container.auth.resolveSession(token, meta);

    if (!auth) {
      return reply.status(401).send({
        error: {
          code: "UNAUTHENTICATED",
          message: "Your session has expired. Sign in again.",
          requestId: request.id,
        },
      });
    }

    request.auth = { ...auth, requestId: request.id };
  });
}

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();

  const cookie = request.headers.cookie;
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export { SESSION_COOKIE };
