/** Response shapes the UI relies on. Kept narrow: only what screens read. */

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName?: string;
  role: "owner" | "admin" | "member" | "viewer";
  permissions: string[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  page: number;
  hasMore: boolean;
}

export interface AddressSnapshot {
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  stateCode: string;
  stateName?: string | null;
  pincode: string;
  phone?: string | null;
  email?: string | null;
}

export interface Gstin {
  id: string;
  gstin: string;
  legalName: string;
  tradeName: string;
  city: string;
  stateCode: string;
  pincode: string;
  einvoiceEnabled: boolean;
  ewbEnabled: boolean;
  isPrimary: boolean;
  isActive: boolean;
}

export interface Branch {
  id: string;
  gstinId: string;
  name: string;
  kind: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  pincode: string;
  isDefault: boolean;
}

export interface Party {
  id: string;
  name: string;
  legalName?: string | null;
  partyType: string;
  gstin?: string | null;
  registrationType: string;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  defaultPlaceOfSupply?: string | null;
  isActive: boolean;
}

export interface PartyAddress {
  id: string;
  partyId: string;
  label: string;
  kind: string;
  gstin?: string | null;
  name: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  pincode: string;
  isDefault: boolean;
}

export interface PartyDetail extends Party {
  addresses: PartyAddress[];
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  hsnSac: string;
  isService: boolean;
  gstRate: string;
  cessRate: string;
  unit: string;
  unitPrice: number;
  isActive: boolean;
}

export interface Transporter {
  id: string;
  name: string;
  transporterId?: string | null;
  phone?: string | null;
  isActive: boolean;
}

export interface Vehicle {
  id: string;
  vehicleNo: string;
  vehicleType: string;
  transporterId?: string | null;
  driverName?: string | null;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  series: string;
  docType: string;
  status: string;
  einvoiceStatus: string;
  ewbStatus: string;
  invoiceDate: string;
  dueDate?: string | null;
  billTo: AddressSnapshot;
  placeOfSupply: string;
  grandTotal: number;
  amountPaid: number;
  ewbRequired: boolean;
  irn?: string | null;
  ewbNumber?: string | null;
  ewbValidUntil?: string | null;
}

export interface Invoice extends InvoiceSummary {
  gstinId: string;
  branchId?: string | null;
  buyerPartyId?: string | null;
  billFrom: AddressSnapshot;
  shipTo?: AddressSnapshot | null;
  dispatchFrom?: AddressSnapshot | null;
  supplyCategory: string;
  financialYear: string;
  reverseCharge: boolean;
  igstOnIntra: boolean;
  grossValue: number;
  totalDiscount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  cessNonAdvol: number;
  totalTax: number;
  otherCharges: number;
  roundOff: number;
  transporterId?: string | null;
  transportMode?: number | null;
  distanceKm?: number | null;
  vehicleNo?: string | null;
  vehicleType?: string | null;
  transportDocNo?: string | null;
  transportDocDate?: string | null;
  subSupplyType: string;
  ewbTransactionType: number;
  poNumber?: string | null;
  poDate?: string | null;
  notes?: string | null;
  terms?: string | null;
  finalizedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
}

export interface InvoiceLine {
  id: string;
  position: number;
  productId?: string | null;
  name: string;
  description?: string | null;
  hsnSac: string;
  isService: boolean;
  quantity: string;
  unit: string;
  unitPrice: number;
  discountPercent: string;
  discountAmount: number;
  grossValue: number;
  taxableValue: number;
  gstRate: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  totalTax: number;
  lineTotal: number;
}

export interface InvoiceCharge {
  id: string;
  label: string;
  kind: string;
  hsnSac?: string | null;
  amount: number;
  gstRate: string;
  cgst: number;
  sgst: number;
  igst: number;
  taxAmount: number;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  paidAt: string;
  method: string;
  reference?: string | null;
}

export interface Einvoice {
  id: string;
  status: string;
  irn?: string | null;
  ackNumber?: string | null;
  ackDate?: string | null;
  signedQrCode?: string | null;
  errorCode?: string | null;
  lastError?: string | null;
  cancelledAt?: string | null;
  environment: string;
}

export interface EwayBill {
  id: string;
  status: string;
  ewbNumber?: string | null;
  generatedAt?: string | null;
  validUntil?: string | null;
  distanceKm?: number | null;
  vehicleNo?: string | null;
  transporterName?: string | null;
  transportDocNo?: string | null;
  extensionCount: number;
  errorCode?: string | null;
  lastError?: string | null;
  events?: EwbEvent[];
  actions?: { canExtend: boolean; canCancel: boolean; canUpdatePartB: boolean };
}

export interface EwbEvent {
  id: string;
  eventType: string;
  note?: string | null;
  actorLabel?: string | null;
  occurredAt: string;
}

export interface HsnSummaryRow {
  hsnSac: string;
  quantity: number;
  unit: string;
  taxableValue: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface DocumentRef {
  id: string;
  kind: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: InvoiceLine[];
  charges: InvoiceCharge[];
  payments: InvoicePayment[];
  einvoice: Einvoice | null;
  ewayBill: EwayBill | null;
  hsnSummary: HsnSummaryRow[];
  amountDue: number;
  documents: DocumentRef[];
}

export interface TaxTotals {
  supplyType: "intra_state" | "inter_state";
  lines: Array<{
    grossValue: number; discountAmount: number; taxableValue: number; gstRate: number;
    cgst: number; sgst: number; igst: number; cess: number; totalTax: number; lineTotal: number;
  }>;
  charges: Array<{ label: string; amount: number; cgst: number; sgst: number; igst: number; taxAmount: number }>;
  grossValue: number;
  totalDiscount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  totalTax: number;
  otherCharges: number;
  roundOff: number;
  grandTotal: number;
}

export interface Dashboard {
  window: { from: string; to: string };
  totals: {
    invoiceCount: number; taxableValue: number; totalTax: number;
    grandTotal: number; outstanding: number;
  };
  needsAttention: {
    drafts: number; einvoicePending: number; einvoiceFailed: number;
    ewbPending: number; ewbFailed: number; ewbExpiringSoon: number; overdue: number;
  };
  recentInvoices: Array<{
    id: string; invoiceNumber: string; invoiceDate: string; buyerName: string;
    grandTotal: number; status: string; einvoiceStatus: string; ewbStatus: string;
  }>;
  monthly: Array<{ month: string; taxableValue: number; totalTax: number; grandTotal: number }>;
}

export interface Notification {
  id: string;
  kind: string;
  severity: "info" | "warning" | "error";
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorLabel?: string | null;
  summary?: string | null;
  createdAt: string;
}

export interface Credential {
  id: string;
  gstinId: string;
  gstin: string;
  provider: string;
  environment: string;
  service: string;
  usernameHint?: string | null;
  status: string;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
}

export interface StateRef { code: string; name: string }
export interface UnitRef { code: string; description: string; qtyDecimals: number }
