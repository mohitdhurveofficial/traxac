import {
  createCipheriv, createDecipheriv, publicEncrypt, randomBytes, constants,
} from "node:crypto";

/**
 * NIC's transport encryption.
 *
 * The portal does not accept plain JSON. Every request body is
 * `{"Data": "<base64>"}` where the base64 is AES-256-ECB ciphertext, and the
 * session key itself arrives wrapped. The scheme is dated (ECB, no IV) but it
 * is what the portal implements, so it is reproduced exactly.
 *
 * Flow:
 *   1. Client generates a random 32-byte **AppKey**.
 *   2. The auth payload (username, password, AppKey) is RSA-encrypted with
 *      NIC's published public key for that environment.
 *   3. NIC replies with an AuthToken and a **SEK**, itself AES-encrypted with
 *      the AppKey.
 *   4. Every later request/response is AES-encrypted with the decrypted SEK.
 */

/** AES-256-ECB with PKCS#7 padding, base64 out. */
export function aesEncrypt(keyBase64: string, plaintext: string): string {
  const key = Buffer.from(keyBase64, "base64");
  assertKeyLength(key);
  const cipher = createCipheriv("aes-256-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
}

/** AES-256-ECB decrypt of a base64 payload. */
export function aesDecrypt(keyBase64: string, ciphertextBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  assertKeyLength(key);
  const decipher = createDecipheriv("aes-256-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Decrypt a key-shaped payload, returning raw bytes as base64. */
export function aesDecryptToBase64(keyBase64: string, ciphertextBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  assertKeyLength(key);
  const decipher = createDecipheriv("aes-256-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]).toString("base64");
}

/**
 * RSA/ECB/PKCS1Padding against NIC's environment public key. The key is
 * supplied as configuration — it is issued per environment and rotated by
 * NIC, so it is never compiled into the build.
 */
export function rsaEncrypt(publicKeyPem: string, plaintext: string): string {
  return publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(plaintext, "utf8"),
  ).toString("base64");
}

/** Fresh 32-byte session AppKey, base64. */
export function generateAppKey(): string {
  return randomBytes(32).toString("base64");
}

/** Normalise a bare base64 key body into a PEM block. */
export function toPublicKeyPem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN")) return trimmed.replace(/\\n/g, "\n");
  const body = trimmed.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error(`NIC AES key must be 32 bytes, received ${key.length}`);
  }
}
