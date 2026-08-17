import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Locate the workspace root by walking up for the pnpm workspace marker.
 *
 * Relative paths in configuration must not be resolved against `process.cwd()`:
 * pnpm runs each service from its own package directory, so `./.storage` meant
 * `apps/api/.storage` in the API and `apps/worker/.storage` in the worker, and
 * the two processes silently stopped sharing files.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

/** Resolve a configured path against the workspace root, not the cwd. */
export function resolveFromRepoRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

/**
 * Single source of truth for environment configuration. Parsed once at
 * process start; a bad or missing variable fails fast with a readable error
 * instead of surfacing as a runtime null later.
 */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase()),
  );

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  /** 32-byte base64 key that wraps every tenant secret. Rotate via KEY_VERSION. */
  TRAXAC_MASTER_KEY: z.string().min(32, "TRAXAC_MASTER_KEY must be at least 32 chars"),
  TRAXAC_MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  /** Previous key, kept during a rotation so old ciphertext still decrypts. */
  TRAXAC_MASTER_KEY_PREVIOUS: z.string().optional(),

  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: boolish.default(false),

  /** Object storage. `local` writes under STORAGE_LOCAL_DIR for development. */
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish.default(true),

  /** Absolute path to the built web app. Defaults to apps/web/dist. */
  WEB_DIST_PATH: z.string().optional(),

  /** Government gateway defaults; per-tenant credentials override the base URL. */
  GST_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  /**
   * Gateway base URLs.
   *
   * Defaults live in the NIC client and were confirmed by probing the live
   * hosts. The e-Invoice sandbox has no public default: NIC issues that base
   * URL when an integrator registers, so it must be supplied here or on the
   * credential, and the client refuses to guess.
   */
  NIC_IRP_SANDBOX_BASE_URL: z.string().url().optional(),
  NIC_IRP_PRODUCTION_BASE_URL: z.string().url().optional(),
  NIC_EWB_SANDBOX_BASE_URL: z.string().url().optional(),
  NIC_EWB_PRODUCTION_BASE_URL: z.string().url().optional(),
  /** NIC issues these per integrator; without them the gateway stays disabled. */
  NIC_CLIENT_ID: z.string().optional(),
  NIC_CLIENT_SECRET: z.string().optional(),
  /**
   * NIC's RSA public key per environment, PEM or bare base64. Without it the
   * gateway refuses to authenticate rather than sending an unwrapped payload.
   */
  NIC_PUBLIC_KEY_SANDBOX: z.string().optional(),
  NIC_PUBLIC_KEY_PRODUCTION: z.string().optional(),
  GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2000),
  /** Injected by Railway; used only to label a worker in logs and job locks. */
  RAILWAY_REPLICA_ID: z.string().optional(),

  APP_URL: z.string().default("http://localhost:5173"),
  API_URL: z.string().default("http://localhost:3000"),
});

export type RawConfig = z.infer<typeof configSchema>;

export interface AppConfig extends RawConfig {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  corsOrigins: string[];
  /**
   * Whether to mark the session cookie `Secure`. Always true in production,
   * regardless of the environment variable — a forgotten flag must not be
   * able to put session cookies on the wire in clear text.
   */
  cookieSecure: boolean;
  /** STORAGE_LOCAL_DIR resolved to an absolute path against the repo root. */
  storageLocalDir: string;
  /** WEB_DIST_PATH resolved, defaulting to apps/web/dist. */
  webDistPath: string;
}

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;
  const isProduction = value.NODE_ENV === "production";
  cached = {
    ...value,
    isProduction,
    isDevelopment: value.NODE_ENV === "development",
    isTest: value.NODE_ENV === "test",
    corsOrigins: value.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    cookieSecure: isProduction || value.COOKIE_SECURE,
    storageLocalDir: resolveFromRepoRoot(value.STORAGE_LOCAL_DIR),
    webDistPath: value.WEB_DIST_PATH
      ? resolveFromRepoRoot(value.WEB_DIST_PATH)
      : resolve(REPO_ROOT, "apps/web/dist"),
  };
  if (cached.isProduction && cached.STORAGE_DRIVER === "local") {
    throw new Error("STORAGE_DRIVER=local is not allowed in production; configure S3");
  }
  return cached;
}

/** Test helper: forget the memoised config so a new env can be loaded. */
export function resetConfigCache(): void {
  cached = null;
}
