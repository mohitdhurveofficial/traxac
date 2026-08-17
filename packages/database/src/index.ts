import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
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
export * from "./schema/index.js";
export * from "./types.js";
