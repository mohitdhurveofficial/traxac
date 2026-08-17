import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SIMPLE_INTERSTATE, BILL_TO_SHIP_TO } from "./fixtures/reference-transactions.js";
import type { Container } from "../src/index.js";
import { createBusiness, resetDatabase, testContainer, type TestBusiness } from "./helpers.js";

/**
 * Live NIC sandbox round-trip.
 *
 * This is the only suite that talks to a government system. It is skipped
 * unless every piece of integration material is present, so ordinary CI never
 * depends on NIC being reachable:
 *
 *   TRAXAC_SANDBOX_ENABLED=1
 *   TRAXAC_SANDBOX_GSTIN            the GSTIN the sandbox account is issued for
 *   TRAXAC_SANDBOX_USERNAME         API username (not the portal login)
 *   TRAXAC_SANDBOX_PASSWORD
 *   TRAXAC_SANDBOX_CLIENT_ID
 *   TRAXAC_SANDBOX_CLIENT_SECRET
 *   NIC_PUBLIC_KEY_SANDBOX          NIC's RSA public key for the sandbox
 *   NIC_IRP_SANDBOX_BASE_URL        base URL NIC issues on registration
 *
 * Run with:  pnpm test:sandbox
 *
 * These tests file real documents in the sandbox. They are written to be
 * idempotent-safe — every invoice number is unique per run — but they are
 * still writes against a government system, which is why they never run by
 * default.
 */

const REQUIRED = [
  "TRAXAC_SANDBOX_GSTIN",
  "TRAXAC_SANDBOX_USERNAME",
  "TRAXAC_SANDBOX_PASSWORD",
  "TRAXAC_SANDBOX_CLIENT_ID",
  "TRAXAC_SANDBOX_CLIENT_SECRET",
  "NIC_PUBLIC_KEY_SANDBOX",
  "NIC_IRP_SANDBOX_BASE_URL",
] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);
const enabled = process.env["TRAXAC_SANDBOX_ENABLED"] === "1" && missing.length === 0;

if (!enabled) {
  const reason =
    process.env["TRAXAC_SANDBOX_ENABLED"] !== "1"
      ? "TRAXAC_SANDBOX_ENABLED is not 1"
      : `missing ${missing.join(", ")}`;
  // eslint-disable-next-line no-console
  console.info(`[sandbox] skipping live NIC tests — ${reason}`);
}

describe.skipIf(!enabled)("NIC sandbox — live round trip", () => {
  let container: Container;
  let business: TestBusiness;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);

  beforeAll(async () => {
    container = await testContainer({
      GST_ENVIRONMENT: "sandbox",
      NIC_PUBLIC_KEY_SANDBOX: process.env["NIC_PUBLIC_KEY_SANDBOX"],
    });
    await resetDatabase(container);
    business = await createBusiness(container, {
      slug: "sandbox",
      gstin: process.env["TRAXAC_SANDBOX_GSTIN"] as string,
      stateCode: (process.env["TRAXAC_SANDBOX_GSTIN"] as string).slice(0, 2),
    });

    for (const service of ["einvoice", "ewb"] as const) {
      await container.credentials.save(business.ctx, {
        gstinId: business.gstinId,
        provider: "nic",
        environment: "sandbox",
        service,
        username: process.env["TRAXAC_SANDBOX_USERNAME"] as string,
        password: process.env["TRAXAC_SANDBOX_PASSWORD"] as string,
        clientId: process.env["TRAXAC_SANDBOX_CLIENT_ID"],
        clientSecret: process.env["TRAXAC_SANDBOX_CLIENT_SECRET"],
        baseUrl:
          service === "einvoice"
            ? process.env["NIC_IRP_SANDBOX_BASE_URL"]
            : (process.env["NIC_EWB_SANDBOX_BASE_URL"] ?? ""),
      });
    }
  }, 120_000);

  afterAll(async () => await container?.shutdown());

  it("A. authenticates against the sandbox", async () => {
    const resolved = await container.credentials.resolve(business.ctx, {
      gstin: business.ctx.tenantId ? (process.env["TRAXAC_SANDBOX_GSTIN"] as string) : "",
      service: "einvoice",
      environment: "sandbox",
    });
    const result = await container.registry.einvoice("sandbox").verify({
      tenantId: business.tenantId,
      gstin: process.env["TRAXAC_SANDBOX_GSTIN"] as string,
      environment: "sandbox",
      credentials: resolved.credentials,
      idempotencyKey: `sandbox-verify:${runId}`,
    });
    expect(result.ok, JSON.stringify("error" in result ? result.error : {})).toBe(true);
  }, 60_000);

  it("B. generates, persists and reads back an IRN (simple inter-state)", async () => {
    const invoiceId = await createReferenceInvoice(container, business, SIMPLE_INTERSTATE, runId);
    const einvoice = await container.compliance.generateEinvoice(business.ctx, invoiceId);

    expect(einvoice.irn).toMatch(/^[a-f0-9]{64}$/i);
    expect(einvoice.ackNumber).toBeTruthy();
    expect(einvoice.ackDate).toBeInstanceOf(Date);
    expect(einvoice.signedQrCode, "portal must return a signed QR").toBeTruthy();
    expect(einvoice.status).toBe("generated");

    // Read back through the application, not the provider.
    const detail = await container.invoices.get(business.ctx, invoiceId);
    expect(detail.einvoice?.irn).toBe(einvoice.irn);
    expect(detail.invoice.einvoiceStatus).toBe("generated");
  }, 120_000);

  it("C. generates and persists an e-Way Bill from that invoice", async () => {
    const invoiceId = await createReferenceInvoice(
      container,
      business,
      SIMPLE_INTERSTATE,
      `${runId}E`,
    );
    await container.compliance.generateEinvoice(business.ctx, invoiceId);

    const ewb = await container.compliance.generateEwb(business.ctx, invoiceId, {
      distanceKm: SIMPLE_INTERSTATE.transport.distanceKm,
      partB: {
        transportMode: SIMPLE_INTERSTATE.transport.mode,
        vehicleNo: SIMPLE_INTERSTATE.transport.vehicleNo,
        vehicleType: "R",
        transportDocNo: SIMPLE_INTERSTATE.transport.transportDocNo,
        transportDocDate: new Date(),
      },
    });

    expect(ewb.ewbNumber).toMatch(/^\d{12}$/);
    expect(ewb.validUntil).toBeInstanceOf(Date);

    const detail = await container.invoices.get(business.ctx, invoiceId);
    expect(detail.ewayBill?.ewbNumber).toBe(ewb.ewbNumber);
  }, 120_000);

  it("D. handles the Bill-To/Ship-To structure end to end", async () => {
    const invoiceId = await createReferenceInvoice(
      container,
      business,
      BILL_TO_SHIP_TO,
      `${runId}B`,
    );
    const detail = await container.invoices.get(business.ctx, invoiceId);
    expect(detail.invoice.ewbTransactionType).toBe(BILL_TO_SHIP_TO.expectedEwbTransactionType);

    const einvoice = await container.compliance.generateEinvoice(business.ctx, invoiceId);
    expect(einvoice.irn).toBeTruthy();
  }, 120_000);

  it("E. cancels an IRN inside the 24-hour window", async () => {
    const invoiceId = await createReferenceInvoice(
      container,
      business,
      SIMPLE_INTERSTATE,
      `${runId}C`,
    );
    await container.compliance.generateEinvoice(business.ctx, invoiceId);

    const cancelled = await container.compliance.cancelEinvoice(business.ctx, invoiceId, {
      reasonCode: "1",
      remark: "Sandbox integration test",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
  }, 120_000);

  it("F. does not create a second IRN when the same document is retried", async () => {
    const invoiceId = await createReferenceInvoice(
      container,
      business,
      SIMPLE_INTERSTATE,
      `${runId}D`,
    );
    const first = await container.compliance.generateEinvoice(business.ctx, invoiceId);
    const second = await container.compliance.generateEinvoice(business.ctx, invoiceId);
    expect(second.irn).toBe(first.irn);
  }, 120_000);

  it("G. records every portal call in the gateway log without secrets", async () => {
    const rows = await container.database.client<
      Array<{ operation: string; request_payload: unknown }>
    >`
      SELECT operation, request_payload FROM gateway_calls WHERE tenant_id = ${business.tenantId}
    `;
    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain(process.env["TRAXAC_SANDBOX_PASSWORD"] as string);
    expect(serialised).not.toContain(process.env["TRAXAC_SANDBOX_CLIENT_SECRET"] as string);
  }, 30_000);
});

/** Build and finalize an invoice from a reference fixture. */
async function createReferenceInvoice(
  container: Container,
  business: TestBusiness,
  reference: typeof SIMPLE_INTERSTATE,
  suffix: string,
): Promise<string> {
  const party = await container.masters.createParty(business.ctx, {
    name: `${reference.buyer.name} ${suffix}`,
    legalName: reference.buyer.name,
    partyType: "customer",
    gstin: reference.buyer.gstin,
    pan: "",
    registrationType: "regular",
    email: "",
    phone: "",
    addressLine1: reference.buyer.addressLine1,
    addressLine2: "",
    city: reference.buyer.city,
    stateCode: reference.buyer.stateCode,
    pincode: reference.buyer.pincode,
    country: "IN",
    defaultPlaceOfSupply: reference.placeOfSupply,
    notes: "",
  });

  const draft = await container.invoices.createDraft(business.ctx, {
    gstinId: business.gstinId,
    branchId: null,
    docType: "invoice",
    invoiceNumber: "",
    invoiceDate: new Date(),
    dueDate: null,
    buyerPartyId: party.id,
    shipToAddressId: null,
    dispatchFromBranchId: null,
    supplyCategory: "b2b",
    placeOfSupply: reference.placeOfSupply,
    reverseCharge: false,
    igstOnIntra: false,
    currency: "INR",
    exchangeRate: 1,
    lines: reference.lines.map((line) => ({
      productId: null,
      name: line.name,
      description: line.description,
      hsnSac: line.hsnSac,
      isService: false,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discountPercent: 0,
      discountAmount: 0,
      gstRate: line.gstRate,
      cessRate: 0,
      cessNonAdvol: 0,
      stateCess: 0,
      batchNo: "",
      barcode: "",
      expiryDate: null,
    })),
    charges: [],
    transport: {
      transporterId: null,
      transportMode: reference.transport.mode,
      distanceKm: reference.transport.distanceKm,
      vehicleNo: reference.transport.vehicleNo,
      vehicleType: "R",
      transportDocNo: reference.transport.transportDocNo,
      transportDocDate: new Date(),
      subSupplyType: "1",
    },
    poNumber: "",
    notes: "",
    terms: "",
  } as never);

  const finalized = await container.invoices.finalize(business.ctx, draft.invoice.id);
  return finalized.id;
}
