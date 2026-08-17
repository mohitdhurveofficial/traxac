import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "@traxac/shared";
import type { ObjectStorage, PutObjectInput, StoredObject } from "./types.js";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle?: boolean;
}

/** S3-compatible storage: AWS S3, Cloudflare R2, Backblaze B2, MinIO. */
export class S3ObjectStorage implements ObjectStorage {
  readonly provider = "s3" as const;
  readonly supportsSignedUrls = true;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const body = Buffer.isBuffer(input.body)
      ? input.body
      : Buffer.from(input.body);
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: body,
      ContentType: input.contentType,
      Metadata: input.metadata,
      ChecksumAlgorithm: "SHA256",
    }));
    return {
      key: input.key,
      size: body.byteLength,
      contentType: input.contentType,
      checksumSha256: createHash("sha256").update(body).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket, Key: key,
    })).catch(() => null);
    if (!res?.Body) throw new AppError("NOT_FOUND", "Stored file not found");
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket, Key: key,
    })).catch(() => null);
    if (!res?.Body) throw new AppError("NOT_FOUND", "Stored file not found");
    return res.Body as Readable;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async signedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
