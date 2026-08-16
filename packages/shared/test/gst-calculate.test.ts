import { describe, expect, it } from "vitest";
import {
  calculateInvoiceTax, summariseByHsn, toPaise, amountInWords, formatINR,
} from "../src/gst/index.js";

const line = (over: Partial<Parameters<typeof calculateInvoiceTax>[0]["lines"][number]> = {}) => ({
  quantity: 1,
  unitPrice: toPaise(100),
  gstRate: 18,
  ...over,
});

describe("calculateInvoiceTax", () => {
  it("splits intra-state tax into equal CGST and SGST", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
      lines: [line({ quantity: 10, unitPrice: toPaise(1000), gstRate: 18 })],
    });
    expect(r.supplyType).toBe("intra_state");
    expect(r.taxableValue).toBe(1_000_000);
    expect(r.cgst).toBe(90_000);
    expect(r.sgst).toBe(90_000);
    expect(r.igst).toBe(0);
    expect(r.grandTotal).toBe(1_180_000);
  });

  it("charges IGST for inter-state supply", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "24",
      lines: [line({ quantity: 3, unitPrice: toPaise(2500), gstRate: 12 })],
    });
    expect(r.supplyType).toBe("inter_state");
    expect(r.igst).toBe(90_000);
    expect(r.cgst + r.sgst).toBe(0);
    expect(r.grandTotal).toBe(840_000);
  });

  it("keeps cgst + sgst exactly equal to the total GST on odd amounts", () => {
    // 18% of Rs 55.55 = Rs 9.999 -> 1000 paise; halves must still sum to 1000.
    const r = calculateInvoiceTax({
      supplierStateCode: "29",
      placeOfSupplyStateCode: "29",
      lines: [line({ quantity: 1, unitPrice: toPaise(55.55), gstRate: 18 })],
    });
    expect(r.cgst + r.sgst).toBe(r.totalTax);
    expect(Math.abs(r.cgst - r.sgst)).toBeLessThanOrEqual(1);
  });

  it("applies percentage then flat discount, never below zero", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
      lines: [line({
        quantity: 2,
        unitPrice: toPaise(500),
        discountPercent: 10,
        discountAmount: toPaise(50),
        gstRate: 5,
      })],
    });
    // gross 1000, -10% = 100, -50 flat => taxable 850
    expect(r.grossValue).toBe(100_000);
    expect(r.totalDiscount).toBe(15_000);
    expect(r.taxableValue).toBe(85_000);
    expect(r.totalTax).toBe(4_250);
  });

  it("never lets a discount exceed the line value", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
      lines: [line({ unitPrice: toPaise(100), discountAmount: toPaise(500), gstRate: 18 })],
    });
    expect(r.taxableValue).toBe(0);
    expect(r.totalDiscount).toBe(10_000);
  });

  it("adds compensation cess on top of GST", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "24",
      lines: [line({ unitPrice: toPaise(10_000), gstRate: 28, cessRate: 12 })],
    });
    expect(r.igst).toBe(280_000);
    expect(r.cess).toBe(120_000);
    expect(r.totalTax).toBe(400_000);
    expect(r.grandTotal).toBe(1_400_000);
  });

  it("taxes additional charges at their own rate", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
      lines: [line({ unitPrice: toPaise(1000), gstRate: 18 })],
      charges: [
        { label: "Freight", amount: toPaise(500), gstRate: 18 },
        { label: "Stamp duty", amount: toPaise(100), gstRate: 0 },
      ],
    });
    expect(r.otherCharges).toBe(60_000);
    // 18% of 1000 = 180, 18% of 500 = 90 -> 270 total GST
    expect(r.cgst + r.sgst).toBe(27_000);
    expect(r.grandTotal).toBe(100_000 + 60_000 + 27_000);
  });

  it("zero-rates exports without payment of tax", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "96",
      supplyCategory: "export_wop",
      zeroRated: true,
      lines: [line({ unitPrice: toPaise(50_000), gstRate: 18 })],
    });
    expect(r.totalTax).toBe(0);
    expect(r.grandTotal).toBe(5_000_000);
  });

  it("forces IGST when igstOnIntra is set", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "27",
      igstOnIntra: true,
      lines: [line({ unitPrice: toPaise(1000), gstRate: 18 })],
    });
    expect(r.igst).toBe(18_000);
    expect(r.cgst).toBe(0);
  });

  it("rounds the grand total to the nearest rupee and records the round-off", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "24",
      lines: [line({ quantity: 3, unitPrice: toPaise(333.33), gstRate: 18 })],
    });
    expect(r.grandTotal % 100).toBe(0);
    expect(r.taxableValue + r.totalTax + r.otherCharges + r.roundOff).toBe(r.grandTotal);
    expect(Math.abs(r.roundOff)).toBeLessThanOrEqual(50);
  });

  it("keeps the totals identity across a many-line invoice", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "23",
      placeOfSupplyStateCode: "23",
      lines: [
        line({ quantity: 7, unitPrice: toPaise(123.45), gstRate: 5 }),
        line({ quantity: 2.5, unitPrice: toPaise(999.99), gstRate: 12, discountPercent: 3 }),
        line({ quantity: 100, unitPrice: toPaise(19.9), gstRate: 18 }),
        line({ quantity: 1, unitPrice: toPaise(45_000), gstRate: 28, cessRate: 1 }),
      ],
      charges: [{ label: "Freight", amount: toPaise(1500), gstRate: 5 }],
    });
    const lineSum = r.lines.reduce((s, l) => s + l.taxableValue, 0);
    expect(r.taxableValue).toBe(lineSum);
    expect(r.cgst + r.sgst + r.igst + r.cess + r.cessNonAdvol + r.stateCess).toBe(r.totalTax);
    expect(r.taxableValue + r.totalTax + r.otherCharges + r.roundOff).toBe(r.grandTotal);
  });
});

describe("summariseByHsn", () => {
  it("groups lines by HSN and rate", () => {
    const r = calculateInvoiceTax({
      supplierStateCode: "27",
      placeOfSupplyStateCode: "24",
      lines: [
        line({ unitPrice: toPaise(1000), gstRate: 18 }),
        line({ unitPrice: toPaise(2000), gstRate: 18 }),
        line({ unitPrice: toPaise(500), gstRate: 5 }),
      ],
    });
    const rows = summariseByHsn([
      { ...r.lines[0]!, hsnSac: "7308", quantity: 1, unit: "NOS" },
      { ...r.lines[1]!, hsnSac: "7308", quantity: 1, unit: "NOS" },
      { ...r.lines[2]!, hsnSac: "3926", quantity: 1, unit: "NOS" },
    ]);
    expect(rows).toHaveLength(2);
    const steel = rows.find((x) => x.hsnSac === "7308")!;
    expect(steel.taxableValue).toBe(300_000);
    expect(steel.igst).toBe(54_000);
  });
});

describe("money formatting", () => {
  it("writes Indian amounts in words", () => {
    expect(amountInWords(1_23_456_89)).toBe(
      "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Eighty Nine Paise Only",
    );
    expect(amountInWords(100_00)).toBe("One Hundred Rupees Only");
    expect(amountInWords(1_00_00_000_00)).toBe("One Crore Rupees Only");
  });

  it("formats INR with Indian digit grouping", () => {
    expect(formatINR(1_23_456_89)).toContain("1,23,456.89");
  });
});
