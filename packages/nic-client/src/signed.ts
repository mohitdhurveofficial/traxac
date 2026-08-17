import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

/**
 * Verification of the portal's signed responses.
 *
 * `SignedInvoice` and `SignedQRCode` are JWS compact serialisations —
 * `header.payload.signature` — signed by NIC with "SHA256RSA". The signature
 * is the only thing that makes an IRN self-provable: a buyer, an auditor or
 * our own reconciliation can check it offline and know the document really
 * came from the IRP.
 *
 * Storing those strings without ever checking them, which is what we did
 * before, means an IRN is trusted purely because it arrived over TLS from a
 * host we believe is NIC. That is weaker than the scheme NIC designed.
 *
 * The signing certificate is published by NIC per environment and is NOT the
 * same key used to RSA-wrap the authentication payload. When no certificate
 * is configured the result is reported as `unverified` — never as verified.
 *
 * @see https://einv-apisandbox.nic.in/version1.03/generate-irn.html
 */

export type SignatureStatus =
  /** Signature checked against the configured certificate and it matched. */
  | "verified"
  /** Certificate configured, signature present, and it did NOT match. */
  | "invalid"
  /** No certificate configured, so no claim is made either way. */
  | "unverified"
  /** The portal returned nothing to verify. */
  | "absent"
  /** Present but not a well-formed JWS. */
  | "malformed";

export interface VerifiedSignature {
  status: SignatureStatus;
  /** Decoded JWS payload, available whenever the token parsed. */
  payload: Record<string, unknown> | null;
}

const UNVERIFIABLE: Record<string, VerifiedSignature> = {
  absent: { status: "absent", payload: null },
  malformed: { status: "malformed", payload: null },
};

/**
 * Check one JWS.
 *
 * `certificatePem` may be a certificate or a bare public key, in PEM or raw
 * base64. Passing `undefined` yields `unverified` with the payload still
 * decoded, because reading the claims is useful even when we cannot yet prove
 * they are authentic.
 */
export function verifyJws(jws: string | undefined, certificatePem?: string): VerifiedSignature {
  if (!jws || !jws.trim()) return UNVERIFIABLE["absent"] as VerifiedSignature;

  const parts = jws.trim().split(".");
  if (parts.length !== 3) return UNVERIFIABLE["malformed"] as VerifiedSignature;
  const [header, body, signature] = parts as [string, string, string];

  const payload = decodeSegment(body);
  if (!payload) return UNVERIFIABLE["malformed"] as VerifiedSignature;

  if (!certificatePem?.trim()) return { status: "unverified", payload };

  let key: KeyObject;
  try {
    key = toPublicKey(certificatePem);
  } catch {
    // A certificate we cannot parse is a configuration fault, not a bad
    // signature. Saying "invalid" would wrongly impugn the portal.
    return { status: "unverified", payload };
  }

  const algorithm = readAlgorithm(header);
  if (algorithm && algorithm !== "RS256") return { status: "invalid", payload };

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${body}`);
    verifier.end();
    const ok = verifier.verify(key, Buffer.from(base64UrlToBase64(signature), "base64"));
    return { status: ok ? "verified" : "invalid", payload };
  } catch {
    return { status: "invalid", payload };
  }
}

function readAlgorithm(header: string): string | null {
  const decoded = decodeSegment(header);
  const alg = decoded?.["alg"];
  return typeof alg === "string" ? alg : null;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(base64UrlToBase64(segment), "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function base64UrlToBase64(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return padded + "=".repeat((4 - (padded.length % 4)) % 4);
}

/** Accepts a PEM certificate, a PEM public key, or bare base64 of either. */
function toPublicKey(value: string): KeyObject {
  const trimmed = value.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN CERTIFICATE")) {
    return createPublicKey({ key: trimmed, format: "pem" });
  }
  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey({ key: trimmed, format: "pem" });
  }
  const body =
    trimmed
      .replace(/\s+/g, "")
      .match(/.{1,64}/g)
      ?.join("\n") ?? trimmed;
  // Try as a certificate first; NIC publishes the signing material as one.
  try {
    return createPublicKey({
      key: `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`,
      format: "pem",
    });
  } catch {
    return createPublicKey({
      key: `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`,
      format: "pem",
    });
  }
}
