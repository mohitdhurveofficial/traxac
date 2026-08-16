import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type DrizzleClient = ReturnType<typeof drizzle<Schema>>;

export interface Database {
  db: DrizzleClient;
  client: postgres.Sql;
  schema: Schema;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  max?: number;
  /** Railway/managed Postgres terminates plain connections; enable TLS there. */
  ssl?: boolean;
  onNotice?: (notice: unknown) => void;
}

export function createDatabase(
  databaseUrl: string,
  options: CreateDatabaseOptions = {},
): Database {
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
  return {
    db,
    client,
    schema,
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
