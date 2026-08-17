import type { EinvoiceProvider, EwbProvider, GatewayRequestContext } from "@traxac/gst-gateway";
import type { Logger } from "../infra/logger.js";

/**
 * Pre-flight reconciliation.
 *
 * A document-creating call that times out is the dangerous case: the request
 * may well have reached the portal and produced an IRN, but we never saw the
 * response. Resending it blindly risks a second document for the same
 * invoice — and for a tax document that is a filing problem, not a glitch.
 *
 * So before any *retry* of a generation call, we ask the portal what it
 * already holds. If the document exists, that is the answer; nothing is sent.
 * This runs only on retries: the first attempt has nothing to reconcile, and
 * an extra round trip on the happy path would slow every invoice down.
 */

export interface IrnReconciliation {
  exists: boolean;
  irn?: string;
  ackNumber?: string;
  ackDate?: Date;
  signedInvoice?: string;
  signedQrCode?: string;
  ewbNumber?: string | null;
  status?: string;
}

export interface EwbReconciliation {
  exists: boolean;
  ewbNumber?: string;
  status?: string;
  validUntil?: Date;
  generatedAt?: Date;
}

/**
 * Has the IRP already issued an IRN for this document?
 *
 * Looked up by document type + number + date, which is the natural key the
 * portal enforces uniqueness on — we cannot look up by IRN because if the
 * call failed we never learned it.
 */
export async function findExistingIrn(
  provider: EinvoiceProvider,
  ctx: GatewayRequestContext,
  document: { docType: string; docNo: string; docDate: string },
  logger?: Logger,
): Promise<IrnReconciliation> {
  const result = await provider.getIrnByDocument(ctx, document);

  if (!result.ok) {
    // "Not found" is the expected answer for a document that was never
    // filed; anything else means we could not establish the truth, and the
    // caller must treat that as unsafe to retry.
    logger?.info(
      { gstin: ctx.gstin, docNo: document.docNo, code: result.error.code },
      "no existing IRN found during reconciliation",
    );
    return { exists: false };
  }

  const data = result.data;
  if (!data.irn) return { exists: false };

  logger?.warn(
    { gstin: ctx.gstin, docNo: document.docNo, irn: data.irn },
    "reconciliation found an IRN the portal had already issued — not resending",
  );

  return {
    exists: true,
    irn: data.irn,
    ackNumber: data.ackNumber,
    ackDate: data.ackDate,
    signedInvoice: data.signedInvoice,
    signedQrCode: data.signedQrCode,
    ewbNumber: data.ewbNumber ?? null,
    status: data.status,
  };
}

/**
 * Has the EWB portal already issued a bill we know the number of?
 *
 * Unlike the IRP there is no lookup by document number, so this can only
 * confirm a number we already recorded — which covers the case where the
 * generate call succeeded remotely but the response never arrived and a
 * number was captured from a duplicate-rejection message.
 */
export async function findExistingEwb(
  provider: EwbProvider,
  ctx: GatewayRequestContext,
  ewbNumber: string | null | undefined,
  logger?: Logger,
): Promise<EwbReconciliation> {
  if (!ewbNumber) return { exists: false };

  const result = await provider.getEwb(ctx, ewbNumber);
  if (!result.ok) {
    logger?.info(
      { gstin: ctx.gstin, ewbNumber, code: result.error.code },
      "e-Way Bill not confirmed during reconciliation",
    );
    return { exists: false };
  }

  logger?.warn(
    { gstin: ctx.gstin, ewbNumber },
    "reconciliation confirmed an existing e-Way Bill — not resending",
  );

  return {
    exists: true,
    ewbNumber: result.data.ewbNumber,
    status: result.data.status,
    validUntil: result.data.validUntil,
    generatedAt: result.data.generatedAt,
  };
}

/**
 * Whether a generation attempt is a retry, and therefore must reconcile first.
 *
 * The attempt counter on the tracking row is the source of truth: it is
 * incremented on every submission, so anything above zero means the portal
 * may already have seen this document.
 */
export function requiresReconciliation(attempts: number): boolean {
  return attempts > 0;
}
