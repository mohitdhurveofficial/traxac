/** Environment configuration resolved once per process. */
export interface AppConfig {
  env: "development" | "production" | "test";
  databaseUrl: string;
  port: number;
  /** Master encryption key (base64, 32 bytes) for credential envelope encryption. */
  masterKey: string;
  jwtSecret: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): AppConfig {
  const env = (process.env.NODE_ENV ?? "development") as AppConfig["env"];
  return {
    env,
    databaseUrl: required("DATABASE_URL"),
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    masterKey: required("TRAXAC_MASTER_KEY"),
    jwtSecret: required("TRAXAC_JWT_SECRET"),
  };
}
