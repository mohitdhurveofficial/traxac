import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { currentScope, runInScope } from "./scope.js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type DrizzleClient = ReturnType<typeof drizzle<Schema>>;

/**
 * Anything that can run a query: the pool-backed client or an open
 * transaction. Services accept this so a helper works inside or outside a
 * transaction without duplicating the code.
 */
export type Transaction = Parameters<Parameters<DrizzleClient["transaction"]>[0]>[0];
export type DbExecutor = DrizzleClient | Transaction;

export interface Database {
  db: DrizzleClient;
  client: postgres.Sql;
  schema: Schema;
  /**
   * Run work with the connection pinned to one tenant.
   *
   * Row-level security reads `traxac.tenant_id` from the connection. Pooled
   * connections are shared, so the setting has to be established and torn
   * down around each unit of work — otherwise request B inherits request A's
   * tenant, which is a far worse bug than having no RLS at all.
   *
   * A transaction is the mechanism: `set_config(..., true)` is
   * transaction-local, so Postgres discards it at COMMIT or ROLLBACK. There
   * is no path — not an early return, not a thrown error — by which the
   * setting outlives the work it was established for.
   */
  withTenant<T>(tenantId: string, fn: (db: Transaction) => Promise<T>): Promise<T>;
  /**
   * Run work that legitimately spans tenants: migrations, the job claimer,
   * housekeeping. Explicit and auditable rather than implicit.
   */
  withoutTenantScope<T>(fn: (db: Transaction) => Promise<T>): Promise<T>;
  /**
   * Run `fn` pinned to one tenant, with the transaction published as the
   * ambient scope so every service picks it up without threading a parameter
   * through hundreds of call sites.
   */
  withTenantScope<T>(tenantId: string, origin: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Run `fn` deliberately across tenants — the job claimer, housekeeping,
   * resolving a session before the tenant is known. `origin` is required so
   * every bypass is attributable in a trace.
   */
  withSystemScope<T>(origin: string, fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  max?: number;
  /** Railway/managed Postgres terminates plain connections; enable TLS there. */
  ssl?: boolean;
  onNotice?: (notice: unknown) => void;
}

export function createDatabase(databaseUrl: string, options: CreateDatabaseOptions = {}): Database {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Transaction-pooled providers (PgBouncer, Railway proxy) reject prepares.
    prepare: false,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    onnotice: options.onNotice ? (n) => options.onNotice?.(n) : () => {},
  });
  const db = drizzle(client, { schema });

  /**
   * Open a transaction, set the connection settings inside it, run the work.
   *
   * `set_config(key, value, true)` is transaction-local: Postgres discards it
   * when the transaction ends, however it ends. That is what makes this safe
   * on a shared pool — a connection can never be handed back still carrying
   * someone else's tenant.
   */
  async function withSettings<T>(
    settings: Record<string, string>,
    fn: (scoped: Transaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(settings)) {
        await tx.execute(sql`SELECT set_config(${key}, ${value}, true)`);
      }
      return fn(tx);
    });
  }

  return {
    db,
    client,
    schema,
    withTenant: (tenantId, fn) => withSettings({ "traxac.tenant_id": tenantId }, fn),
    withoutTenantScope: (fn) => withSettings({ "traxac.bypass": "on" }, fn),
    /*
     * Nesting reuses the ambient transaction rather than opening another.
     *
     * A second transaction would land on a different pooled connection and
     * immediately contend for the locks the outer one already holds — a
     * self-deadlock that only shows up under load. One scope per unit of work
     * is also what makes the tenant setting meaningful: the whole request
     * either sees one tenant or fails.
     */
    withTenantScope: (tenantId, origin, fn) => {
      const active = currentScope();
      if (active) {
        if (active.kind === "tenant" && active.tenantId !== tenantId) {
          throw new Error(
            `Refusing to switch tenant mid-transaction: scope "${active.origin}" is pinned to ` +
              `${active.tenantId}, but "${origin}" asked for ${tenantId}.`,
          );
        }
        return fn();
      }
      return withSettings({ "traxac.tenant_id": tenantId }, (tx) =>
        runInScope({ kind: "tenant", tenantId, tx, origin }, fn),
      );
    },
    withSystemScope: (origin, fn) => {
      const active = currentScope();
      // A system scope inside a tenant scope would widen visibility silently,
      // so it is only reused when the ambient scope is already system-level.
      if (active?.kind === "system") return fn();
      return withSettings({ "traxac.bypass": "on" }, (tx) =>
        runInScope({ kind: "system", tx, origin }, fn),
      );
    },
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

/** True when the connection string points at a managed provider needing TLS. */
export function shouldUseSsl(databaseUrl: string): boolean {
  if (/sslmode=disable/.test(databaseUrl)) return false;
  if (/sslmode=require/.test(databaseUrl)) return true;
  return !/(localhost|127\.0\.0\.1)/.test(databaseUrl);
}

export { schema };
export * from "./scope.js";
export * from "./schema/index.js";
export * from "./types.js";
