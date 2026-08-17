import { createDatabase, shouldUseSsl, type Database } from "@traxac/database";
import type { GatewayRegistry } from "@traxac/gst-gateway";
import { createNicRegistry, MemorySessionStore, type SessionStore } from "@traxac/nic-client";
import { loadConfig, type AppConfig } from "./config.js";
import { createLogger, type Logger } from "./infra/logger.js";
import { SecretBox } from "./infra/crypto.js";
import { DatabaseAuditWriter, type AuditWriter } from "./infra/audit.js";
import { JobQueue } from "./infra/queue.js";
import { createStorage, type ObjectStorage } from "./storage/index.js";
import { AuthService } from "./auth/service.js";
import { MastersService } from "./services/masters.js";
import { NumberingService } from "./services/numbering.js";
import { InvoiceService } from "./services/invoices.js";
import { DocumentService } from "./services/documents.js";
import { NotificationService } from "./services/notifications.js";
import { ReportService } from "./services/reports.js";
import { CredentialService, DatabaseSessionStore } from "./compliance/credentials.js";
import { DatabaseGatewayTelemetry } from "./compliance/telemetry.js";
import { ComplianceService } from "./compliance/service.js";

/**
 * Composition root. The API, the worker and any future process build the same
 * object graph from the same configuration, so business behaviour cannot
 * diverge between them.
 */
export interface Container {
  config: AppConfig;
  logger: Logger;
  database: Database;
  secrets: SecretBox;
  storage: ObjectStorage;
  queue: JobQueue;
  audit: AuditWriter;
  registry: GatewayRegistry;
  auth: AuthService;
  masters: MastersService;
  numbering: NumberingService;
  invoices: InvoiceService;
  documents: DocumentService;
  notifications: NotificationService;
  reports: ReportService;
  credentials: CredentialService;
  compliance: ComplianceService;
  shutdown(): Promise<void>;
}

export interface ContainerOptions {
  config?: AppConfig;
  logger?: Logger;
  /** Injected in tests to avoid touching the network. */
  registry?: GatewayRegistry;
  processName?: string;
}

export function createContainer(options: ContainerOptions = {}): Container {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger({
    level: config.LOG_LEVEL,
    pretty: config.isDevelopment,
    name: options.processName ?? "traxac",
  });

  const database = createDatabase(config.DATABASE_URL, {
    max: config.DATABASE_POOL_MAX,
    ssl: shouldUseSsl(config.DATABASE_URL),
  });

  const secrets = new SecretBox({
    masterKey: config.TRAXAC_MASTER_KEY,
    version: config.TRAXAC_MASTER_KEY_VERSION,
    previousKey: config.TRAXAC_MASTER_KEY_PREVIOUS,
  });

  const audit = new DatabaseAuditWriter(database, (err, entry) => {
    logger.error({ err, entry }, "failed to write audit log");
  });
  const storage = createStorage(config);
  const queue = new JobQueue(database);
  const telemetry = new DatabaseGatewayTelemetry(database, (err) => {
    logger.warn({ err }, "failed to record gateway call");
  });

  const credentials = new CredentialService(database, secrets, audit, {
    clientId: config.NIC_CLIENT_ID,
    clientSecret: config.NIC_CLIENT_SECRET,
  });

  // The gateway session store is keyed by the credential row so API and worker
  // processes share one portal token instead of each authenticating.
  const sessionStore: SessionStore = new MemorySessionStore();

  const registry = options.registry ?? createNicRegistry({
    publicKeys: {
      sandbox: process.env["NIC_PUBLIC_KEY_SANDBOX"],
      production: process.env["NIC_PUBLIC_KEY_PRODUCTION"],
    },
    timeoutMs: config.GATEWAY_TIMEOUT_MS,
    attempts: 3,
    store: sessionStore,
    telemetry,
  });

  const numbering = new NumberingService(database);
  const masters = new MastersService(database, audit);
  const invoices = new InvoiceService(database, numbering, audit);
  const documents = new DocumentService(database, storage, audit);
  const notifications = new NotificationService(database);
  const reports = new ReportService(database);
  const auth = new AuthService(database, { sessionTtlDays: config.SESSION_TTL_DAYS });

  const compliance = new ComplianceService({
    database,
    registry,
    credentials,
    queue,
    audit,
    defaultEnvironment: config.GST_ENVIRONMENT,
  });

  return {
    config,
    logger,
    database,
    secrets,
    storage,
    queue,
    audit,
    registry,
    auth,
    masters,
    numbering,
    invoices,
    documents,
    notifications,
    reports,
    credentials,
    compliance,
    async shutdown() {
      await database.close();
    },
  };
}

export { DatabaseSessionStore };
