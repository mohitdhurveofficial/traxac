import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../apps/api/src/app.js";
import { testContainer } from "./helpers.js";
import type { Container } from "../src/index.js";

/**
 * Finalizing must not queue work that cannot succeed.
 *
 * A business with no GST credentials still issues invoices every day. Queuing
 * an e-Invoice call for them produced a job that failed on every attempt and
 * left a permanent red mark on an account that had simply not connected — and
 * it hid the real signal, which is that the portal is not set up yet.
 */
describe("portal work is gated on having credentials", () => {
  let container: Container;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    container = await testContainer();
    app = await buildApp(container);
    await app.ready();

    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: `gate.${Date.now()}@example.test`,
        password: "Correct-Horse-9!",
        name: "Gate Owner",
        businessName: "Gate Steel Traders",
      },
    });
    expect(registered.statusCode).toBe(201);
    cookie = (registered.headers["set-cookie"] as string).split(";")[0] as string;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await container?.shutdown();
  });

  const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  it("issues the invoice, renders a PDF, and queues no portal call", async () => {
    const gstin = await call("POST", "/api/v1/gstins", {
      gstin: "27AAECE1234F1Z2",
      legalName: "Gate Steel Traders",
      tradeName: "Gate Steel",
      addressLine1: "Gala 7",
      city: "Mumbai",
      pincode: "400009",
      stateCode: "27",
      isPrimary: true,
    });
    expect(gstin.statusCode).toBe(201);
    const gstinId = JSON.parse(gstin.body).id as string;

    const party = await call("POST", "/api/v1/parties", {
      name: "Emirates Ispat Pvt Ltd",
      partyType: "customer",
      // Registered, so e-Invoicing would apply if a credential existed.
      gstin: "27AARDB7320G1ZH",
      registrationType: "regular",
      stateCode: "27",
      addressLine1: "Plot 14",
      city: "Pune",
      pincode: "411019",
      country: "IN",
    });
    expect(party.statusCode).toBe(201);

    const draft = await call("POST", "/api/v1/invoices", {
      gstinId,
      docType: "invoice",
      invoiceDate: new Date().toISOString().slice(0, 10),
      buyerPartyId: JSON.parse(party.body).id,
      placeOfSupply: "27",
      lines: [
        {
          name: "Mill Scale",
          hsnSac: "26190090",
          quantity: 10,
          unit: "MTS",
          unitPrice: 250000,
          gstRate: 18,
        },
      ],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const invoiceId = JSON.parse(draft.body).invoice.id as string;

    const finalized = await call("POST", `/api/v1/invoices/${invoiceId}/finalize`, {});
    expect(finalized.statusCode).toBe(200);
    const body = JSON.parse(finalized.body) as {
      invoice: { invoiceNumber: string; einvoiceStatus: string };
      queued: string[];
      portalConnected: { einvoice: boolean; ewb: boolean };
    };

    // The invoice is fully issued...
    expect(body.invoice.invoiceNumber).toMatch(/\/\d+$/);
    // ...but nothing was sent anywhere, and the state says why.
    expect(body.queued).toEqual([]);
    expect(body.portalConnected).toEqual({ einvoice: false, ewb: false });
    expect(body.invoice.einvoiceStatus).toBe("pending");

    const jobs = await call("GET", "/api/v1/jobs");
    const kinds = (JSON.parse(jobs.body) as { items: Array<{ kind: string }> }).items.map(
      (job) => job.kind,
    );
    expect(kinds).toContain("invoice.render_pdf");
    expect(kinds).not.toContain("einvoice.generate");
    expect(kinds).not.toContain("ewb.generate");
  });
});
