import { addDays, addHours, startOfIstDay } from "../util/dates.js";

/**
 * e-Way Bill rules that the app needs to reason about locally: whether a bill
 * is required, and how long it stays valid. The portal remains authoritative —
 * these functions drive UI hints, alerts and pre-flight validation only.
 */

/** Default statutory threshold: consignment value above Rs 50,000. */
export const DEFAULT_EWB_THRESHOLD_PAISE = 50_000_00;

export type TransportMode = 1 | 2 | 3 | 4; // Road | Rail | Air | Ship

export const TRANSPORT_MODES: Record<TransportMode, string> = {
  1: "Road",
  2: "Rail",
  3: "Air",
  4: "Ship",
};

/** EWB sub-supply types as published in the EWB API spec. */
export const SUB_SUPPLY_TYPES = {
  "1": "Supply",
  "2": "Import",
  "3": "Export",
  "4": "Job Work",
  "5": "For Own Use",
  "6": "Job Work Returns",
  "7": "Sales Return",
  "8": "Others",
  "9": "SKD/CKD",
  "10": "Line Sales",
  "11": "Recipient Not Known",
  "12": "Exhibition or Fairs",
} as const;

export type SubSupplyType = keyof typeof SUB_SUPPLY_TYPES;

/** EWB transaction types, which mirror the Bill-To/Ship-To combinations. */
export const EWB_TRANSACTION_TYPES = {
  1: "Regular",
  2: "Bill To - Ship To",
  3: "Bill From - Dispatch From",
  4: "Combination of 2 and 3",
} as const;

export type EwbTransactionType = keyof typeof EWB_TRANSACTION_TYPES;

/**
 * Derive the EWB transaction type from which optional addresses are present.
 * This is the field traders most often get wrong, so the app computes it.
 */
export function deriveTransactionType(input: {
  hasSeparateShipTo: boolean;
  hasSeparateDispatchFrom: boolean;
}): EwbTransactionType {
  if (input.hasSeparateShipTo && input.hasSeparateDispatchFrom) return 4;
  if (input.hasSeparateShipTo) return 2;
  if (input.hasSeparateDispatchFrom) return 3;
  return 1;
}

export interface EwbRequirementInput {
  grandTotalPaise: number;
  /** Movement is inside one state and the state exempts intra-state movement. */
  isIntraState: boolean;
  /** Tenant-configured threshold override. */
  thresholdPaise?: number;
  /** Services only — no movement of goods, so no EWB. */
  goodsInvolved: boolean;
  /** Some HSN chapters (e.g. exempt goods) never need an EWB. */
  exemptGoods?: boolean;
}

export interface EwbRequirement {
  required: boolean;
  reason: string;
}

export function evaluateEwbRequirement(input: EwbRequirementInput): EwbRequirement {
  if (!input.goodsInvolved) {
    return { required: false, reason: "No movement of goods (services only)" };
  }
  if (input.exemptGoods) {
    return { required: false, reason: "Goods are exempt from e-Way Bill" };
  }
  const threshold = input.thresholdPaise ?? DEFAULT_EWB_THRESHOLD_PAISE;
  if (input.grandTotalPaise < threshold) {
    return {
      required: false,
      reason: `Consignment value below the Rs ${(threshold / 100).toLocaleString("en-IN")} threshold`,
    };
  }
  return {
    required: true,
    reason: input.isIntraState
      ? "Intra-state consignment above threshold"
      : "Inter-state consignment above threshold",
  };
}

/**
 * Validity per Rule 138(10):
 *  - Regular cargo: 1 day per 200 km (or part thereof).
 *  - Over Dimensional Cargo (ODC): 1 day per 20 km (or part thereof).
 * A "day" ends at midnight of the following day from generation.
 */
export function computeValidity(input: {
  distanceKm: number;
  generatedAt: Date;
  vehicleType?: "R" | "O";
}): { days: number; validUntil: Date } {
  const perDay = input.vehicleType === "O" ? 20 : 200;
  const days = Math.max(1, Math.ceil(input.distanceKm / perDay));
  // Day 1 ends at midnight following generation; each extra day adds 24h.
  const firstMidnight = addDays(startOfIstDay(input.generatedAt), 1);
  return { days, validUntil: addDays(firstMidnight, days - 1) };
}

/** Extension window: from 8 hours before expiry to 8 hours after. */
export function canExtend(validUntil: Date, now: Date): boolean {
  return now >= addHours(validUntil, -8) && now <= addHours(validUntil, 8);
}

/** An EWB can be cancelled within 24 hours of generation, if not verified. */
export function canCancel(generatedAt: Date, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() <= 24 * 3_600_000;
}

/** An IRN can be cancelled within 24 hours of the acknowledgement. */
export function canCancelIrn(ackDate: Date, now: Date): boolean {
  return now.getTime() - ackDate.getTime() <= 24 * 3_600_000;
}
