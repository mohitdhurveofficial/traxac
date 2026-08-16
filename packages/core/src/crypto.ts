import {
  createCipheriv, createDecipheriv, randomBytes, scryptSync,
} from "node:crypto";

/**
 * AES-256-GCM envelope encryption for tenant secrets (GST credentials,
 * GSP tokens). Layout: v1.<iv>.<authTag>.<ciphertext> (all base64).
 */
const VERSION = "v1";

function masterKeyBytes(masterKeyB64: string): Buffer {
  const raw = Buffer.from(masterKeyB64, "base64");
  if (raw.length === 32) return raw;
  // Derive 32 bytes from arbitrary-length secret via scrypt.
  return scryptSync(masterKeyB64, "traxac.v1", 32);
}

export function encryptSecret(
  masterKey: string,
  plaintext: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKeyBytes(masterKey), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(
  masterKey: string,
  payload: string,
): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKeyBytes(masterKey),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptJson(masterKey: string, value: unknown): string {
  return encryptSecret(masterKey, JSON.stringify(value));
}

export function decryptJson<T>(masterKey: string, payload: string): T {
  return JSON.parse(decryptSecret(masterKey, payload)) as T;
}
