import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import * as s from "./schema/index.js";

export type Tenant = InferSelectModel<typeof s.tenants>;
export type User = InferSelectModel<typeof s.users>;
export type Membership = InferSelectModel<typeof s.memberships>;
export type TenantSettings = InferSelectModel<typeof s.tenantSettings>;

export type Gstin = InferSelectModel<typeof s.gstins>;
export type NewGstin = InferInsertModel<typeof s.gstins>;
export type Branch = InferSelectModel<typeof s.branches>;
export type Party = InferSelectModel<typeof s.parties>;
export type NewParty = InferInsertModel<typeof s.parties>;
export type PartyAddress = InferSelectModel<typeof s.partyAddresses>;

export type Product = InferSelectModel<typeof s.products>;
export type NewProduct = InferInsertModel<typeof s.products>;
export type Unit = InferSelectModel<typeof s.units>;
export type HsnCode = InferSelectModel<typeof s.hsnCodes>;

export type Transporter = InferSelectModel<typeof s.transporters>;
export type Vehicle = InferSelectModel<typeof s.vehicles>;

export type Invoice = InferSelectModel<typeof s.invoices>;
export type NewInvoice = InferInsertModel<typeof s.invoices>;
export type InvoiceLine = InferSelectModel<typeof s.invoiceLines>;
export type NewInvoiceLine = InferInsertModel<typeof s.invoiceLines>;
export type InvoiceCharge = InferSelectModel<typeof s.invoiceCharges>;
export type InvoicePayment = InferSelectModel<typeof s.invoicePayments>;
export type InvoiceSequence = InferSelectModel<typeof s.invoiceSequences>;

export type Einvoice = InferSelectModel<typeof s.einvoices>;
export type EwayBill = InferSelectModel<typeof s.ewayBills>;
export type EwbEvent = InferSelectModel<typeof s.ewbEvents>;

export type GstCredential = InferSelectModel<typeof s.gstCredentials>;
export type GatewayToken = InferSelectModel<typeof s.gatewayTokens>;
export type Session = InferSelectModel<typeof s.sessions>;
export type ApiKey = InferSelectModel<typeof s.apiKeys>;

export type Document = InferSelectModel<typeof s.documents>;
export type Job = InferSelectModel<typeof s.jobs>;
export type NewJob = InferInsertModel<typeof s.jobs>;
export type GatewayCall = InferSelectModel<typeof s.gatewayCalls>;
export type AuditLog = InferSelectModel<typeof s.auditLogs>;
export type Notification = InferSelectModel<typeof s.notifications>;
