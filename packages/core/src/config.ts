import { z } from "zod";

/**
 * Single source of truth for environment configuration. Parsed once at
 * process start; a bad or missing variable fails fast with a readable error
 * instead of surfacing as a runtime null later.
 */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

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

  /** Government gateway defaults; per-tenant credentials override the base URL. */
  GST_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  IRP_SANDBOX_BASE_URL: z.string().default("https://einv-apisandbox.nic.in"),
  IRP_PRODUCTION_BASE_URL: z.string().default("https://einvoice1.gst.gov.in"),
  EWB_SANDBOX_BASE_URL: z.string().default("https://einv-apisandbox.nic.in"),
  EWB_PRODUCTION_BASE_URL: z.string().default("https://ewaybillgst.gov.in"),
  /** NIC issues these per integrator; without them the gateway stays disabled. */
  NIC_CLIENT_ID: z.string().optional(),
  NIC_CLIENT_SECRET: z.string().optional(),
  GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2000),

  APP_URL: z.string().default("http://localhost:5173"),
  API_URL: z.string().default("http://localhost:3000"),
});

export type RawConfig = z.infer<typeof configSchema>;

export interface AppConfig extends RawConfig {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  corsOrigins: string[];
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
  cached = {
    ...value,
    isProduction: value.NODE_ENV === "production",
    isDevelopment: value.NODE_ENV === "development",
    isTest: value.NODE_ENV === "test",
    corsOrigins: value.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
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
