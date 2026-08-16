import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { shouldUseSsl } from "./index.js";

/**
 * Runs pending SQL migrations. Invoked on Railway as the release command and
 * locally via `pnpm db:migrate`. Uses a single short-lived connection.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, "../migrations");

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: shouldUseSsl(url) ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    console.log(`[migrate] up to date (${migrationsFolder})`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
