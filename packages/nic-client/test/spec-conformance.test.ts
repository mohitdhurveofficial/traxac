import { generateKeyPairSync, privateDecrypt, constants, createSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rsaEncrypt, rsaEncryptAuthPayload } from "../src/crypto.js";
import { parseIrpError } from "../src/errors.js";
import { IRP_PATHS } from "../src/endpoints.js";
import { verifyJws } from "../src/signed.js";
import { integratorHeaders, gstinHeader } from "../src/session.js";
import type { GatewayRequestContext } from "@traxac/gst-gateway";

/**
 * Conformance with the current NIC e-Invoice sandbox specification.
 *
 * Every expectation here is traceable to the published specification or to
 * NIC's own sample programs, cited inline. These are the mistakes that cannot
 * be caught by any amount of local testing against ourselves — they only
 * surface as a rejection from a portal we cannot call from CI.
 *
 * @see https://einv-apisandbox.nic.in/version1.04/authentication.html
 * @see https://einv-apisandbox.nic.in/version1.03/generate-irn.html
 * @see https://einv-apisandbox.nic.in/sample-code-in-java.html
 */

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/**
 * Node 22 refuses `privateDecrypt` with PKCS#1 v1.5 padding as a Marvin-attack
 * mitigation. The portal is the decrypting party in production, so for the
 * test we decrypt raw and strip the `00 02 <nonzero padding> 00` prefix by
 * hand — this only reproduces what NIC's side does.
 */
function rsaUnwrap(privatePem: string, ciphertextBase64: string): string {
  const raw = privateDecrypt(
    { key: privatePem, padding: constants.RSA_NO_PADDING },
    Buffer.from(ciphertextBase64, "base64"),
  );
  if (raw[0] !== 0x00 || raw[1] !== 0x02) throw new Error("not a PKCS#1 v1.5 block");
  const separator = raw.indexOf(0x00, 2);
  if (separator < 0) throw new Error("malformed PKCS#1 v1.5 block");
  return raw.subarray(separator + 1).toString("utf8");
}

describe("authentication payload encryption", () => {
  const credentials = {
    UserName: "apiuser",
    Password: "s3cret",
    AppKey: Buffer.alloc(32, 3).toString("base64"),
    ForceRefreshAccessToken: false,
  };

  /**
   * The single most consequential detail in the whole integration: NIC
   * base64-encodes the credentials JSON and RSA-encrypts *those characters*.
   *
   *   Java: payload = Base64.getEncoder().encodeToString(payload.getBytes());
   *         cipher.doFinal(clearText.getBytes());
   *   C#:   Encrypt(Convert.ToBase64String(authBytes), key)
   *         byte[] plaintext = Encoding.UTF8.GetBytes(data);
   */
  it("base64-encodes the credentials before RSA, per NIC's sample code", () => {
    const wrapped = rsaEncryptAuthPayload(publicKey, credentials);

    const decrypted = rsaUnwrap(privateKey, wrapped);

    // What the portal receives after decryption must be base64, not JSON.
    expect(decrypted.trimStart().startsWith("{")).toBe(false);
    expect(decrypted).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    const inner = Buffer.from(decrypted, "base64").toString("utf8");
    expect(JSON.parse(inner)).toEqual(credentials);
  });

  it("differs from encrypting the raw JSON — the bug this replaced", () => {
    const correct = rsaEncryptAuthPayload(publicKey, credentials);
    const naive = rsaEncrypt(publicKey, JSON.stringify(credentials));

    const decode = (value: string): string => rsaUnwrap(privateKey, value);

    // The old path handed the portal raw JSON, which it cannot parse.
    expect(decode(naive).startsWith("{")).toBe(true);
    expect(decode(correct)).not.toEqual(decode(naive));
  });

  /**
   * Base64 inflates the payload by four thirds before RSA ever sees it, and
   * PKCS#1 v1.5 on a 2048-bit key carries only 245 bytes. Typical portal
   * credentials fit; unusually long ones do not, and the failure must name
   * the cause rather than surfacing OpenSSL's "data too large for key size".
   */
  it("encrypts credentials of a typical length", () => {
    const typical = {
      UserName: "SANDBOXAPI01",
      Password: "Str0ng-P@ssw0rd",
      AppKey: Buffer.alloc(32, 9).toString("base64"),
      ForceRefreshAccessToken: true,
    };
    expect(() => rsaEncryptAuthPayload(publicKey, typical)).not.toThrow();
    const inner = Buffer.from(
      rsaUnwrap(privateKey, rsaEncryptAuthPayload(publicKey, typical)),
      "base64",
    );
    expect(JSON.parse(inner.toString("utf8"))).toEqual(typical);
  });

  it("explains itself when the credentials overflow the key capacity", () => {
    const oversized = {
      UserName: "a".repeat(60),
      Password: "b".repeat(60),
      AppKey: Buffer.alloc(32, 9).toString("base64"),
      ForceRefreshAccessToken: true,
    };
    expect(() => rsaEncryptAuthPayload(publicKey, oversized)).toThrow(/too long to encrypt/i);
    expect(() => rsaEncryptAuthPayload(publicKey, oversized)).toThrow(/username and password/i);
  });
});

describe("ErrorDetails parsing", () => {
  const arrayForm = [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }];

  it("reads the documented array form", () => {
    const parsed = parseIrpError({ Status: 0, ErrorDetails: arrayForm });
    expect(parsed.code).toBe("2150");
    expect(parsed.details).toHaveLength(1);
  });

  /**
   * Every document API documents ErrorDetails as "Base 64 encoded string. On
   * decoding ErrorDetails the following attributes from JSON array are
   * obtained". Parsing only the array form lost the code entirely, which
   * broke duplicate recovery and token refresh — both of which switch on it.
   */
  it("reads the base64-encoded string form the document APIs document", () => {
    const encoded = Buffer.from(JSON.stringify(arrayForm), "utf8").toString("base64");
    const parsed = parseIrpError({ Status: 0, ErrorDetails: encoded });
    expect(parsed.code).toBe("2150");
    expect(parsed.details[0]?.message).toBe("Duplicate IRN");
  });

  it("reads a plain JSON string form", () => {
    const parsed = parseIrpError({ Status: 0, ErrorDetails: JSON.stringify(arrayForm) });
    expect(parsed.code).toBe("2150");
  });

  it("keeps multiple codes so every rejection reason survives", () => {
    const many = [
      { ErrorCode: "2182", ErrorMessage: "Taxable value mismatch" },
      { ErrorCode: "2189", ErrorMessage: "Invoice total mismatch" },
    ];
    const encoded = Buffer.from(JSON.stringify(many), "utf8").toString("base64");
    const parsed = parseIrpError({ Status: 0, ErrorDetails: encoded });
    expect(parsed.details.map((d) => d.code)).toEqual(["2182", "2189"]);
  });

  it("does not mangle a human-readable message into bytes", () => {
    const parsed = parseIrpError({ Status: 0, ErrorDetails: "Something went wrong at the portal" });
    expect(parsed.details[0]?.message).toBe("Something went wrong at the portal");
  });

  it("degrades to a generic code rather than inventing one", () => {
    const parsed = parseIrpError({ Status: 0 });
    expect(parsed.code).toBe("UNKNOWN");
    expect(parsed.details).toHaveLength(1);
  });
});

describe("endpoints", () => {
  /**
   * The specification writes paths against an `<URL>` placeholder:
   *   generate `<URL>/api/Invoice`, cancel `<URL>/api/Cancel`,
   *   get `<URL>/api/Invoice/irn/<irn_no>`.
   * Cancel is a sibling of Invoice, not a child of it.
   */
  it("places Cancel alongside Invoice, not beneath it", () => {
    expect(IRP_PATHS.generateIrn).toBe("/eicore/v1.03/Invoice");
    expect(IRP_PATHS.cancelIrn).toBe("/eicore/v1.03/Cancel");
    expect(IRP_PATHS.cancelIrn).not.toContain("/Invoice/Cancel");
  });

  it("uses the v1.04 auth endpoint", () => {
    expect(IRP_PATHS.auth).toBe("/eivital/v1.04/auth");
  });

  it("url-encodes the IRN in the get path", () => {
    expect(IRP_PATHS.getIrn("abc/def")).toContain("abc%2Fdef");
  });
});

describe("headers", () => {
  const ctx = (headerStyle?: "underscore" | "hyphen"): GatewayRequestContext => ({
    tenantId: "t1",
    gstin: "27AAPFU0939F1ZV",
    environment: "sandbox",
    idempotencyKey: "k1",
    credentials: {
      username: "apiuser",
      password: "pw",
      clientId: "cid",
      clientSecret: "csec",
      ...(headerStyle ? { headerStyle } : {}),
    },
  });

  it("defaults to the underscore spelling in the specification tables", () => {
    expect(integratorHeaders("irp", ctx())).toEqual({
      client_id: "cid",
      client_secret: "csec",
      Gstin: "27AAPFU0939F1ZV",
    });
  });

  it("supports the hyphen spelling NIC's sample code uses", () => {
    expect(integratorHeaders("irp", ctx("hyphen"))).toEqual({
      "client-id": "cid",
      "client-secret": "csec",
      gstin: "27AAPFU0939F1ZV",
    });
  });

  /** Duplicate casings merge into "GSTIN, GSTIN" and the EWB portal rejects 393. */
  it("never emits two GSTIN headers", () => {
    for (const style of ["underscore", "hyphen"] as const) {
      for (const gateway of ["irp", "ewb"] as const) {
        const keys = Object.keys(gstinHeader(gateway, "27AAPFU0939F1ZV", style));
        expect(keys).toHaveLength(1);
      }
    }
  });

  it("keeps the e-Way Bill GSTIN header lowercase regardless of style", () => {
    expect(gstinHeader("ewb", "27AAPFU0939F1ZV", "underscore")).toEqual({
      gstin: "27AAPFU0939F1ZV",
    });
  });
});

describe("signed response verification", () => {
  const signingKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const b64url = (value: string | Buffer): string =>
    (typeof value === "string" ? Buffer.from(value, "utf8") : value)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  function makeJws(payload: Record<string, unknown>, key = signingKeys.privateKey): string {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const body = b64url(JSON.stringify(payload));
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${body}`);
    signer.end();
    return `${header}.${body}.${b64url(signer.sign(key))}`;
  }

  it("verifies a genuine signature", () => {
    const jws = makeJws({ Irn: "abc", SellerGstin: "27AAPFU0939F1ZV" });
    const result = verifyJws(jws, signingKeys.publicKey);
    expect(result.status).toBe("verified");
    expect(result.payload?.["Irn"]).toBe("abc");
  });

  it("rejects a payload tampered with after signing", () => {
    const jws = makeJws({ Irn: "abc", TotInvVal: 1000 });
    const [header, , signature] = jws.split(".") as [string, string, string];
    const forged = `${header}.${b64url(JSON.stringify({ Irn: "abc", TotInvVal: 999_999 }))}.${signature}`;
    expect(verifyJws(forged, signingKeys.publicKey).status).toBe("invalid");
  });

  it("rejects a signature made with the wrong key", () => {
    const other = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const jws = makeJws({ Irn: "abc" }, other.privateKey);
    expect(verifyJws(jws, signingKeys.publicKey).status).toBe("invalid");
  });

  /** The critical honesty property: absence of a certificate is never "verified". */
  it("reports unverified — never verified — when no certificate is configured", () => {
    const jws = makeJws({ Irn: "abc" });
    const result = verifyJws(jws, undefined);
    expect(result.status).toBe("unverified");
    expect(result.payload?.["Irn"]).toBe("abc");
  });

  it("reports unverified when the configured certificate cannot be parsed", () => {
    expect(verifyJws(makeJws({ Irn: "abc" }), "not-a-certificate").status).toBe("unverified");
  });

  it("distinguishes absent from malformed", () => {
    expect(verifyJws(undefined, signingKeys.publicKey).status).toBe("absent");
    expect(verifyJws("", signingKeys.publicKey).status).toBe("absent");
    expect(verifyJws("not.a.jws", signingKeys.publicKey).status).toBe("malformed");
    expect(verifyJws("onlyonepart", signingKeys.publicKey).status).toBe("malformed");
  });
});
