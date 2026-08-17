import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { shouldUseSsl } from "./index.js";

/**
 * Load a local .env when one exists.
 *
 * On Railway the platform injects the environment directly and there is no
 * file; locally the developer expects `pnpm db:migrate` to just work. Passing
 * `--env-file` on the command line would have made the deploy fail outright
 * on the missing file.
 */
function loadLocalEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "../../../.env"), resolve(process.cwd(), ".env")]) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // A malformed local file must not stop a deploy that does not need it.
    }
    return;
  }
}

/**
 * Runs pending SQL migrations. Invoked on Railway as the pre-deploy command
 * and locally via `pnpm db:migrate`. Uses a single short-lived connection.
 */
async function main(): Promise<void> {
  loadLocalEnv();

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
