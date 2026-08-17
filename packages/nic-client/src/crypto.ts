import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  publicEncrypt,
  randomBytes,
  timingSafeEqual,
  constants,
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

/**
 * Wrap the authentication credentials the way the portal expects.
 *
 * The auth payload is **base64-encoded first, and the RSA cipher then runs
 * over those base64 characters** — not over the raw JSON. NIC's own samples
 * are unambiguous and agree with each other:
 *
 *   Java  payload = Base64.getEncoder().encodeToString(payload.getBytes());
 *         cipher.doFinal(clearText.getBytes());
 *   C#    Encrypt(Convert.ToBase64String(authBytes), key)
 *         byte[] plaintext = Encoding.UTF8.GetBytes(data);
 *
 * Skipping the base64 step yields a payload the portal cannot parse after
 * decryption, so every authentication attempt fails. Note this is the
 * opposite order from the document APIs, where the JSON is AES-encrypted and
 * the *ciphertext* is what gets base64-encoded.
 *
 * @see https://einv-apisandbox.nic.in/version1.04/authentication.html
 * @see https://einv-apisandbox.nic.in/sample-code-in-java.html
 */
export function rsaEncryptAuthPayload(publicKeyPem: string, payload: unknown): string {
  const base64Json = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  assertRsaCapacity(base64Json);
  return rsaEncrypt(publicKeyPem, base64Json);
}

/**
 * PKCS#1 v1.5 with a 2048-bit key carries at most 245 bytes.
 *
 * The base64 step inflates the payload by four thirds, so the effective
 * budget for the credentials JSON is about 183 bytes — of which the AppKey
 * alone takes 44 and the field names take 73. Long portal credentials can
 * genuinely overflow it, and OpenSSL's own error ("data too large for key
 * size") gives an operator no idea what to shorten.
 */
const RSA_2048_PKCS1_MAX_BYTES = 245;

function assertRsaCapacity(base64Json: string): void {
  const size = Buffer.byteLength(base64Json, "utf8");
  if (size <= RSA_2048_PKCS1_MAX_BYTES) return;
  throw new Error(
    `The GST API credentials are too long to encrypt: ${size} bytes after base64 encoding, ` +
      `against a ${RSA_2048_PKCS1_MAX_BYTES}-byte limit for the portal's 2048-bit key. ` +
      "Shorten the API username and password — together they must be roughly 66 characters or fewer.",
  );
}

/** Fresh 32-byte session AppKey, base64. */
export function generateAppKey(): string {
  return randomBytes(32).toString("base64");
}

/**
 * The e-Way Bill master APIs wrap their response twice.
 *
 * `GetGSTINDetails` and `GetTransporterDetails` do not encrypt with the
 * session key directly. Each response carries a fresh random key:
 *
 *   data = Encrypt(Base64(json), rek)
 *   rek  = Encrypt(rek, sek)
 *   hmac = HMAC-SHA256(Base64(json)) keyed with rek
 *
 * so the session key only ever unwraps `rek`, and `rek` unwraps the payload.
 * Decrypting `data` with the SEK — which is what the ordinary e-Way Bill
 * endpoints need — produces garbage here.
 *
 * The HMAC is verified when present: it is the only integrity check on a
 * response that will be written into a customer record.
 *
 * @see https://docs.ewaybillgst.gov.in/apidocs/version1.03/get-gstin-details.html
 */
export function decryptRekEnvelope(
  sekBase64: string,
  envelope: { data: string; rek: string; hmac?: string | undefined },
): Record<string, unknown> {
  const rek = aesDecryptToBase64(sekBase64, envelope.rek);
  // The inner payload decrypts to base64 text, not to JSON directly.
  const base64Json = aesDecrypt(rek, envelope.data);

  if (envelope.hmac) {
    const expected = createHmac("sha256", Buffer.from(rek, "base64"))
      .update(base64Json, "utf8")
      .digest("base64");
    if (!timingSafeEqualBase64(expected, envelope.hmac)) {
      throw new Error("The e-Way Bill response failed its HMAC integrity check");
    }
  }

  const json = Buffer.from(base64Json, "base64").toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The e-Way Bill response did not contain a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** True when an envelope carries the REK wrapping rather than plain SEK. */
export function isRekEnvelope(
  body: Record<string, unknown>,
): body is { data: string; rek: string; hmac?: string } {
  return typeof body["data"] === "string" && typeof body["rek"] === "string";
}

function timingSafeEqualBase64(a: string, b: string): boolean {
  const left = Buffer.from(a, "base64");
  const right = Buffer.from(b, "base64");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Normalise a bare base64 key body into a PEM block. */
export function toPublicKeyPem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN")) return trimmed.replace(/\\n/g, "\n");
  const body =
    trimmed
      .replace(/\s+/g, "")
      .match(/.{1,64}/g)
      ?.join("\n") ?? trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error(`NIC AES key must be 32 bytes, received ${key.length}`);
  }
}
