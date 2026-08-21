import { AsyncLocalStorage } from "node:async_hooks";
import type { DrizzleClient, Transaction } from "./index.js";

/**
 * The ambient database scope for a unit of work.
 *
 * Row-level security reads `traxac.tenant_id` from the *connection*, so the
 * setting and the queries have to share one. Every service in the codebase
 * reaches for `database.db` — the pool — which hands out an arbitrary
 * connection per statement. Threading a transaction through 282 call sites by
 * hand would be a very large, very error-prone change, so the transaction
 * travels here instead and each service's `db` getter picks it up.
 *
 * The critical property is what happens when there is **no** scope. It must
 * throw. A fallback to the pool would be indistinguishable from working —
 * queries would succeed, RLS would be silently absent, and the whole exercise
 * would be decorative again. That is exactly the failure this replaces, so
 * `requireScope()` fails closed and loudly.
 */

export type ScopeKind =
  /** Pinned to one tenant; RLS policies apply. */
  | "tenant"
  /** Deliberately cross-tenant: the job claimer, migrations, auth bootstrap. */
  | "system";

export interface DbScope {
  kind: ScopeKind;
  /** Present only for a tenant scope. */
  tenantId?: string;
  /** The transaction the GUC was set on. All queries must use this. */
  tx: Transaction;
  /** Where the scope was opened, for diagnosing a leak. */
  origin: string;
}

const storage = new AsyncLocalStorage<DbScope>();

/** Run `fn` with `scope` as the ambient database scope. */
export function runInScope<T>(scope: DbScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** The current scope, or undefined outside any unit of work. */
export function currentScope(): DbScope | undefined {
  return storage.getStore();
}

/**
 * Thrown when database work is attempted with no scope established.
 *
 * This is a programming error, never a user error: some code path reached the
 * database without going through the request or job wrapper. It is deliberately
 * not an `AppError` — it must not be mapped to a tidy 4xx and forgotten.
 */
export class MissingDbScopeError extends Error {
  readonly code = "MISSING_DB_SCOPE";
  constructor(detail?: string) {
    super(
      "Database access attempted with no tenant scope established. " +
        "Every query must run inside withTenantScope() or withSystemScope(), " +
        "otherwise row-level security is not applied." +
        (detail ? ` (${detail})` : ""),
    );
    this.name = "MissingDbScopeError";
  }
}

/**
 * The executor every service must use.
 *
 * Returns the ambient transaction, or throws. `allowUnscoped` exists for the
 * handful of genuine bootstrap paths — resolving a session before the tenant
 * is even known — and each caller passes a reason that shows up in traces.
 */
export function requireScope(): Transaction {
  const scope = storage.getStore();
  if (!scope) throw new MissingDbScopeError();
  return scope.tx;
}

/**
 * Resolve the executor, falling back to the pool only where explicitly allowed.
 *
 * The only legitimate callers are the auth bootstrap (which cannot know the
 * tenant yet) and the queue claimer. Both pass a reason.
 */
export function resolveExecutor(pool: DrizzleClient, unscopedReason?: string): Transaction {
  const scope = storage.getStore();
  if (scope) return scope.tx;
  if (unscopedReason) return pool as unknown as Transaction;
  throw new MissingDbScopeError();
}

/** True when the caller is inside a deliberate cross-tenant scope. */
export function inSystemScope(): boolean {
  return storage.getStore()?.kind === "system";
}

/** The tenant the current scope is pinned to, if any. */
export function scopedTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}
