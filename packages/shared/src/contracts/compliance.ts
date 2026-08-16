import { z } from "zod";
import { vehicleNoSchema } from "./common.js";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/* ------------------------------- e-Invoice ------------------------------ */

export const generateEinvoiceSchema = z.object({
  /** Also generate the e-Way Bill in the same IRP call when possible. */
  withEwayBill: z.boolean().default(false),
});

export const cancelEinvoiceSchema = z.object({
  reasonCode: z.enum(["1", "2", "3", "4"]),
  remark: z.string().trim().min(3).max(100),
});
export type CancelEinvoiceInput = z.infer<typeof cancelEinvoiceSchema>;

/* ------------------------------ e-Way Bill ------------------------------ */

export const partBSchema = z.object({
  transportMode: z.coerce.number().int().min(1).max(4),
  vehicleNo: vehicleNoSchema.optional().or(z.literal("")),
  vehicleType: z.enum(["R", "O"]).default("R"),
  transportDocNo: optionalText(30),
  transportDocDate: z.coerce.date().optional().nullable(),
  /** Place from where the vehicle starts, required by the EWB API. */
  fromPlace: optionalText(50),
  fromStateCode: optionalText(2),
  /** 1=First 2=Second 3=Third ... reason codes for Part-B updates. */
  reasonCode: optionalText(3),
  reasonRemark: optionalText(100),
});
export type PartBInput = z.infer<typeof partBSchema>;

export const generateEwbSchema = z.object({
  distanceKm: z.coerce.number().int().min(0).max(4000).optional(),
  transporterId: z.string().uuid().optional().nullable(),
  partB: partBSchema.optional(),
});
export type GenerateEwbInput = z.infer<typeof generateEwbSchema>;

export const updateEwbTransporterSchema = z.object({
  /** 15-char GSTIN/TRANSIN of the new transporter. */
  transporterGstin: z.string().trim().toUpperCase().length(15),
});

export const extendEwbSchema = z.object({
  remainingDistanceKm: z.coerce.number().int().min(1).max(4000),
  /** 1=Natural Calamity 2=Law and Order 4=Transhipment 5=Accident 99=Others */
  reasonCode: z.enum(["1", "2", "4", "5", "99"]),
  reasonRemark: z.string().trim().min(3).max(100),
  /** Position of the consignment when extending. */
  currentPlace: z.string().trim().min(1).max(50),
  currentStateCode: z.string().trim().length(2),
  currentPincode: z.string().trim().length(6),
  /** 1=In Transit, 2=In Movement */
  transitType: z.enum(["1", "2"]).default("2"),
  partB: partBSchema.optional(),
});
export type ExtendEwbInput = z.infer<typeof extendEwbSchema>;

export const cancelEwbSchema = z.object({
  reasonCode: z.enum(["1", "2", "3", "4"]),
  remark: z.string().trim().min(3).max(100),
});
export type CancelEwbInput = z.infer<typeof cancelEwbSchema>;

/* ------------------------------ Credentials ----------------------------- */

export const saveCredentialSchema = z.object({
  gstinId: z.string().uuid(),
  provider: z.string().trim().min(2).max(40).default("nic"),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  service: z.enum(["einvoice", "ewb"]),
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
  /** GSP client credentials, when routing through a GST Suvidha Provider. */
  clientId: optionalText(200),
  clientSecret: z.string().max(300).optional().or(z.literal("")),
  /** Optional custom base URL for GSP sandboxes. */
  baseUrl: z.string().trim().url().optional().or(z.literal("")),
});
export type SaveCredentialInput = z.infer<typeof saveCredentialSchema>;

export const testCredentialSchema = z.object({ credentialId: z.string().uuid() });
