/** Authenticated request context — the ONLY way tenant data is accessed. */

export type Role = "owner" | "admin" | "member" | "viewer";

export interface AuthContext {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
}

export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  owner: ["*"],
  admin: [
    "invoices:write", "parties:write", "products:write",
    "credentials:write", "invoices:finalize", "users:invite",
  ],
  member: ["invoices:write", "parties:write", "products:write"],
  viewer: ["invoices:read", "parties:read", "products:read"],
};

export function can(ctx: AuthContext, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[ctx.role];
  if (!perms) return false;
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}

/** Permission demanded of every data access: pass the session tenantId. */
export function assertSameTenant(ctx: AuthContext, tenantId: string): void {
  if (ctx.tenantId !== tenantId) {
    throw new TenantIsolationError(
      `Cross-tenant access blocked: ctx=${ctx.tenantId} row=${tenantId}`,
    );
  }
}

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}
