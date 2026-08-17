import type { AppConfig } from "../config.js";
import { LocalObjectStorage } from "./local.js";
import { S3ObjectStorage } from "./s3.js";
import type { ObjectStorage } from "./types.js";

export * from "./types.js";
export { LocalObjectStorage } from "./local.js";
export { S3ObjectStorage } from "./s3.js";

export function createStorage(config: AppConfig): ObjectStorage {
  if (config.STORAGE_DRIVER === "local") {
    // Absolute, repo-root anchored: API and worker must share one root.
    return new LocalObjectStorage(config.storageLocalDir);
  }
  if (!config.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
  return new S3ObjectStorage({
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
}
