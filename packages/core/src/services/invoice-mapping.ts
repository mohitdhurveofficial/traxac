import type { AddressSnapshot, Branch, Gstin, Party, PartyAddress } from "@ewayvo/database";
import { GST_STATE_CODES } from "@ewayvo/shared";
import type { AddressSnapshotInput } from "@ewayvo/shared/contracts";

/**
 * Address snapshotting. A document must keep the address exactly as it was
 * when issued, so master-data edits never rewrite a filed invoice.
 */

export function snapshotFromGstin(gstin: Gstin, branch?: Branch | null): AddressSnapshot {
  const source = branch ?? gstin;
  return {
    name: gstin.tradeName,
    legalName: gstin.legalName,
    gstin: gstin.gstin,
    addressLine1: source.addressLine1,
    addressLine2: source.addressLine2 ?? null,
    city: source.city,
    stateCode: source.stateCode,
    stateName: GST_STATE_CODES[source.stateCode] ?? null,
    pincode: source.pincode,
    phone: gstin.phone ?? null,
    email: gstin.email ?? null,
    country: "IN",
  };
}

/** Unregistered buyers are recorded as URP, which is what the IRP expects. */
export function snapshotFromParty(party: Party): AddressSnapshot {
  return {
    name: party.name,
    legalName: party.legalName ?? party.name,
    gstin: party.gstin ?? "URP",
    addressLine1: party.addressLine1 ?? "",
    addressLine2: party.addressLine2 ?? null,
    city: party.city ?? "",
    stateCode: party.stateCode ?? "",
    stateName: party.stateCode ? (GST_STATE_CODES[party.stateCode] ?? null) : null,
    pincode: party.pincode ?? "",
    phone: party.phone ?? null,
    email: party.email ?? null,
    country: party.country ?? "IN",
  };
}

export function snapshotFromPartyAddress(address: PartyAddress): AddressSnapshot {
  return {
    name: address.name,
    legalName: address.name,
    gstin: address.gstin ?? "URP",
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    city: address.city,
    stateCode: address.stateCode,
    stateName: GST_STATE_CODES[address.stateCode] ?? null,
    pincode: address.pincode,
    phone: address.phone ?? null,
    email: null,
    country: "IN",
  };
}

export function snapshotFromBranch(branch: Branch, gstin: Gstin): AddressSnapshot {
  return {
    name: branch.name,
    legalName: gstin.legalName,
    gstin: gstin.gstin,
    addressLine1: branch.addressLine1,
    addressLine2: branch.addressLine2 ?? null,
    city: branch.city,
    stateCode: branch.stateCode,
    stateName: GST_STATE_CODES[branch.stateCode] ?? null,
    pincode: branch.pincode,
    phone: branch.phone ?? null,
    email: null,
    country: "IN",
  };
}

export function snapshotFromInput(input: AddressSnapshotInput): AddressSnapshot {
  return {
    name: input.name,
    legalName: input.legalName ?? input.name,
    gstin: input.gstin || "URP",
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    stateCode: input.stateCode,
    stateName: input.stateName ?? GST_STATE_CODES[input.stateCode] ?? null,
    pincode: input.pincode,
    phone: input.phone ?? null,
    email: input.email || null,
    country: input.country ?? "IN",
  };
}

/**
 * Two addresses count as "the same place" when the GSTIN and the street line
 * match — that decides whether an EWB is a Bill-To/Ship-To transaction.
 */
export function isSamePlace(
  a: AddressSnapshot | null | undefined,
  b: AddressSnapshot | null | undefined,
): boolean {
  if (!a || !b) return true;
  return (
    (a.gstin ?? "") === (b.gstin ?? "") &&
    a.addressLine1.trim().toLowerCase() === b.addressLine1.trim().toLowerCase() &&
    a.pincode === b.pincode
  );
}
