import type { Job } from "@ewayvo/database";
import { systemContext, type Container } from "@ewayvo/core";
import { AppError } from "@ewayvo/shared";

/**
 * Compliance handlers.
 *
 * Each runs as the tenant under a system context: the worker has no human
 * actor, but every write it makes is still tenant-scoped and audited with
 * `system:worker` as the actor.
 */

interface EinvoicePayload {
  invoiceId: string;
  tenantId: string;
  withEwayBill?: boolean;
}

interface EwbPayload {
  invoiceId: string;
  tenantId: string;
  options?: {
    distanceKm?: number;
    transporterId?: string | null;
    partB?: {
      transportMode: number;
      vehicleNo?: string;
      vehicleType?: "R" | "O";
      transportDocNo?: string;
      transportDocDate?: string | Date | null;
    };
  };
}

function payloadOf<T>(job: Job): T {
  return job.payload as T;
}

export async function handleEinvoiceGenerate(job: Job, container: Container): Promise<unknown> {
  const payload = payloadOf<EinvoicePayload>(job);
  const ctx = systemContext(payload.tenantId);
  const result = await container.compliance.generateEinvoice(
    ctx,
    payload.invoiceId,
    payload.withEwayBill ?? false,
  );

  await container.notifications.create({
    tenantId: payload.tenantId,
    kind: "einvoice.generated",
    severity: "info",
    title: "e-Invoice generated",
    body: `IRN ${result.irn?.slice(0, 16)}… acknowledged by the IRP`,
    entityType: "invoice",
    entityId: payload.invoiceId,
  });

  return { irn: result.irn, ackNumber: result.ackNumber, ewbNumber: result.ewbNumber };
}

export async function handleEwbGenerate(job: Job, container: Container): Promise<unknown> {
  const payload = payloadOf<EwbPayload>(job);
  const ctx = systemContext(payload.tenantId);
  const options = payload.options ?? {};

  const result = await container.compliance.generateEwb(ctx, payload.invoiceId, {
    distanceKm: options.distanceKm,
    transporterId: options.transporterId,
    partB: options.partB
      ? {
          ...options.partB,
          transportDocDate: options.partB.transportDocDate
            ? new Date(options.partB.transportDocDate)
            : null,
        }
      : undefined,
  });

  await container.notifications.create({
    tenantId: payload.tenantId,
    kind: "ewb.generated",
    severity: result.status === "part_b_pending" ? "warning" : "info",
    title:
      result.status === "part_b_pending"
        ? "e-Way Bill Part-A generated — vehicle details still needed"
        : "e-Way Bill generated",
    body: `EWB ${result.ewbNumber}${result.validUntil ? `, valid to ${result.validUntil.toISOString().slice(0, 10)}` : ""}`,
    entityType: "invoice",
    entityId: payload.invoiceId,
  });

  return { ewbNumber: result.ewbNumber, validUntil: result.validUntil, status: result.status };
}

export async function handleEinvoiceCancel(job: Job, container: Container): Promise<unknown> {
  const payload = payloadOf<EinvoicePayload & { reasonCode: string; remark: string }>(job);
  const ctx = systemContext(payload.tenantId);
  const result = await container.compliance.cancelEinvoice(ctx, payload.invoiceId, {
    reasonCode: payload.reasonCode,
    remark: payload.remark,
  });
  return { irn: result.irn, cancelledAt: result.cancelledAt };
}

export async function handleEwbCancel(job: Job, container: Container): Promise<unknown> {
  const payload = payloadOf<EwbPayload & { reasonCode: string; remark: string }>(job);
  const ctx = systemContext(payload.tenantId);
  const result = await container.compliance.cancelEwb(ctx, payload.invoiceId, {
    reasonCode: payload.reasonCode,
    remark: payload.remark,
  });
  return { ewbNumber: result.ewbNumber, cancelledAt: result.cancelledAt };
}

/**
 * Sweep expired e-Way Bills and warn about ones about to lapse. Alerts fire
 * once per bill per 12 hours so a long-running consignment does not spam.
 */
export async function expireAndAlertEwbs(container: Container): Promise<void> {
  const expired = await container.compliance.expireLapsedEwbs();
  if (expired > 0) container.logger.info({ expired }, "marked lapsed e-Way Bills as expired");

  const expiring = await container.compliance.ewbsExpiringWithin(12);
  for (const row of expiring) {
    const validUntil = row.ewayBill.validUntil;
    if (!validUntil) continue;
    const hoursLeft = Math.max(0, Math.round((validUntil.getTime() - Date.now()) / 3_600_000));
    await container.notifications.create({
      tenantId: row.tenantId,
      kind: "ewb.expiring",
      severity: "warning",
      title: `e-Way Bill ${row.ewayBill.ewbNumber} expires in ${hoursLeft}h`,
      body: `Invoice ${row.invoiceNumber}. Extend it if the consignment is still in transit.`,
      entityType: "invoice",
      entityId: row.ewayBill.invoiceId,
      dedupeWithinHours: 12,
    });
  }
}

/** Housekeeping: drop expired sessions and long-read notifications. */
export async function runMaintenance(container: Container): Promise<void> {
  const [sessions, notifications] = await Promise.all([
    container.auth.purgeExpiredSessions(),
    container.notifications.purgeOld(),
  ]);
  if (sessions || notifications) {
    container.logger.info({ sessions, notifications }, "housekeeping complete");
  }
}

export { AppError };
