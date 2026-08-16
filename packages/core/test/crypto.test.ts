import { describe, expect, it } from "vitest";
import { SecretBox, sha256, payloadFingerprint, randomToken } from "../src/infra/crypto.js";
import { hashPassword, verifyPassword, needsRehash } from "../src/infra/password.js";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

describe("SecretBox", () => {
  it("round-trips a secret", () => {
    const box = new SecretBox({ masterKey: KEY_A, version: 1 });
    const cipher = box.encrypt("API_USER_1|s3cret");
    expect(cipher).not.toContain("s3cret");
    expect(box.decrypt(cipher)).toBe("API_USER_1|s3cret");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const box = new SecretBox({ masterKey: KEY_A, version: 1 });
    expect(box.encrypt("same")).not.toBe(box.encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    const box = new SecretBox({ masterKey: KEY_A, version: 1 });
    const parts = box.encrypt("payload").split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => box.decrypt(parts.join("."))).toThrow();
  });

  it("decrypts old ciphertext after a key rotation", () => {
    const oldBox = new SecretBox({ masterKey: KEY_A, version: 1 });
    const cipher = oldBox.encrypt("legacy-credential");
    const rotated = new SecretBox({ masterKey: KEY_B, version: 2, previousKey: KEY_A });
    expect(rotated.decrypt(cipher)).toBe("legacy-credential");
    expect(rotated.needsRewrap(cipher)).toBe(true);
    expect(rotated.needsRewrap(rotated.encrypt("fresh"))).toBe(false);
  });

  it("cannot decrypt with an unrelated key", () => {
    const a = new SecretBox({ masterKey: KEY_A, version: 1 });
    const b = new SecretBox({ masterKey: KEY_B, version: 1 });
    expect(() => b.decrypt(a.encrypt("secret"))).toThrow();
  });

  it("round-trips JSON credentials", () => {
    const box = new SecretBox({ masterKey: KEY_A, version: 1 });
    const creds = { username: "u", password: "p", clientId: "c" };
    expect(box.decryptJson(box.encryptJson(creds))).toEqual(creds);
  });
});

describe("hashing helpers", () => {
  it("hashes deterministically for identical input", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });

  it("fingerprints payloads regardless of key order", () => {
    expect(payloadFingerprint({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(payloadFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken(16)));
    expect(tokens.size).toBe(50);
  });
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("Str0ngPassw0rd!");
    expect(await verifyPassword("Str0ngPassw0rd!", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  }, 20_000);

  it("salts so two hashes of the same password differ", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  }, 20_000);

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "notahash")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("flags legacy hashes for upgrade", () => {
    expect(needsRehash("scrypt$16384$8$1$c2FsdA==$aGFzaA==")).toBe(true);
    expect(needsRehash("scrypt$65536$8$1$c2FsdA==$aGFzaA==")).toBe(false);
  });
});
