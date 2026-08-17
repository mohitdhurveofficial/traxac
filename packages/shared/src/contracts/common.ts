import { z } from "zod";
import { isValidGstin } from "../gst/gstin.js";
import { isValidStateCode } from "../gst/states.js";
import { isValidHsn, isValidPan, isValidPincode, isValidVehicleNo } from "../gst/validate.js";
import { isValidUqc } from "../gst/units.js";

export const uuidSchema = z.string().uuid();

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidGstin, "Not a valid GSTIN (check the 15 characters and check digit)");

export const panSchema = z.string().trim().toUpperCase().refine(isValidPan, "Not a valid PAN");

export const stateCodeSchema = z.string().trim().refine(isValidStateCode, "Unknown GST state code");

export const pincodeSchema = z
  .string()
  .trim()
  .refine(isValidPincode, "Not a valid 6-digit PIN code");

export const hsnSchema = z.string().trim().refine(isValidHsn, "HSN/SAC must be 4, 6 or 8 digits");

export const uqcSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidUqc, "Not a valid unit code (UQC)");

export const vehicleNoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidVehicleNo, "Not a valid vehicle number");

/** Money accepted from clients as rupees; converted to paise at the boundary. */
export const rupeesSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Amount must have at most 2 decimals"),
]);

export const paiseSchema = z.number().int();

export const gstRateSchema = z.number().min(0).max(100);

export const addressSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(200).nullish(),
  gstin: z.string().trim().toUpperCase().nullish(),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  stateName: z.string().trim().max(100).nullish(),
  pincode: z.string().trim().max(10),
  phone: z.string().trim().max(20).nullish(),
  email: z.string().trim().email().max(120).nullish().or(z.literal("")),
  country: z.string().trim().max(2).nullish(),
});
export type AddressSnapshotInput = z.infer<typeof addressSnapshotSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  cursor: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const sortSchema = z.object({
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
});

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  page: number;
  hasMore: boolean;
}

export const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Every API error body has this shape. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
