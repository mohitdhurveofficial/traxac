import { and, eq, type SQL } from "drizzle-orm";
import type { Database } from "@traxac/database";
import type { AuthContext } from "./context.js";
import { assertSameTenant } from "./context.js";

/**
 * Tenant-safe query helpers. Every read/write on tenant-owned tables MUST go
 * through these helpers so tenant isolation is enforced structurally.
 */
export function tenantScope(ctx: AuthContext, table: { tenantId: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  return eq(t.tenantId, ctx.tenantId);
}

/** WHERE tenantId = ctx AND id = $1 — single-row tenant-safe fetch. */
export function tenantWhere(
  ctx: AuthContext,
  table: { tenantId: unknown; id: unknown },
  id: string,
): SQL {
  assertSameTenant(ctx, ctx.tenantId); // paranoia check ctx integrity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  return and(eq(t.tenantId, ctx.tenantId), eq(t.id, id)) as SQL;
}

/** Attach tenant to insert values; throws if values carry a foreign tenant. */
export function withTenant<T extends { tenantId?: string }>(
  ctx: AuthContext,
  values: T,
): T & { tenantId: string } {
  if (values.tenantId && values.tenantId !== ctx.tenantId) {
    throw new Error("Insert blocked: values carry a foreign tenantId");
  }
  return { ...values, tenantId: ctx.tenantId };
}

export type { Database };
