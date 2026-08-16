import { describe, expect, it } from "vitest";
import {
  computeValidity, canExtend, canCancel, evaluateEwbRequirement, deriveTransactionType,
} from "../src/gst/eway.js";
import { toNicDate, toNicDateTime, parseNicDateTime, financialYear } from "../src/util/dates.js";

describe("EWB validity", () => {
  it("gives one day per 200 km for regular cargo", () => {
    const generatedAt = new Date("2026-08-17T06:30:00Z"); // 12:00 IST
    expect(computeValidity({ distanceKm: 150, generatedAt }).days).toBe(1);
    expect(computeValidity({ distanceKm: 200, generatedAt }).days).toBe(1);
    expect(computeValidity({ distanceKm: 201, generatedAt }).days).toBe(2);
    expect(computeValidity({ distanceKm: 1000, generatedAt }).days).toBe(5);
  });

  it("gives one day per 20 km for over-dimensional cargo", () => {
    const generatedAt = new Date("2026-08-17T06:30:00Z");
    expect(computeValidity({ distanceKm: 100, generatedAt, vehicleType: "O" }).days).toBe(5);
  });

  it("expires at IST midnight after the allowed days", () => {
    const generatedAt = new Date("2026-08-17T06:30:00Z"); // 17 Aug 12:00 IST
    const { validUntil } = computeValidity({ distanceKm: 150, generatedAt });
    // Day 1 ends at midnight opening 18 Aug IST => 18 Aug 00:00 IST
    expect(toNicDateTime(validUntil)).toBe("18/08/2026 00:00");
  });

  it("allows extension only in the +/- 8 hour window", () => {
    const validUntil = new Date("2026-08-18T18:30:00Z");
    expect(canExtend(validUntil, new Date("2026-08-18T12:00:00Z"))).toBe(true);
    expect(canExtend(validUntil, new Date("2026-08-18T02:00:00Z"))).toBe(false);
    expect(canExtend(validUntil, new Date("2026-08-19T03:00:00Z"))).toBe(false);
  });

  it("allows cancellation only within 24 hours", () => {
    const generatedAt = new Date("2026-08-17T06:00:00Z");
    expect(canCancel(generatedAt, new Date("2026-08-18T05:00:00Z"))).toBe(true);
    expect(canCancel(generatedAt, new Date("2026-08-18T07:00:00Z"))).toBe(false);
  });
});

describe("EWB requirement", () => {
  it("is not required for services or below threshold", () => {
    expect(evaluateEwbRequirement({
      grandTotalPaise: 100_000_00, isIntraState: true, goodsInvolved: false,
    }).required).toBe(false);
    expect(evaluateEwbRequirement({
      grandTotalPaise: 49_999_00, isIntraState: false, goodsInvolved: true,
    }).required).toBe(false);
  });

  it("is required above the threshold", () => {
    expect(evaluateEwbRequirement({
      grandTotalPaise: 50_001_00, isIntraState: false, goodsInvolved: true,
    }).required).toBe(true);
  });
});

describe("transaction type derivation", () => {
  it("maps address combinations to EWB transaction types", () => {
    expect(deriveTransactionType({ hasSeparateShipTo: false, hasSeparateDispatchFrom: false })).toBe(1);
    expect(deriveTransactionType({ hasSeparateShipTo: true, hasSeparateDispatchFrom: false })).toBe(2);
    expect(deriveTransactionType({ hasSeparateShipTo: false, hasSeparateDispatchFrom: true })).toBe(3);
    expect(deriveTransactionType({ hasSeparateShipTo: true, hasSeparateDispatchFrom: true })).toBe(4);
  });
});

describe("dates", () => {
  it("formats and parses NIC dd/mm/yyyy in IST", () => {
    const d = new Date("2026-08-17T20:00:00Z"); // 18 Aug 01:30 IST
    expect(toNicDate(d)).toBe("18/08/2026");
    const parsed = parseNicDateTime("18/08/2026 01:30");
    expect(parsed?.toISOString()).toBe("2026-08-17T20:00:00.000Z");
  });

  it("computes the Indian financial year", () => {
    expect(financialYear(new Date("2026-08-17T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2026-03-31T00:00:00Z"))).toBe("2025-26");
    expect(financialYear(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
  });
});
