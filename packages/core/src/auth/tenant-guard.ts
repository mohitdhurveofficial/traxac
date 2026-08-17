import { and, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { AuthContext } from "./context.js";

/**
 * Tenant-scoping helpers. Every query against a tenant-owned table is built
 * with one of these so the `tenant_id = $ctx` predicate cannot be forgotten.
 */
type TenantTable = PgTable & { tenantId: PgColumn };
type TenantRowTable = TenantTable & { id: PgColumn };

/** `WHERE tenant_id = <ctx.tenantId>` plus any extra predicates. */
export function scoped(
  ctx: AuthContext,
  table: TenantTable,
  ...extra: Array<SQLWrapper | undefined>
): SQL {
  const clauses = [eq(table.tenantId, ctx.tenantId), ...extra.filter(Boolean)] as SQLWrapper[];
  return and(...clauses) as SQL;
}

/** `WHERE tenant_id = <ctx.tenantId> AND id = <id>`. */
export function scopedById(ctx: AuthContext, table: TenantRowTable, id: string): SQL {
  return and(eq(table.tenantId, ctx.tenantId), eq(table.id, id)) as SQL;
}

/**
 * Restrict master data to the active registration.
 *
 * Rows with a null `gstinId` are shared across registrations and always
 * visible; that is what a single-GSTIN business has, and what existing rows
 * migrated to. Returns undefined when no registration is active, so the
 * predicate simply drops out of the query.
 */
export function scopedToGstin(ctx: AuthContext, column: PgColumn): SQL | undefined {
  if (!ctx.activeGstinId) return undefined;
  return sql`(${column} = ${ctx.activeGstinId} OR ${column} IS NULL)`;
}

/** Stamp the caller's tenant onto an insert, rejecting a foreign tenantId. */
export function withTenant<T extends Record<string, unknown>>(
  ctx: AuthContext,
  values: T,
): T & { tenantId: string } {
  const supplied = values["tenantId"];
  if (typeof supplied === "string" && supplied !== ctx.tenantId) {
    throw new Error("Insert blocked: values carry a foreign tenantId");
  }
  return { ...values, tenantId: ctx.tenantId };
}
