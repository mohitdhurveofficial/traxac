import type { z } from "zod";
import type {
  createInvoiceSchema, invoiceListQuerySchema, previewInvoiceSchema, recordPaymentSchema,
} from "@traxac/shared/contracts";

/** Parsed contract types, re-exported so services do not import zod directly. */
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
export type PreviewInvoiceInput = z.infer<typeof previewInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
