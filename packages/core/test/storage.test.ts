import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { LocalObjectStorage, REPO_ROOT, resolveFromRepoRoot } from "../src/index.js";
import type { Container } from "../src/index.js";
import { createBusiness, resetDatabase, testContainer, type TestBusiness } from "./helpers.js";

/**
 * Shared document storage.
 *
 * The API and the worker run from different working directories under pnpm, so
 * a relative `STORAGE_LOCAL_DIR` resolved to a different folder in each
 * process: the worker wrote every PDF somewhere the API never looked, and
 * downloads 404'd. Storage paths are therefore anchored to the repository
 * root, not the current directory.
 */
describe("storage root resolution", () => {
  it("anchors a relative directory to the repo root, not the cwd", () => {
    const fromRoot = resolveFromRepoRoot("./.storage");
    expect(fromRoot).toBe(resolve(REPO_ROOT, ".storage"));
    expect(fromRoot.startsWith(REPO_ROOT)).toBe(true);
  });

  it("resolves identically no matter which package the process runs from", () => {
    const original = process.cwd();
    try {
      process.chdir(resolve(REPO_ROOT, "packages/core"));
      const fromCore = resolveFromRepoRoot("./.storage");
      process.chdir(resolve(REPO_ROOT, "packages/shared"));
      const fromShared = resolveFromRepoRoot("./.storage");
      expect(fromCore).toBe(fromShared);
    } finally {
      process.chdir(original);
    }
  });

  it("leaves an absolute path untouched", () => {
    expect(resolveFromRepoRoot("/var/data/ewayvo")).toBe("/var/data/ewayvo");
  });

  it("refuses a key that escapes the storage root", async () => {
    const storage = new LocalObjectStorage(resolveFromRepoRoot(".storage-test"));
    await expect(storage.get("../../../etc/passwd")).rejects.toThrow();
  });

  it("does not pretend it can sign URLs", async () => {
    const storage = new LocalObjectStorage(resolveFromRepoRoot(".storage-test"));
    expect(storage.supportsSignedUrls).toBe(false);
    // Returning a bare path here previously handed out an unauthenticated URL
    // to a tenant document — and pointed at a route that never existed.
    await expect(storage.signedUrl()).rejects.toThrow(/cannot sign/i);
  });
});

describe("document round-trip across processes", () => {
  let writer: Container;
  let reader: Container;
  let business: TestBusiness;

  beforeAll(async () => {
    // Two containers stand in for the worker and the API. They must agree on
    // where documents live.
    writer = await testContainer();
    await resetDatabase(writer);
    business = await createBusiness(writer, {
      slug: "storage",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
    });
    reader = await testContainer();
  }, 60_000);

  afterAll(async () => {
    await writer?.shutdown();
    await reader?.shutdown();
  });

  it("lets one process read what the other wrote", async () => {
    const stored = await writer.documents.store(business.ctx, {
      kind: "invoice_pdf",
      entityType: "invoice",
      entityId: business.gstinId,
      filename: "round-trip.pdf",
      contentType: "application/pdf",
      body: Buffer.from("%PDF-1.4 round trip"),
    });

    const { body, document } = await reader.documents.download(business.ctx, stored.id);
    expect(document.filename).toBe("round-trip.pdf");
    expect(body.toString()).toContain("round trip");
  });

  it("hands out an authenticated API path when the driver cannot presign", async () => {
    const stored = await writer.documents.store(business.ctx, {
      kind: "attachment",
      entityType: "invoice",
      entityId: business.gstinId,
      filename: "note.pdf",
      contentType: "application/pdf",
      body: Buffer.from("%PDF-1.4"),
    });

    const access = await reader.documents.accessUrl(business.ctx, stored.id);
    expect(access.direct).toBe(false);
    expect(access.url).toBe(`/api/v1/documents/${stored.id}`);
    expect(access.url).not.toContain("/raw/");
  });

  it("keeps documents tenant-scoped", async () => {
    const other = await createBusiness(writer, {
      slug: "storage-other",
      gstin: "29AAGCB7383J1Z4",
      stateCode: "29",
    });
    const stored = await writer.documents.store(business.ctx, {
      kind: "attachment",
      entityType: "invoice",
      entityId: business.gstinId,
      filename: "private.pdf",
      contentType: "application/pdf",
      body: Buffer.from("%PDF-1.4 private"),
    });
    await expect(reader.documents.download(other.ctx, stored.id)).rejects.toThrow(/not found/i);
  });
});
