/**
 * Reference transactions.
 *
 * Two real-world shapes supplied as domain references, converted into sandbox
 * fixtures. The *structure* is what matters and is reproduced faithfully; every
 * identifier is synthetic:
 *
 *  - GSTINs are checksum-valid but belong to nobody. Never reuse a real one in
 *    a test: a mistyped environment flag would file against a live taxpayer.
 *  - Party names are altered.
 *  - Vehicle numbers, LR numbers and PO numbers are invented.
 *  - HSN codes, units, tax rates and the transaction *shape* are kept exactly,
 *    because those are what the payload builder has to get right.
 */

export interface ReferenceLine {
  name: string;
  description: string;
  hsnSac: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  gstRate: number;
}

export interface ReferenceTransaction {
  key: string;
  title: string;
  /** What this case is here to prove. */
  exercises: string[];
  seller: {
    gstin: string;
    legalName: string;
    tradeName: string;
    addressLine1: string;
    city: string;
    stateCode: string;
    pincode: string;
  };
  buyer: {
    gstin: string;
    name: string;
    addressLine1: string;
    city: string;
    stateCode: string;
    pincode: string;
  };
  /** Present only for Bill-To/Ship-To consignments. */
  shipTo?: {
    label: string;
    name: string;
    gstin?: string;
    addressLine1: string;
    city: string;
    stateCode: string;
    pincode: string;
  };
  /** Present when goods leave from somewhere other than the seller's address. */
  dispatchFrom?: {
    name: string;
    addressLine1: string;
    city: string;
    stateCode: string;
    pincode: string;
  };
  placeOfSupply: string;
  lines: ReferenceLine[];
  transport: {
    transporterName: string;
    transporterId: string;
    vehicleNo: string;
    transportDocNo: string;
    distanceKm: number;
    mode: 1 | 2 | 3 | 4;
  };
  /** Expected EWB transaction type: 1 regular, 2 Bill-To/Ship-To, 4 combination. */
  expectedEwbTransactionType: 1 | 2 | 3 | 4;
  expectedSupplyType: "intra_state" | "inter_state";
}

/**
 * Case 1 — simple inter-state consignment of a single commodity.
 * Modelled on a mill-scale sale: one HSN, one line, IGST, road transport.
 */
export const SIMPLE_INTERSTATE: ReferenceTransaction = {
  key: "simple-interstate",
  title: "Single-commodity inter-state sale with transporter and LR",
  exercises: [
    "single HSN, single line",
    "fractional quantity in MTS",
    "IGST via differing supplier and place-of-supply states",
    "transporter, vehicle and LR number present at generation",
    "EWB transaction type 1 (regular)",
  ],
  seller: {
    gstin: "27AAPFU0939F1ZV",
    legalName: "Sandbox Minerals LLP",
    tradeName: "Sandbox Minerals",
    addressLine1: "Plot 22, Industrial Area Phase II",
    city: "Nagpur",
    stateCode: "27",
    pincode: "440016",
  },
  buyer: {
    gstin: "24AAACC4175D1Z4",
    name: "Sandbox Ispat Private Limited",
    addressLine1: "Survey 118, Rolling Mill Road",
    city: "Bhavnagar",
    stateCode: "24",
    pincode: "364004",
  },
  placeOfSupply: "24",
  lines: [
    {
      name: "Mill Scale",
      description: "Iron oxide mill scale, bulk",
      hsnSac: "26190090",
      quantity: 35.38,
      unit: "MTS",
      unitPrice: 12_500,
      gstRate: 18,
    },
  ],
  transport: {
    transporterName: "Sandbox Roadlines",
    transporterId: "27AAACT2727QY",
    vehicleNo: "MH40BC7788",
    transportDocNo: "SBX/LR/2026/1180",
    distanceKm: 1150,
    mode: 1,
  },
  expectedEwbTransactionType: 1,
  expectedSupplyType: "inter_state",
};

/**
 * Case 2 — Bill-To/Ship-To with direct dispatch from a plant.
 * Multiple products across different HSNs, delivered to a third location.
 */
export const BILL_TO_SHIP_TO: ReferenceTransaction = {
  key: "bill-to-ship-to",
  title: "Bill-To/Ship-To with direct dispatch from plant, multiple HSNs",
  exercises: [
    "multiple lines across different HSN codes",
    "Bill-To one state, Ship-To another",
    "dispatch from a plant that is not the billing address",
    "EWB transaction type 4 (combination)",
    "transporter and vehicle present",
  ],
  seller: {
    gstin: "27AAPFU0939F1ZV",
    legalName: "Sandbox Enterprises LLP",
    tradeName: "Sandbox Enterprises",
    addressLine1: "Unit 9, Trade Centre",
    city: "Pune",
    stateCode: "27",
    pincode: "411001",
  },
  buyer: {
    gstin: "29AAGCB7383J1Z4",
    name: "Sandbox Construction Private Limited",
    addressLine1: "4th Floor, Corporate Park",
    city: "Bengaluru",
    stateCode: "29",
    pincode: "560001",
  },
  shipTo: {
    label: "Project Site Store",
    name: "Sandbox Construction — Project Site",
    addressLine1: "Plot 61, Industrial Growth Centre",
    city: "Hosur",
    stateCode: "33",
    pincode: "635109",
  },
  dispatchFrom: {
    name: "Sandbox Manufacturing Plant",
    addressLine1: "Gat 140, MIDC Phase III",
    city: "Chakan",
    stateCode: "27",
    pincode: "410501",
  },
  placeOfSupply: "29",
  lines: [
    {
      name: "TMT Reinforcement Bar 12mm",
      description: "Fe500D thermo-mechanically treated bar",
      hsnSac: "72142090",
      quantity: 18.5,
      unit: "MTS",
      unitPrice: 54_900,
      gstRate: 18,
    },
    {
      name: "MS Structural Angle 65x65x6",
      description: "Hot-rolled equal angle",
      hsnSac: "72169910",
      quantity: 6.25,
      unit: "MTS",
      unitPrice: 58_400,
      gstRate: 18,
    },
    {
      name: "Binding Wire 18 SWG",
      description: "Galvanised annealed binding wire",
      hsnSac: "72179099",
      quantity: 400,
      unit: "KGS",
      unitPrice: 82,
      gstRate: 18,
    },
  ],
  transport: {
    transporterName: "Sandbox Carriers",
    transporterId: "27AAACT2727QY",
    vehicleNo: "MH12QR4455",
    transportDocNo: "SBX/LR/2026/2291",
    distanceKm: 840,
    mode: 1,
  },
  expectedEwbTransactionType: 4,
  expectedSupplyType: "inter_state",
};

export const REFERENCE_TRANSACTIONS = [SIMPLE_INTERSTATE, BILL_TO_SHIP_TO] as const;
