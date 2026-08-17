import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { AppError } from "@traxac/shared";
import type { ObjectStorage, PutObjectInput, StoredObject } from "./types.js";

/**
 * Filesystem storage for local development and tests. Rejected in production
 * by the config loader, because Railway containers have ephemeral disks.
 */
export class LocalObjectStorage implements ObjectStorage {
  readonly provider = "local" as const;
  /** No signing: there is no CDN in front of the filesystem to honour it. */
  readonly supportsSignedUrls = false;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** Resolve a key inside the root, refusing traversal outside it. */
  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new AppError("VALIDATION_FAILED", "Invalid storage key");
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    const body = Buffer.isBuffer(input.body)
      ? input.body
      : Buffer.from(input.body);
    await writeFile(path, body);
    return {
      key: input.key,
      size: body.byteLength,
      contentType: input.contentType,
      checksumSha256: createHash("sha256").update(body).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      throw new AppError("NOT_FOUND", "Stored file not found");
    }
  }

  async getStream(key: string): Promise<Readable> {
    if (!(await this.exists(key))) throw new AppError("NOT_FOUND", "Stored file not found");
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async signedUrl(): Promise<string> {
    // Downloads are proxied through the authenticated API instead. Returning
    // a bare path here would have handed out an unauthenticated URL to a
    // tenant's document — and the route it pointed at never existed.
    throw new AppError(
      "INVALID_STATE",
      "The local storage driver cannot sign URLs; download through the API instead",
    );
  }
}
