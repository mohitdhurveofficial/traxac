import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** OWASP-recommended scrypt parameters (N=2^16, r=8, p=1). */
const PARAMS = { N: 65_536, r: 8, p: 1 } as const;
const KEY_LEN = 64;

function derive(
  password: string,
  salt: Buffer,
  keyLen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** scrypt needs explicit headroom above the default 32 MB maxmem for N=2^16. */
const maxmem = (n: number, r: number): number => 256 * n * r;

/**
 * Password hashing with Node's built-in scrypt — no native dependency, which
 * keeps the Railway build simple. Format: scrypt$N$r$p$salt$hash (base64).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LEN, {
    ...PARAMS,
    maxmem: maxmem(PARAMS.N, PARAMS.r),
  });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4] as string, "base64");
  const expected = Buffer.from(parts[5] as string, "base64");
  if (expected.length === 0) return false;
  try {
    const derived = await derive(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxmem(n, r),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash used weaker parameters and should be upgraded on login. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  return parts[0] !== "scrypt" || Number(parts[1]) < PARAMS.N;
}
