import { createCipheriv, randomBytes } from "node:crypto";
import type { NicEndpoints, NicToken } from "./endpoints.js";
import { fetchWithRetry, GatewayHttpError } from "./http.js";

/**
 * NIC auth: username + sek (encrypted with appKey via AES-ECB, base64).
 * We keep a small in-memory token cache keyed by gstin to avoid re-auth per call.
 */
const tokenCache = new Map<string, NicToken>();

export interface NicAuthCredentials {
  username: string;
  /** Plaintext password / ClientId-appropriate secret. */
  encryptedSek: string;
}

/** Authenticate with NIC and cache the returned token (15 min default). */
export async function nicAuth(
  endpoints: NicEndpoints,
  creds: NicAuthCredentials,
  gstin: string,
): Promise<NicToken> {
  const cached = tokenCache.get(gstin);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const appKey = randomBytes(32).toString("base64");
  const body = JSON.stringify({
    UserName: creds.username,
    Password: encryptAesEcbBase64(appKey, creds.encryptedSek),
  });
  const res = await fetchWithRetry(`${endpoints.base}${endpoints.auth}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new GatewayHttpError(res.status, "AUTH_FAILED", "NIC auth failed", false);
  const json = (await res.json()) as { token?: string; expiry?: string };
  if (!json.token) throw new GatewayHttpError(401, "NO_TOKEN", "NIC auth returned no token", false);
  const expiresAt = json.expiry ? Date.parse(json.expiry) : Date.now() + 15 * 60_000;
  const token: NicToken = { token: json.token, expiresAt };
  tokenCache.set(gstin, token);
  return token;
}

/** AES-ECB PKCS7 encrypt, base64 — NIC legacy requirement. */
export function encryptAesEcbBase64(keyB64: string, plaintext: string): string {
  const key = Buffer.from(keyB64, "base64");
  const cipher = createCipheriv("aes-256-ecb", key, null);
  return Buffer.concat([
    cipher.update(pkcs7Pad(Buffer.from(plaintext, "utf8"))),
    cipher.final(),
  ]).toString("base64");
}

/** PKCS#7 padding for 16-byte blocks. */
export function pkcs7Pad(buf: Buffer, block = 16): Buffer {
  const pad = block - (buf.length % block);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

export function invalidateToken(gstin: string): void {
  tokenCache.delete(gstin);
}
