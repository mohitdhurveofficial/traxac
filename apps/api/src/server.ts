import { createContainer } from "@traxac/core";
import { buildApp } from "./app.js";

/**
 * API process entry point.
 *
 * Shutdown is explicit: stop accepting connections, drain in-flight requests,
 * then close the database pool. Railway sends SIGTERM on deploy, and a clean
 * exit is what makes a rolling restart invisible to users.
 */
async function main(): Promise<void> {
  const container = createContainer({ processName: "traxac-api" });
  const app = await buildApp(container);

  const close = async (signal: string): Promise<void> => {
    container.logger.info({ signal }, "shutting down");
    try {
      await app.close();
      await container.shutdown();
      process.exit(0);
    } catch (err) {
      container.logger.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void close("SIGTERM"));
  process.on("SIGINT", () => void close("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    container.logger.error({ reason }, "unhandled promise rejection");
  });

  await app.listen({ port: container.config.PORT, host: "0.0.0.0" });
  container.logger.info(
    {
      port: container.config.PORT,
      env: container.config.NODE_ENV,
      gst: container.config.GST_ENVIRONMENT,
      storage: container.config.STORAGE_DRIVER,
    },
    "Traxac API ready",
  );
}

main().catch((err) => {
  console.error("[api] failed to start:", err);
  process.exit(1);
});
