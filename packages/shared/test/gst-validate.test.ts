import { describe, expect, it } from "vitest";
import {
  isValidGstin, parseGstin, isValidPan, isValidPincode, isValidVehicleNo,
  isValidHsn, normaliseVehicleNo, isValidUqc,
} from "../src/gst/index.js";

describe("GSTIN validation", () => {
  it("accepts structurally valid GSTINs with a correct check digit", () => {
    // Synthetic GSTINs built to satisfy the published check-digit algorithm.
    const valid = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "07AAACT2727Q1ZY", "24AAACC4175D1Z4"];
    for (const g of valid) expect(isValidGstin(g)).toBe(true);
  });

  it("rejects a GSTIN whose check digit is wrong", () => {
    expect(isValidGstin("27AAPFU0939F1ZA")).toBe(false);
  });

  it("rejects wrong length, bad state code and junk", () => {
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false);
    expect(isValidGstin("")).toBe(false);
  });

  it("parses a GSTIN into state code and PAN", () => {
    const info = parseGstin("27AAPFU0939F1ZV");
    expect(info?.stateCode).toBe("27");
    expect(info?.pan).toBe("AAPFU0939F");
  });
});

describe("field validation", () => {
  it("validates PAN", () => {
    expect(isValidPan("AAPFU0939F")).toBe(true);
    expect(isValidPan("AAPFU0939")).toBe(false);
  });

  it("validates pincode", () => {
    expect(isValidPincode("400001")).toBe(true);
    expect(isValidPincode("040001")).toBe(false);
  });

  it("normalises and validates vehicle numbers", () => {
    expect(normaliseVehicleNo("mh 12 ab-1234")).toBe("MH12AB1234");
    expect(isValidVehicleNo("MH12AB1234")).toBe(true);
    expect(isValidVehicleNo("MH12A1234")).toBe(true);
    expect(isValidVehicleNo("1234")).toBe(false);
  });

  it("validates HSN lengths and UQC codes", () => {
    expect(isValidHsn("7308")).toBe(true);
    expect(isValidHsn("73089090")).toBe(true);
    expect(isValidHsn("730")).toBe(false);
    expect(isValidUqc("kgs")).toBe(true);
    expect(isValidUqc("KILO")).toBe(false);
  });
});
