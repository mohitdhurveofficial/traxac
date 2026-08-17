import { z } from "zod";
import { gstRateSchema, rupeesSchema, stateCodeSchema } from "./common.js";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/* ---------------------------- Payment terms ----------------------------- */

export const paymentTermSchema = z.object({
  name: z.string().trim().min(1).max(80),
  creditDays: z.coerce.number().int().min(0).max(365).default(0),
  description: optionalText(200),
  isDefault: z.boolean().default(false),
});
export type PaymentTermInput = z.infer<typeof paymentTermSchema>;

/* ----------------------------- Tax settings ----------------------------- */

export const taxSettingsSchema = z.object({
  tcsEnabled: z.boolean().default(false),
  tcsRate: z.coerce.number().min(0).max(10).default(0.1),
  tcsSection: z.string().trim().max(20).default("206C(1H)"),
  roundOffEnabled: z.boolean().default(true),
  igstOnIntraDefault: z.boolean().default(false),
});
export type TaxSettingsInput = z.infer<typeof taxSettingsSchema>;

/* -------------------------------- Import -------------------------------- */

/**
 * Bulk import.
 *
 * Rows are validated one at a time and reported individually: a spreadsheet
 * with one bad PIN code should import the other 499 rows and tell the user
 * exactly which one failed, not reject the whole file.
 */
export const importKindSchema = z.enum([
  "customers",
  "suppliers",
  "products",
  "transporters",
  "vehicles",
]);
export type ImportKind = z.infer<typeof importKindSchema>;

export const importRequestSchema = z.object({
  kind: importKindSchema,
  /** Parsed rows, already converted from CSV by the client. */
  rows: z.array(z.record(z.string(), z.string())).min(1).max(5000),
  /** Preview without writing anything. */
  dryRun: z.boolean().default(false),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export interface ImportRowResult {
  row: number;
  status: "created" | "updated" | "skipped" | "failed";
  id?: string;
  name?: string;
  message?: string;
}

export interface ImportResult {
  kind: ImportKind;
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  results: ImportRowResult[];
}

/* -------------------------------- GSTR-1 -------------------------------- */

export const gstr1RequestSchema = z.object({
  gstinId: z.string().uuid(),
  /** Tax period as MMYYYY, the format GSTN uses. */
  period: z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/, "Period must be MMYYYY"),
});
export type Gstr1Request = z.infer<typeof gstr1RequestSchema>;

/* ---------------------------- Reconciliation ---------------------------- */

export const reconciliationRequestSchema = z.object({
  gstinId: z.string().uuid(),
  scope: z.enum(["einvoice", "ewb", "gstr1"]),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM"),
  source: z.enum(["portal", "upload", "manual"]).default("portal"),
});

/* ------------------------------ Warehouses ------------------------------ */

export const warehouseSchema = z.object({
  gstinId: z.string().uuid(),
  code: optionalText(30),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(["branch", "warehouse", "plant", "office"]).default("warehouse"),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  pincode: z.string().trim().length(6),
  phone: optionalText(20),
  isDefault: z.boolean().default(false),
});

/* ------------------------------ HSN master ------------------------------ */

export const hsnUpsertSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "HSN/SAC must be 4 to 8 digits"),
  description: z.string().trim().min(2).max(300),
  defaultGstRate: gstRateSchema.optional(),
  isService: z.boolean().default(false),
});

/* ------------------------------- Payments ------------------------------- */

export const paymentFilterSchema = z.object({
  partyId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  method: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).default(1),
});

export const receivablesFilterSchema = z.object({
  gstinId: z.string().uuid().optional(),
  partyId: z.string().uuid().optional(),
  overdueOnly: z.coerce.boolean().default(false),
  /** Ageing buckets in days, ascending. */
  buckets: z.array(z.coerce.number().int().positive()).default([30, 60, 90]),
});

export { rupeesSchema };
