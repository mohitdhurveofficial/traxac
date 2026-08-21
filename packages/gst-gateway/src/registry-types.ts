/**
 * Taxpayer and transporter lookups.
 *
 * Two different government registers, deliberately kept apart:
 *
 *  - **GSTIN** identifies a registered taxpayer. Both the IRP and the e-Way
 *    Bill portal can resolve one, and they return overlapping but differently
 *    named fields.
 *  - **TRANSIN** identifies an *enrolled* transporter — someone who moves
 *    goods but is not GST-registered. It is a different register with a
 *    different endpoint and a smaller field set: no taxpayer type, no active
 *    status, no block status. Treating a TRANSIN as a GSTIN would silently
 *    invent registration facts about a business that has none.
 *
 * Every field is optional except the identifier, because the provider decides
 * what it returns and a field the portal omitted must stay empty rather than
 * be filled with a plausible guess.
 */

/** Registration status as the portal reports it. */
export type GstinRegistrationStatus =
  | "ACT" // active
  | "CNL" // cancelled
  | "INA" // inactive
  | "PRO" // provisional
  | "UNKNOWN";

/** e-Way Bill generation block status. 'B' means blocked for non-filing. */
export type GstinBlockStatus = "blocked" | "unblocked" | "unknown";

export interface GstinDetails {
  gstin: string;
  legalName?: string | null;
  tradeName?: string | null;
  /** Raw portal status string, preserved verbatim alongside the parsed one. */
  status: GstinRegistrationStatus;
  statusRaw?: string | null;
  /** "REG", "COM", "CAS" … as the portal spells it. Never normalised away. */
  taxpayerType?: string | null;
  blockStatus: GstinBlockStatus;
  addressLine1?: string | null;
  addressLine2?: string | null;
  street?: string | null;
  location?: string | null;
  floorNumber?: string | null;
  buildingNumber?: string | null;
  buildingName?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  /**
   * Registration and de-registration dates, as the portal spells them.
   *
   * Kept as the portal's own strings rather than parsed into Dates: the
   * format is not documented alongside the field, and guessing between
   * dd/mm/yyyy and yyyy-mm-dd would silently mis-date a registration.
   * Only v1.04 of the IRP lookup returns these; the e-Way Bill one does not.
   */
  registeredOn?: string | null;
  deregisteredOn?: string | null;
  /**
   * Neither the IRP nor the e-Way Bill lookup returns jurisdiction, so this is
   * present in the shape only for a provider that does. It is never derived.
   */
  jurisdiction?: string | null;
}

export interface TransporterDetails {
  /** The enrolment id, or a GSTIN when the transporter is registered. */
  transin: string;
  legalName?: string | null;
  tradeName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
}

/** Which register answered, so provenance survives into the audit trail. */
export type LookupSource = "irp" | "ewb";
