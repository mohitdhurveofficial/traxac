import { randomUUID } from "node:crypto";
import type { Job } from "@traxac/database";
import type { Container } from "@traxac/core";
import { AppError, type JobKind } from "@traxac/shared";

/**
 * Job runner.
 *
 * Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so adding capacity means
 * running more replicas — there is no leader, no coordination and no
 * distributed lock to lose.
 *
 * Failure handling distinguishes two cases:
 *  - **Retryable** (portal timeout, 5xx, network): re-queued with exponential
 *    backoff. The handler is expected to check remote state before resubmitting.
 *  - **Permanent** (validation rejected by the portal, missing credentials):
 *    parked as `failed` immediately, because retrying only repeats the answer.
 */
export type JobHandler = (job: Job, container: Container) => Promise<unknown>;

export interface RunnerOptions {
  concurrency: number;
  pollIntervalMs: number;
  handlers: Partial<Record<JobKind, JobHandler>>;
  /** Periodic work that is not triggered by a user action. */
  schedule?: Array<{ name: string; everyMs: number; run: (container: Container) => Promise<void> }>;
}

export class Runner {
  private readonly workerId: string;
  private running = false;
  private inFlight = 0;
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly container: Container,
    private readonly options: RunnerOptions,
  ) {
    const replica = container.config.RAILWAY_REPLICA_ID ?? "local";
    this.workerId = `${replica}-${randomUUID().slice(0, 8)}`;
  }

  async start(): Promise<void> {
    this.running = true;
    const log = this.container.logger;
    log.info({ workerId: this.workerId, concurrency: this.options.concurrency }, "worker started");

    // Anything a crashed replica left mid-run becomes claimable again.
    const reclaimed = await this.container.queue.reclaimStale();
    if (reclaimed > 0) log.warn({ reclaimed }, "reclaimed stale jobs from a previous run");

    for (const task of this.options.schedule ?? []) {
      const timer = setInterval(() => {
        void task.run(this.container).catch((err) => {
          log.error({ err, task: task.name }, "scheduled task failed");
        });
      }, task.everyMs);
      // A pending interval must not hold the process open during shutdown.
      timer.unref();
      this.timers.push(timer);
      void task.run(this.container).catch((err) => {
        log.error({ err, task: task.name }, "scheduled task failed on startup");
      });
    }

    await this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    // Let in-flight jobs finish so a deploy does not orphan a portal call.
    const deadline = Date.now() + 30_000;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await sleep(200);
    }
    this.container.logger.info({ inFlight: this.inFlight }, "worker stopped");
  }

  private async loop(): Promise<void> {
    const log = this.container.logger;
    while (this.running) {
      const capacity = this.options.concurrency - this.inFlight;
      if (capacity <= 0) {
        await sleep(100);
        continue;
      }

      let claimed: Job[] = [];
      try {
        claimed = await this.container.queue.claim(this.workerId, capacity);
      } catch (err) {
        log.error({ err }, "failed to claim jobs");
        await sleep(this.options.pollIntervalMs);
        continue;
      }

      if (claimed.length === 0) {
        await sleep(this.options.pollIntervalMs);
        continue;
      }

      for (const job of claimed) {
        this.inFlight += 1;
        void this.execute(job).finally(() => {
          this.inFlight -= 1;
        });
      }
    }
  }

  private async execute(job: Job): Promise<void> {
    const log = this.container.logger.child({
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
    });
    const handler = this.options.handlers[job.kind as JobKind];

    if (!handler) {
      log.error("no handler registered for this job kind");
      await this.container.queue.fail(job.id, `No handler for "${job.kind}"`, { retryable: false });
      return;
    }

    const startedAt = Date.now();
    try {
      const result = await handler(job, this.container);
      await this.container.queue.complete(job.id, result);
      log.info({ durationMs: Date.now() - startedAt }, "job done");
    } catch (err) {
      const retryable = isRetryable(err);
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await this.container.queue.fail(job.id, message, { retryable });
      log.warn(
        { err, retryable, willRetry: outcome.willRetry, nextRunAt: outcome.nextRunAt },
        outcome.willRetry ? "job failed, will retry" : "job failed permanently",
      );
      if (!outcome.willRetry) await this.notifyFailure(job, message);
    }
  }

  /** A permanently failed compliance job becomes a visible alert. */
  private async notifyFailure(job: Job, message: string): Promise<void> {
    if (!job.tenantId) return;
    const payload = job.payload as { invoiceId?: string };
    const label = job.kind.startsWith("einvoice") ? "e-Invoice" : "e-Way Bill";
    if (!job.kind.startsWith("einvoice") && !job.kind.startsWith("ewb")) return;
    await this.container.notifications
      .create({
        tenantId: job.tenantId,
        kind: `${job.kind}.failed`,
        severity: "error",
        title: `${label} could not be generated`,
        body: message,
        entityType: "invoice",
        entityId: payload.invoiceId,
        dedupeWithinHours: 1,
      })
      .catch(() => undefined);
  }
}

/** Only errors explicitly marked retryable are retried. */
function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) return err.retryable;
  // An unexpected error is most likely transient (network, pool exhaustion).
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
