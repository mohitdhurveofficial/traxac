import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Envelope encryption for tenant secrets (GST credentials, gateway tokens).
 *
 * Ciphertext layout: `v<keyVersion>.<iv>.<authTag>.<ciphertext>` — all base64.
 * Embedding the key version means a key rotation only has to re-wrap rows
 * lazily: old ciphertext keeps decrypting with the previous key.
 */

export interface CryptoKeyring {
  /** Current key used for all new encryption. */
  masterKey: string;
  version: number;
  /** Older key retained during rotation. */
  previousKey?: string | undefined;
}

const derivedCache = new Map<string, Buffer>();

function keyBytes(secret: string): Buffer {
  const cached = derivedCache.get(secret);
  if (cached) return cached;
  const raw = Buffer.from(secret, "base64");
  // A 32-byte base64 secret is used directly; anything else is stretched.
  const key = raw.length === 32 ? raw : scryptSync(secret, "traxac.kdf.v1", 32);
  derivedCache.set(secret, key);
  return key;
}

export class SecretBox {
  constructor(private readonly keyring: CryptoKeyring) {}

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBytes(this.keyring.masterKey), iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
      `v${this.keyring.version}`,
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      enc.toString("base64"),
    ].join(".");
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split(".");
    if (!version?.startsWith("v") || !ivB64 || !tagB64 || !dataB64) {
      throw new Error("Malformed encrypted payload");
    }
    const declared = Number.parseInt(version.slice(1), 10);
    const candidates =
      declared === this.keyring.version
        ? [this.keyring.masterKey]
        : ([this.keyring.previousKey, this.keyring.masterKey].filter(Boolean) as string[]);

    let lastError: unknown;
    for (const key of candidates) {
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          keyBytes(key),
          Buffer.from(ivB64, "base64"),
        );
        decipher.setAuthTag(Buffer.from(tagB64, "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(dataB64, "base64")),
          decipher.final(),
        ]).toString("utf8");
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error("Unable to decrypt payload with any configured key", { cause: lastError });
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }

  /** Version stamped on freshly written ciphertext. */
  get keyVersion(): number {
    return this.keyring.version;
  }

  /** True when the ciphertext was written with an older key and should be re-wrapped. */
  needsRewrap(payload: string): boolean {
    const version = Number.parseInt(payload.split(".")[0]?.slice(1) ?? "0", 10);
    return version !== this.keyring.version;
  }
}

/** SHA-256 hex digest — used for session tokens and API keys at rest. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Stable hash of a request body, used to detect duplicate gateway calls. */
export function payloadFingerprint(value: unknown): string {
  return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}
