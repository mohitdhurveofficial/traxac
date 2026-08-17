import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

/**
 * Liveness and readiness.
 *
 * `/health` answers as long as the process is up — Railway uses it to decide
 * whether to restart. `/health/ready` also checks the database, so a
 * deployment is not routed traffic before it can serve it.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const startedAt = Date.now();

  app.get("/health", async () => ({
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));

  app.get("/health/ready", async (request, reply) => {
    const { database, config } = request.container;
    try {
      await database.db.execute(sql`SELECT 1`);
    } catch (err) {
      request.log.error({ err }, "readiness check failed");
      return reply.status(503).send({ status: "unavailable", database: "down" });
    }
    return {
      status: "ok",
      database: "up",
      environment: config.NODE_ENV,
      gstEnvironment: config.GST_ENVIRONMENT,
      storage: config.STORAGE_DRIVER,
    };
  });

  /** Queue depth, for the operations dashboard. */
  app.get("/health/queue", async (request) => ({
    jobs: await request.container.queue.stats(),
  }));
}
