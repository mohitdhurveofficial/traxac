import { AppError, type Permission, type Role, roleHasPermission } from "@traxac/shared";

/**
 * The authenticated caller. Every service function takes this as its first
 * argument — there is no ambient "current user", so a missing context is a
 * compile error rather than a silent cross-tenant read.
 */
export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  role: Role;
  /** session | api_key | system */
  actor: "session" | "api_key" | "system";
  sessionId?: string;
  apiKeyId?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

/** Context used by background workers, which act on behalf of a tenant. */
export function systemContext(tenantId: string, label = "system:worker"): AuthContext {
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    email: label,
    name: label,
    tenantId,
    role: "owner",
    actor: "system",
  };
}

export function can(ctx: AuthContext, permission: Permission): boolean {
  if (ctx.actor === "system") return true;
  return roleHasPermission(ctx.role, permission);
}

/** Throws unless the caller holds the permission. */
export function requirePermission(ctx: AuthContext, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new AppError("FORBIDDEN", `Your role (${ctx.role}) cannot ${permission}`);
  }
}

export class TenantIsolationError extends AppError {
  constructor(expected: string, actual: string) {
    super("TENANT_ISOLATION", "Resource does not belong to your business", {
      details: { expected, actual },
    });
    this.name = "TenantIsolationError";
  }
}

/** Last line of defence: assert a loaded row belongs to the caller's tenant. */
export function assertSameTenant(ctx: AuthContext, row: { tenantId: string | null }): void {
  if (row.tenantId !== ctx.tenantId) {
    throw new TenantIsolationError(ctx.tenantId, row.tenantId ?? "null");
  }
}

export function actorLabel(ctx: AuthContext): string {
  if (ctx.actor === "api_key") return `apikey:${ctx.apiKeyId ?? "unknown"}`;
  if (ctx.actor === "system") return ctx.email;
  return ctx.email;
}
