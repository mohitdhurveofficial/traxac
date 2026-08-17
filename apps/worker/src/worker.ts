import { createContainer } from "@traxac/core";
import { Runner } from "./runner.js";
import {
  expireAndAlertEwbs, handleEinvoiceCancel, handleEinvoiceGenerate,
  handleEwbCancel, handleEwbGenerate, runMaintenance,
} from "./handlers/compliance.js";
import { handleRenderInvoicePdf } from "./handlers/invoice-pdf.js";

/**
 * Worker process.
 *
 * Runs compliance jobs and PDF rendering off the request path, so a slow or
 * unavailable government portal never blocks someone raising an invoice.
 */
async function main(): Promise<void> {
  const container = createContainer({ processName: "traxac-worker" });

  const runner = new Runner(container, {
    concurrency: container.config.WORKER_CONCURRENCY,
    pollIntervalMs: container.config.WORKER_POLL_INTERVAL_MS,
    handlers: {
      "einvoice.generate": handleEinvoiceGenerate,
      "einvoice.cancel": handleEinvoiceCancel,
      "ewb.generate": handleEwbGenerate,
      "ewb.cancel": handleEwbCancel,
      "invoice.render_pdf": handleRenderInvoicePdf,
    },
    schedule: [
      // e-Way Bill validity is time-critical: sweep and warn every 15 minutes.
      { name: "ewb-expiry", everyMs: 15 * 60_000, run: expireAndAlertEwbs },
      { name: "maintenance", everyMs: 6 * 3_600_000, run: runMaintenance },
    ],
  });

  const close = async (signal: string): Promise<void> => {
    container.logger.info({ signal }, "worker shutting down");
    await runner.stop();
    await container.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => void close("SIGTERM"));
  process.on("SIGINT", () => void close("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    container.logger.error({ reason }, "unhandled promise rejection");
  });

  await runner.start();
}

main().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});
