import { z } from "zod";
import {
  gstinSchema,
  hsnSchema,
  panSchema,
  pincodeSchema,
  rupeesSchema,
  stateCodeSchema,
  uqcSchema,
  vehicleNoSchema,
  gstRateSchema,
} from "./common.js";
import { PARTY_TYPES, REGISTRATION_TYPES } from "../constants/status.js";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/* ------------------------------- GSTINs -------------------------------- */

export const createGstinSchema = z.object({
  gstin: gstinSchema,
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().min(2).max(200),
  registrationType: z.enum(["regular", "composition", "sez", "casual", "isd"]).default("regular"),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
  phone: optionalText(20),
  email: z.string().trim().email().optional().or(z.literal("")),
  einvoiceEnabled: z.boolean().default(true),
  ewbEnabled: z.boolean().default(true),
  isPrimary: z.boolean().default(false),
});
export type CreateGstinInput = z.infer<typeof createGstinSchema>;
export const updateGstinSchema = createGstinSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/* ------------------------------- Branches ------------------------------- */

export const createBranchSchema = z.object({
  gstinId: z.string().uuid(),
  code: optionalText(30),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(["branch", "warehouse", "plant", "office"]).default("branch"),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
  phone: optionalText(20),
  isDefault: z.boolean().default(false),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export const updateBranchSchema = createBranchSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/* -------------------------------- Parties ------------------------------- */

export const createPartySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    legalName: optionalText(200),
    partyType: z.enum(PARTY_TYPES).default("customer"),
    gstin: gstinSchema.optional().or(z.literal("")),
    pan: panSchema.optional().or(z.literal("")),
    registrationType: z.enum(REGISTRATION_TYPES).default("regular"),
    email: z.string().trim().email().optional().or(z.literal("")),
    phone: optionalText(20),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(100),
    stateCode: stateCodeSchema.optional().or(z.literal("")),
    pincode: z.string().trim().max(10).optional().or(z.literal("")),
    country: z.string().trim().length(2).default("IN"),
    defaultPlaceOfSupply: stateCodeSchema.optional().or(z.literal("")),
    creditDays: z.coerce.number().int().min(0).max(365).optional(),
    notes: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    const needsGstin =
      value.registrationType === "regular" ||
      value.registrationType === "composition" ||
      value.registrationType === "sez";
    if (needsGstin && !value.gstin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gstin"],
        message: "A GSTIN is required for this registration type",
      });
    }
    if (value.registrationType !== "overseas" && !value.stateCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stateCode"],
        message: "State is required",
      });
    }
  });
export type CreatePartyInput = z.infer<typeof createPartySchema>;

export const updatePartySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legalName: optionalText(200),
  partyType: z.enum(PARTY_TYPES).optional(),
  gstin: gstinSchema.optional().or(z.literal("")),
  pan: panSchema.optional().or(z.literal("")),
  registrationType: z.enum(REGISTRATION_TYPES).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: optionalText(20),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  stateCode: stateCodeSchema.optional().or(z.literal("")),
  pincode: z.string().trim().max(10).optional().or(z.literal("")),
  country: z.string().trim().length(2).optional(),
  defaultPlaceOfSupply: stateCodeSchema.optional().or(z.literal("")),
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: optionalText(1000),
  isActive: z.boolean().optional(),
});

export const createPartyAddressSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["shipping", "billing", "dispatch"]).default("shipping"),
  gstin: gstinSchema.optional().or(z.literal("")),
  name: z.string().trim().min(1).max(200),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1).max(100),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
  phone: optionalText(20),
  isDefault: z.boolean().default(false),
});
export type CreatePartyAddressInput = z.infer<typeof createPartyAddressSchema>;

/* -------------------------------- Products ------------------------------ */

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: optionalText(1000),
  sku: optionalText(60),
  hsnSac: hsnSchema,
  isService: z.boolean().default(false),
  gstRate: gstRateSchema.default(0),
  cessRate: gstRateSchema.default(0),
  unit: uqcSchema.default("NOS"),
  unitPrice: rupeesSchema.default(0),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;
export const updateProductSchema = createProductSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/* ------------------------------ Transporters ---------------------------- */

export const createTransporterSchema = z.object({
  name: z.string().trim().min(1).max(200),
  transporterId: z
    .string()
    .trim()
    .toUpperCase()
    .length(15, "Transporter ID / GSTIN must be 15 characters")
    .optional()
    .or(z.literal("")),
  phone: optionalText(20),
  email: z.string().trim().email().optional().or(z.literal("")),
  addressLine1: optionalText(200),
  city: optionalText(100),
  stateCode: stateCodeSchema.optional().or(z.literal("")),
  pincode: z.string().trim().max(10).optional().or(z.literal("")),
});
export type CreateTransporterInput = z.infer<typeof createTransporterSchema>;
export const updateTransporterSchema = createTransporterSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/* -------------------------------- Vehicles ------------------------------ */

export const createVehicleSchema = z.object({
  vehicleNo: vehicleNoSchema,
  vehicleType: z.enum(["R", "O"]).default("R"),
  transporterId: z.string().uuid().optional().nullable(),
  driverName: optionalText(120),
  driverPhone: optionalText(20),
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export const updateVehicleSchema = createVehicleSchema.partial().extend({
  isActive: z.boolean().optional(),
});
