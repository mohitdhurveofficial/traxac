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
  /**
   * Whether the driver can mint a time-limited URL that bypasses the API.
   * The filesystem driver cannot, so callers must fall back to an
   * authenticated API route rather than inventing a public path.
   */
  readonly supportsSignedUrls: boolean;
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /**
   * Time-limited download URL. Only valid when `supportsSignedUrls` is true;
   * otherwise it throws, because returning a guessable path would put tenant
   * documents outside the authorization boundary.
   */
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
