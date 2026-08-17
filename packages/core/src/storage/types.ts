import type { Readable } from "node:stream";

/**
 * Object-storage abstraction. Development writes to disk; production writes to
 * any S3-compatible bucket (AWS, Cloudflare R2, Backblaze, MinIO). Business
 * code only ever sees this interface, so switching providers is configuration.
 */
export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  /** Cached metadata attached to the object where the provider supports it. */
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  checksumSha256: string;
}

export interface ObjectStorage {
  readonly provider: "s3" | "local";
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Time-limited download URL. Local driver returns an API-proxied path. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

/**
 * Storage keys are always tenant-prefixed. Deriving them in one place means a
 * bug cannot place one tenant's PDF where another tenant could list it.
 */
export function storageKey(input: {
  tenantId: string;
  kind: string;
  id: string;
  extension: string;
}): string {
  const ext = input.extension.replace(/^\./, "");
  return `tenants/${input.tenantId}/${input.kind}/${input.id}.${ext}`;
}
