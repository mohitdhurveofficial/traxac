import { pgTable, text, uuid, bigint, integer, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { createdAt, tsCol } from "./_shared.js";

/**
 * Every stored binary: invoice PDFs, signed e-Invoice JSON, EWB PDFs, QR
 * images, logos and user attachments. Bytes live in object storage; this
 * table holds the metadata and the tenant-scoped storage key.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** invoice_pdf | einvoice_json | einvoice_qr | ewb_pdf | attachment | logo */
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(), // invoice | einvoice | eway_bill | tenant
    entityId: uuid("entity_id"),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    /** Provider-agnostic key: tenants/<tenantId>/<kind>/<uuid>.<ext> */
    storageKey: text("storage_key").notNull(),
    storageProvider: text("storage_provider").notNull().default("s3"),
    checksumSha256: text("checksum_sha256"),
    /**
     * What the file is, in the user's words: "Purchase order", "Lorry
     * receipt", "Insurance certificate". Free text because the list of things
     * a trader attaches is longer than any enum we would guess.
     */
    label: text("label"),
    notes: text("notes"),
    /** Set when the document was produced by the system rather than uploaded. */
    generatedBy: text("generated_by"),
    /** Counted so a download can be audited without scanning the audit log. */
    downloadCount: integer("download_count").notNull().default(0),
    lastDownloadedAt: tsCol("last_downloaded_at"),
    uploadedByUserId: uuid("uploaded_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("documents_tenant_idx").on(t.tenantId),
    index("documents_entity_idx").on(t.entityType, t.entityId),
    index("documents_tenant_kind_idx").on(t.tenantId, t.kind),
  ],
);
