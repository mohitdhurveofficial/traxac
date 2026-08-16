import { pino, type Logger } from "pino";

/**
 * Structured logging. Secrets and government credentials must never reach the
 * log stream, so known-sensitive paths are redacted at the logger level rather
 * than relying on every call site to remember.
 */
export const REDACTED_PATHS = [
  "password", "*.password", "*.Password",
  "clientSecret", "*.clientSecret", "*.ClientSecret",
  "token", "*.token", "*.AuthToken", "*.authToken",
  "sek", "*.Sek", "*.sek",
  "encryptedPayload", "*.encryptedPayload",
  "authorization", "req.headers.authorization", "req.headers.cookie",
  "*.passwordHash", "*.tokenHash", "*.keyHash",
];

export function createLogger(options: {
  level?: string;
  pretty?: boolean;
  name?: string;
} = {}): Logger {
  return pino({
    name: options.name ?? "traxac",
    level: options.level ?? "info",
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: options.pretty
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
      : undefined,
  });
}

export type { Logger };
