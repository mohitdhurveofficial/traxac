import { and, desc, eq } from "drizzle-orm";
import type { Database, Document } from "@traxac/database";
import { documents } from "@traxac/database";
import { AppError, type DocumentKind } from "@traxac/shared";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";
import { storageKey, type ObjectStorage } from "../storage/index.js";

export interface StoreDocumentInput {
  kind: DocumentKind;
  entityType: "invoice" | "einvoice" | "eway_bill" | "tenant";
  entityId?: string | null;
  filename: string;
  contentType: string;
  body: Buffer | string;
  /** Replace the existing document of this kind for the entity. */
  replace?: boolean;
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/json": "json",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/csv": "csv",
};

/**
 * Document store: metadata in Postgres, bytes in object storage. Keys are
 * always tenant-prefixed, and reads go through a tenant-scoped lookup, so one
 * business can never fetch another's PDF even if it guesses a key.
 */
export class DocumentService {
  constructor(
    private readonly database: Database,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditWriter,
  ) {}

  private get db() {
    return this.database.db;
  }

  async store(ctx: AuthContext, input: StoreDocumentInput): Promise<Document> {
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body, "utf8");
    if (body.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new AppError("VALIDATION_FAILED", "Files must be 20 MB or smaller");
    }

    if (input.replace && input.entityId) {
      await this.removeByEntity(ctx, input.kind, input.entityType, input.entityId);
    }

    const id = crypto.randomUUID();
    const key = storageKey({
      tenantId: ctx.tenantId,
      kind: input.kind,
      id,
      extension: EXTENSION_BY_TYPE[input.contentType] ?? "bin",
    });
    const stored = await this.storage.put({
      key,
      body,
      contentType: input.contentType,
      metadata: { tenantId: ctx.tenantId, kind: input.kind },
    });

    const [row] = await this.db.insert(documents).values({
      id,
      tenantId: ctx.tenantId,
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: stored.size,
      storageKey: stored.key,
      storageProvider: this.storage.provider,
      checksumSha256: stored.checksumSha256,
      uploadedByUserId: ctx.actor === "system" ? null : ctx.userId,
    }).returning();
    if (!row) throw new AppError("INTERNAL", "Could not record the document");

    if (input.kind === "attachment") {
      await this.audit.record(ctx, {
        action: "document.uploaded",
        entityType: input.entityType,
        entityId: input.entityId ?? row.id,
        summary: input.filename,
      });
    }
    return row;
  }

  async listFor(ctx: AuthContext, entityType: string, entityId: string): Promise<Document[]> {
    return this.db.select().from(documents)
      .where(scoped(ctx, documents,
        eq(documents.entityType, entityType), eq(documents.entityId, entityId)))
      .orderBy(desc(documents.createdAt));
  }

  async get(ctx: AuthContext, id: string): Promise<Document> {
    const [row] = await this.db.select().from(documents)
      .where(scopedById(ctx, documents, id)).limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Document not found");
    return row;
  }

  async findByKind(
    ctx: AuthContext,
    kind: DocumentKind,
    entityType: string,
    entityId: string,
  ): Promise<Document | null> {
    const [row] = await this.db.select().from(documents)
      .where(scoped(ctx, documents,
        eq(documents.kind, kind),
        eq(documents.entityType, entityType),
        eq(documents.entityId, entityId)))
      .orderBy(desc(documents.createdAt)).limit(1);
    return row ?? null;
  }

  async download(ctx: AuthContext, id: string): Promise<{ document: Document; body: Buffer }> {
    const document = await this.get(ctx, id);
    return { document, body: await this.storage.get(document.storageKey) };
  }

  /** Short-lived link, used when the browser downloads straight from storage. */
  async signedUrl(ctx: AuthContext, id: string, expiresInSeconds = 900): Promise<string> {
    const document = await this.get(ctx, id);
    return this.storage.signedUrl(document.storageKey, expiresInSeconds);
  }

  async remove(ctx: AuthContext, id: string): Promise<void> {
    requirePermission(ctx, "documents:write");
    const document = await this.get(ctx, id);
    await this.storage.delete(document.storageKey).catch(() => undefined);
    await this.db.delete(documents).where(eq(documents.id, id));
    await this.audit.record(ctx, {
      action: "document.deleted",
      entityType: document.entityType,
      entityId: document.entityId ?? id,
      summary: document.filename,
    });
  }

  private async removeByEntity(
    ctx: AuthContext,
    kind: DocumentKind,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    const rows = await this.db.select().from(documents)
      .where(scoped(ctx, documents,
        eq(documents.kind, kind),
        eq(documents.entityType, entityType),
        eq(documents.entityId, entityId)));
    for (const row of rows) {
      await this.storage.delete(row.storageKey).catch(() => undefined);
    }
    if (rows.length) {
      await this.db.delete(documents).where(and(
        eq(documents.tenantId, ctx.tenantId),
        eq(documents.kind, kind),
        eq(documents.entityType, entityType),
        eq(documents.entityId, entityId),
      ));
    }
  }
}
