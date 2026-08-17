import { z } from "zod";
import { ROLES } from "../constants/roles.js";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  /**
   * Deliberately only bounded, not policy-checked. Enforcing the signup
   * policy here made a short wrong password fail validation with 422 and a
   * message describing the rule, instead of the 401 every failed sign-in
   * should return.
   */
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(200)
    .regex(/[a-z]/, "Add a lowercase letter")
    .regex(/[A-Z]/, "Add an uppercase letter")
    .regex(/[0-9]/, "Add a number"),
  businessName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(20).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  role: z.enum(ROLES).default("member"),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

export const switchTenantSchema = z.object({ tenantId: z.string().uuid() });

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  role: (typeof ROLES)[number];
  permissions: string[];
}
