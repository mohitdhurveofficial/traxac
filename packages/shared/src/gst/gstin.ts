import { isValidStateCode } from "./states.js";

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[A-Z]{1}[0-9A-Z]{1}$/;

/** Char value for GSTIN checksum: 0-9 => 0-9, A-Z => 10-35. */
function charValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  throw new Error(`Invalid GSTIN char: ${ch}`);
}

function valueToChar(v: number): string {
  return v < 10 ? String.fromCharCode(48 + v) : String.fromCharCode(55 + v);
}

/**
 * GSTIN check digit algorithm per GSTN spec:
 * multiply alternate (odd-indexed) chars by 2, sum digit-values of products,
 * check char = (36 - (sum % 36)) % 36 in base-36.
 */
function computeCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = charValue(first14[i] as string);
    const product = value * (i % 2 === 1 ? 2 : 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return valueToChar((36 - (sum % 36)) % 36);
}

export interface GstinInfo {
  stateCode: string;
  pan: string;
  entityKind: string;
  zIndex: string;
}

/** Full structural + checksum validation of a 15-char GSTIN. */
export function isValidGstin(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(g)) return false;
  if (!isValidStateCode(g.slice(0, 2))) return false;
  try {
    return g[14] === computeCheckDigit(g.slice(0, 14));
  } catch {
    return false;
  }
}

/** Parse a (pre-validated) GSTIN into its semantic parts. */
export function parseGstin(gstin: string): GstinInfo | null {
  const g = gstin.trim().toUpperCase();
  if (!isValidGstin(g)) return null;
  return {
    stateCode: g.slice(0, 2),
    pan: g.slice(2, 12),
    entityKind: g.slice(12, 13),
    zIndex: g.slice(13, 14),
  };
}

export function gstinStateCode(gstin: string): string {
  return gstin.trim().toUpperCase().slice(0, 2);
}
