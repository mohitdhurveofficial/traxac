/**
 * Creates the non-superuser role the application should run as.
 *
 * Row-level security is silently inert for a superuser — Postgres bypasses
 * every policy, FORCE or not — so a deployment that connects as the database
 * owner has RLS in name only. This script provisions `traxac_app` with
 * exactly the privileges the application needs and nothing more, and the RLS
 * test suite connects as it to prove the policies actually bite.
 *
 *   node scripts/create-app-role.mjs                       # against DATABASE_URL
 *   TARGET_DATABASE_URL=… node scripts/create-app-role.mjs
 */
import postgres from "postgres";

const url =
  process.env["TARGET_DATABASE_URL"] ??
  process.env["TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"];
if (!url) {
  console.error("Set DATABASE_URL (or TEST_DATABASE_URL) first.");
  process.exit(1);
}

const role = process.env["APP_ROLE_NAME"] ?? "traxac_app";
const password = process.env["APP_ROLE_PASSWORD"] ?? "app_role_pw";

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const [{ current_database: database }] = await sql`SELECT current_database()`;

  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE ${role} LOGIN PASSWORD '${password}';
      ELSE
        ALTER ROLE ${role} LOGIN PASSWORD '${password}';
      END IF;
    END $$;
  `);

  // Deliberately no CREATE, no schema ownership, and no BYPASSRLS: the role
  // reads and writes rows, and the policies decide which ones.
  await sql.unsafe(`
    GRANT CONNECT ON DATABASE "${database}" TO ${role};
    GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${role};
  `);

  const [check] = await sql`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${role}
  `;
  if (check.rolsuper || check.rolbypassrls) {
    throw new Error(`${role} must not be a superuser or have BYPASSRLS`);
  }

  console.log(`${role} ready on ${database} (not superuser, RLS applies)`);
} finally {
  await sql.end({ timeout: 5 });
}
