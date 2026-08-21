import type { FastifyInstance, RouteHandlerMethod, RouteOptions } from "fastify";
import type { Container } from "@traxac/core";

/**
 * Establishes the database scope every request runs inside.
 *
 * Row-level security reads `traxac.tenant_id` from the connection, so the
 * setting and the queries must share one. This wraps each route handler in a
 * transaction that carries the right setting, and publishes that transaction
 * as the ambient scope so services pick it up.
 *
 * It is an `onRoute` hook rather than a `preHandler` for two reasons. A
 * preHandler returns before the handler runs, so an AsyncLocalStorage context
 * established there would be gone by the time it mattered. And wrapping at
 * registration means a route cannot be added later that forgets to opt in —
 * there is no opt-in.
 *
 * Two scopes exist:
 *
 *  - **Tenant** for anything authenticated. The tenant comes from the resolved
 *    session, never from a header, body or query parameter, so a caller cannot
 *    nominate whose data they see.
 *  - **System** for the handful of routes that run before a tenant is known —
 *    sign-in, registration, password reset. These are exactly the paths listed
 *    as public, they are attributed by name in the scope's origin, and they
 *    are the only bypass in the request path.
 *
 * Transaction-per-request means a request holds a pooled connection for its
 * duration. That is a deliberate trade: correctness of tenant isolation over
 * connection efficiency. Long-running external calls belong on the worker.
 */
/** Everything the application serves under this prefix talks to the database. */
const API_PREFIX = "/api";

export function registerDbScope(app: FastifyInstance, container: Container): void {
  app.addHook("onRoute", (route: RouteOptions) => {
    /*
     * Only API routes get a database scope.
     *
     * Health must answer even when the database is unreachable. The static
     * file and SPA-fallback routes never touch the database, and wrapping
     * them broke them outright: their handlers stream a reply rather than
     * returning a payload, so resolving a wrapper promise around them sent an
     * empty body — every page loaded as 200 with zero bytes.
     */
    if (typeof route.url !== "string" || !route.url.startsWith(API_PREFIX)) return;

    const original = route.handler;
    if (typeof original !== "function") return;

    const wrapped: RouteHandlerMethod = function (this, request, reply) {
      const origin = `${request.method} ${route.url}`;
      const tenantId = request.auth?.tenantId;

      if (tenantId) {
        return container.database.withTenantScope(tenantId, origin, () =>
          Promise.resolve(original.call(this, request, reply)),
        );
      }

      // Unauthenticated: the public auth surface. Attributed, and reachable
      // only for the paths the auth plugin lists as public.
      return container.database.withSystemScope(`public:${origin}`, () =>
        Promise.resolve(original.call(this, request, reply)),
      );
    };
    route.handler = wrapped;
  });
}
