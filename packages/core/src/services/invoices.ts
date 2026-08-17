import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { AddressSnapshot, Database, DbExecutor, Invoice } from "@traxac/database";
import {
  branches, einvoices, ewayBills, gstins, invoiceCharges, invoiceLines,
  invoicePayments, invoices, parties, partyAddresses, products, tenantSettings,
  transporters,
} from "@traxac/database";
import {
  AppError, calculateInvoiceTax, DEFAULT_EWB_THRESHOLD_PAISE, deriveTransactionType,
  determineSupplyType, evaluateEwbRequirement, financialYear, isZeroRated,
  normaliseVehicleNo, summariseByHsn, toPaise,
  type ChargeInput, type DocType, type SupplyCategory, type TaxLineInput, type TaxTotals,
} from "@traxac/shared";
import type {
  CreateInvoiceInput, InvoiceListQuery, PreviewInvoiceInput, RecordPaymentInput,
} from "./invoice-types.js";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import type { AuditWriter } from "../infra/audit.js";
import { diffRecords } from "../infra/audit.js";
import { countExpr, orderBy, paginate, searchAcross } from "./query.js";
import type { NumberingService } from "./numbering.js";
import {
  isSamePlace, snapshotFromBranch, snapshotFromGstin, snapshotFromInput,
  snapshotFromParty, snapshotFromPartyAddress,
} from "./invoice-mapping.js";

export interface ResolvedAddresses {
  billFrom: AddressSnapshot;
  billTo: AddressSnapshot;
  shipTo: AddressSnapshot | null;
  dispatchFrom: AddressSnapshot | null;
}

export interface InvoiceDetail {
  invoice: Invoice;
  lines: Array<typeof invoiceLines.$inferSelect>;
  charges: Array<typeof invoiceCharges.$inferSelect>;
  payments: Array<typeof invoicePayments.$inferSelect>;
  einvoice: typeof einvoices.$inferSelect | null;
  ewayBill: typeof ewayBills.$inferSelect | null;
  hsnSummary: ReturnType<typeof summariseByHsn>;
  amountDue: number;
}

/**
 * Invoice lifecycle.
 *
 * draft → pending (finalized, number allocated, compliance queued)
 *       → generated (IRN and/or EWB obtained)
 *       → completed (fully paid) | cancelled | failed
 *
 * A draft is freely editable and consumes no document number. Finalizing is
 * the point of no return: the number is allocated inside the same transaction
 * that flips the status, so a crash cannot burn a number.
 */
export class InvoiceService {
  constructor(
    private readonly database: Database,
    private readonly numbering: NumberingService,
    private readonly audit: AuditWriter,
  ) {}

  private get db() {
    return this.database.db;
  }

  /* ------------------------------ Preview ------------------------------ */

  /**
   * Stateless tax preview for the invoice form. Runs the same engine the
   * server uses on save, so the figures on screen are the figures filed.
   */
  async preview(ctx: AuthContext, input: PreviewInvoiceInput): Promise<TaxTotals> {
    let supplierStateCode = input.supplierStateCode;
    if (!supplierStateCode && input.gstinId) {
      const [row] = await this.db.select({ stateCode: gstins.stateCode }).from(gstins)
        .where(scopedById(ctx, gstins, input.gstinId)).limit(1);
      supplierStateCode = row?.stateCode;
    }
    if (!supplierStateCode) {
      throw new AppError("VALIDATION_FAILED", "Select the GSTIN you are billing from");
    }
    return calculateInvoiceTax({
      supplierStateCode,
      placeOfSupplyStateCode: input.placeOfSupply,
      supplyCategory: input.supplyCategory,
      igstOnIntra: input.igstOnIntra,
      zeroRated: isZeroRated(input.supplyCategory),
      lines: input.lines.map(toTaxLine),
      charges: input.charges.map(toTaxCharge),
    });
  }

  /* ------------------------------ Reading ------------------------------ */

  async list(ctx: AuthContext, query: InvoiceListQuery) {
    const { limit, page } = query;
    const where = scoped(ctx, invoices,
      query.status ? eq(invoices.status, query.status) : undefined,
      query.einvoiceStatus ? eq(invoices.einvoiceStatus, query.einvoiceStatus) : undefined,
      query.ewbStatus ? eq(invoices.ewbStatus, query.ewbStatus) : undefined,
      query.docType ? eq(invoices.docType, query.docType) : undefined,
      query.gstinId ? eq(invoices.gstinId, query.gstinId) : undefined,
      query.buyerPartyId ? eq(invoices.buyerPartyId, query.buyerPartyId) : undefined,
      query.from ? gte(invoices.invoiceDate, query.from) : undefined,
      query.to ? lte(invoices.invoiceDate, query.to) : undefined,
      query.minAmount !== undefined ? gte(invoices.grandTotal, toPaise(query.minAmount)) : undefined,
      query.maxAmount !== undefined ? lte(invoices.grandTotal, toPaise(query.maxAmount)) : undefined,
      query.vehicleNo ? eq(invoices.vehicleNo, normaliseVehicleNo(query.vehicleNo)) : undefined,
      // Search spans the number, the buyer's name and their GSTIN.
      query.q
        ? sql`(${invoices.invoiceNumber} ILIKE ${`%${query.q}%`}
            OR ${invoices.billTo}->>'name' ILIKE ${`%${query.q}%`}
            OR ${invoices.billTo}->>'gstin' ILIKE ${`%${query.q}%`}
            OR ${invoices.poNumber} ILIKE ${`%${query.q}%`})`
        : undefined,
      query.irn
        ? sql`EXISTS (SELECT 1 FROM einvoices e WHERE e.invoice_id = ${invoices.id} AND e.irn ILIKE ${`%${query.irn}%`})`
        : undefined,
      query.ewbNumber
        ? sql`EXISTS (SELECT 1 FROM eway_bills w WHERE w.invoice_id = ${invoices.id} AND w.ewb_number ILIKE ${`%${query.ewbNumber}%`})`
        : undefined,
    );

    const sortColumn = {
      invoiceDate: invoices.invoiceDate,
      grandTotal: invoices.grandTotal,
      createdAt: invoices.createdAt,
      invoiceNumber: invoices.invoiceNumber,
    }[query.sort];

    const [rows, [count]] = await Promise.all([
      this.db
        .select({
          invoice: invoices,
          irn: einvoices.irn,
          ewbNumber: ewayBills.ewbNumber,
          ewbValidUntil: ewayBills.validUntil,
        })
        .from(invoices)
        .leftJoin(einvoices, eq(einvoices.invoiceId, invoices.id))
        .leftJoin(ewayBills, eq(ewayBills.invoiceId, invoices.id))
        .where(where)
        .orderBy(orderBy(sortColumn, query.order), desc(invoices.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ n: countExpr }).from(invoices).where(where),
    ]);

    return paginate(
      rows.map((r) => ({
        ...r.invoice,
        irn: r.irn,
        ewbNumber: r.ewbNumber,
        ewbValidUntil: r.ewbValidUntil,
      })),
      count?.n ?? 0,
      limit,
      page,
    );
  }

  async get(ctx: AuthContext, id: string): Promise<InvoiceDetail> {
    const [invoice] = await this.db.select().from(invoices)
      .where(scopedById(ctx, invoices, id)).limit(1);
    if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found");

    const [lines, charges, payments, [einvoice], [ewayBill]] = await Promise.all([
      this.db.select().from(invoiceLines)
        .where(scoped(ctx, invoiceLines, eq(invoiceLines.invoiceId, id)))
        .orderBy(asc(invoiceLines.position)),
      this.db.select().from(invoiceCharges)
        .where(scoped(ctx, invoiceCharges, eq(invoiceCharges.invoiceId, id)))
        .orderBy(asc(invoiceCharges.position)),
      this.db.select().from(invoicePayments)
        .where(scoped(ctx, invoicePayments, eq(invoicePayments.invoiceId, id)))
        .orderBy(desc(invoicePayments.paidAt)),
      this.db.select().from(einvoices)
        .where(scoped(ctx, einvoices, eq(einvoices.invoiceId, id))).limit(1),
      this.db.select().from(ewayBills)
        .where(scoped(ctx, ewayBills, eq(ewayBills.invoiceId, id)))
        .orderBy(desc(ewayBills.createdAt)).limit(1),
    ]);

    return {
      invoice,
      lines,
      charges,
      payments,
      einvoice: einvoice ?? null,
      ewayBill: ewayBill ?? null,
      hsnSummary: summariseByHsn(lines.map((l) => ({
        grossValue: l.grossValue,
        discountAmount: l.discountAmount,
        taxableValue: l.taxableValue,
        gstRate: Number(l.gstRate),
        cgst: l.cgst,
        sgst: l.sgst,
        igst: l.igst,
        cess: l.cess,
        cessNonAdvol: l.cessNonAdvol,
        stateCess: l.stateCess,
        totalTax: l.totalTax,
        lineTotal: l.lineTotal,
        hsnSac: l.hsnSac,
        quantity: Number(l.quantity),
        unit: l.unit,
      }))),
      amountDue: invoice.grandTotal - invoice.amountPaid,
    };
  }

  /* ------------------------------ Writing ------------------------------ */

  async createDraft(ctx: AuthContext, input: CreateInvoiceInput): Promise<InvoiceDetail> {
    requirePermission(ctx, "invoices:write");
    const prepared = await this.prepare(ctx, input);

    // The id is generated up front so the draft placeholder can be derived
    // from it. A timestamp-based placeholder collides when two drafts are
    // created in the same millisecond, which the unique number index rejects.
    const invoiceId = randomUUID();

    const created = await this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values({
        ...prepared.header,
        id: invoiceId,
        tenantId: ctx.tenantId,
        invoiceNumber: input.invoiceNumber?.trim() || draftNumber(invoiceId),
        status: "draft",
        einvoiceStatus: "not_required",
        ewbStatus: "not_required",
        createdByUserId: ctx.userId,
        updatedByUserId: ctx.userId,
      }).returning();
      if (!invoice) throw new AppError("INTERNAL", "Could not create the invoice");
      await this.writeChildren(tx, ctx, invoice.id, prepared);
      return invoice;
    });

    await this.audit.record(ctx, {
      action: "invoice.created",
      entityType: "invoice",
      entityId: created.id,
      summary: `Draft for ${prepared.header.billTo.name}`,
      metadata: { grandTotal: created.grandTotal },
    });
    return this.get(ctx, created.id);
  }

  async updateDraft(ctx: AuthContext, id: string, input: CreateInvoiceInput): Promise<InvoiceDetail> {
    requirePermission(ctx, "invoices:write");
    const [existing] = await this.db.select().from(invoices)
      .where(scopedById(ctx, invoices, id)).limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "Invoice not found");
    if (existing.status !== "draft") {
      throw new AppError("INVALID_STATE",
        `A ${existing.status} invoice cannot be edited. Cancel it and issue a credit note instead.`);
    }

    const prepared = await this.prepare(ctx, input);
    const updated = await this.db.transaction(async (tx) => {
      const [invoice] = await tx.update(invoices)
        .set({
          ...prepared.header,
          invoiceNumber: input.invoiceNumber?.trim() || existing.invoiceNumber,
          updatedByUserId: ctx.userId,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id)).returning();
      if (!invoice) throw new AppError("INTERNAL", "Could not update the invoice");
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      await tx.delete(invoiceCharges).where(eq(invoiceCharges.invoiceId, id));
      await this.writeChildren(tx, ctx, id, prepared);
      return invoice;
    });

    await this.audit.record(ctx, {
      action: "invoice.updated", entityType: "invoice", entityId: id,
      diff: diffRecords(existing, updated),
    });
    return this.get(ctx, id);
  }

  /**
   * Finalize: allocate the real document number and lock the content.
   * Returns the invoice; queuing IRN/EWB work is the caller's decision so the
   * compliance layer stays out of the invoice core.
   */
  async finalize(ctx: AuthContext, id: string): Promise<Invoice> {
    requirePermission(ctx, "invoices:finalize");
    const [existing] = await this.db.select().from(invoices)
      .where(scopedById(ctx, invoices, id)).limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "Invoice not found");
    if (existing.status !== "draft") {
      throw new AppError("INVALID_STATE", `This invoice is already ${existing.status}`);
    }

    const lineCount = await this.db.select({ n: countExpr }).from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id));
    if ((lineCount[0]?.n ?? 0) === 0) {
      throw new AppError("VALIDATION_FAILED", "Add at least one item before finalizing");
    }

    const [gstin] = await this.db.select().from(gstins)
      .where(scopedById(ctx, gstins, existing.gstinId)).limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "Billing GSTIN not found");

    const finalized = await this.db.transaction(async (tx) => {
      const allocated = await this.numbering.allocate(tx, ctx, {
        gstinId: existing.gstinId,
        docType: existing.docType as DocType,
        series: existing.series,
        invoiceDate: existing.invoiceDate,
      });
      const einvoiceApplies = gstin.einvoiceEnabled
        && existing.docType !== "delivery_challan"
        && (existing.billTo.gstin ?? "URP") !== "URP";

      const [row] = await tx.update(invoices).set({
        invoiceNumber: allocated.invoiceNumber,
        series: allocated.series,
        financialYear: allocated.financialYear,
        status: "pending",
        einvoiceStatus: einvoiceApplies ? "pending" : "not_required",
        ewbStatus: existing.ewbRequired ? "pending" : "not_required",
        finalizedAt: new Date(),
        updatedByUserId: ctx.userId,
        updatedAt: new Date(),
      }).where(eq(invoices.id, id)).returning();
      if (!row) throw new AppError("INTERNAL", "Could not finalize the invoice");
      return row;
    });

    await this.audit.record(ctx, {
      action: "invoice.finalized",
      entityType: "invoice",
      entityId: id,
      summary: `Issued as ${finalized.invoiceNumber}`,
      metadata: { grandTotal: finalized.grandTotal, ewbRequired: finalized.ewbRequired },
    });
    return finalized;
  }

  /**
   * Cancel an invoice. Compliance cancellation (IRN/EWB) is handled by the
   * compliance service before this is called — an invoice with a live IRN
   * cannot be cancelled locally, because the IRP is the source of truth.
   */
  async cancel(ctx: AuthContext, id: string, reason: string): Promise<Invoice> {
    requirePermission(ctx, "invoices:cancel");
    const [existing] = await this.db.select().from(invoices)
      .where(scopedById(ctx, invoices, id)).limit(1);
    if (!existing) throw new AppError("NOT_FOUND", "Invoice not found");
    if (existing.status === "cancelled") return existing;
    if (existing.einvoiceStatus === "generated") {
      throw new AppError("INVALID_STATE",
        "Cancel the e-Invoice (IRN) first — the IRP must be told before the invoice is voided");
    }
    if (existing.ewbStatus === "generated") {
      throw new AppError("INVALID_STATE", "Cancel the e-Way Bill first");
    }

    const [row] = await this.db.update(invoices).set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledByUserId: ctx.userId,
      cancelReason: reason,
      updatedAt: new Date(),
    }).where(eq(invoices.id, id)).returning();
    if (!row) throw new AppError("INTERNAL", "Could not cancel the invoice");

    await this.audit.record(ctx, {
      action: "invoice.cancelled", entityType: "invoice", entityId: id, summary: reason,
    });
    return row;
  }

  async recordPayment(ctx: AuthContext, id: string, input: RecordPaymentInput) {
    requirePermission(ctx, "invoices:write");
    const [invoice] = await this.db.select().from(invoices)
      .where(scopedById(ctx, invoices, id)).limit(1);
    if (!invoice) throw new AppError("NOT_FOUND", "Invoice not found");
    if (invoice.status === "draft") {
      throw new AppError("INVALID_STATE", "Finalize the invoice before recording a payment");
    }

    const amount = toPaise(input.amount as number | string);
    if (amount <= 0) throw new AppError("VALIDATION_FAILED", "Payment must be greater than zero");

    const updated = await this.db.transaction(async (tx) => {
      await tx.insert(invoicePayments).values({
        tenantId: ctx.tenantId,
        invoiceId: id,
        amount,
        paidAt: input.paidAt ?? new Date(),
        method: input.method,
        reference: input.reference || null,
        notes: input.notes || null,
        recordedByUserId: ctx.userId,
      });
      const paid = invoice.amountPaid + amount;
      const [row] = await tx.update(invoices).set({
        amountPaid: paid,
        status: paid >= invoice.grandTotal && invoice.status !== "cancelled"
          ? "completed"
          : invoice.status,
        updatedAt: new Date(),
      }).where(eq(invoices.id, id)).returning();
      return row;
    });

    await this.audit.record(ctx, {
      action: "invoice.payment_recorded", entityType: "invoice", entityId: id,
      metadata: { amount, method: input.method },
    });
    return updated;
  }

  /** Copy an existing invoice into a fresh draft — the fastest repeat billing. */
  async duplicate(ctx: AuthContext, id: string): Promise<InvoiceDetail> {
    requirePermission(ctx, "invoices:write");
    const source = await this.get(ctx, id);
    const invoiceId = randomUUID();
    const created = await this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values({
        ...stripIdentity(source.invoice),
        id: invoiceId,
        tenantId: ctx.tenantId,
        invoiceNumber: draftNumber(invoiceId),
        invoiceDate: new Date(),
        financialYear: financialYear(new Date()),
        status: "draft",
        einvoiceStatus: "not_required",
        ewbStatus: "not_required",
        amountPaid: 0,
        finalizedAt: null,
        cancelledAt: null,
        cancelledByUserId: null,
        cancelReason: null,
        createdByUserId: ctx.userId,
        updatedByUserId: ctx.userId,
      }).returning();
      if (!invoice) throw new AppError("INTERNAL", "Could not duplicate the invoice");

      if (source.lines.length) {
        await tx.insert(invoiceLines).values(source.lines.map((l) => ({
          ...stripIdentity(l), tenantId: ctx.tenantId, invoiceId: invoice.id,
        })));
      }
      if (source.charges.length) {
        await tx.insert(invoiceCharges).values(source.charges.map((c) => ({
          ...stripIdentity(c), tenantId: ctx.tenantId, invoiceId: invoice.id,
        })));
      }
      return invoice;
    });
    await this.audit.record(ctx, {
      action: "invoice.duplicated", entityType: "invoice", entityId: created.id,
      metadata: { sourceInvoiceId: id },
    });
    return this.get(ctx, created.id);
  }

  /* --------------------------- Internal helpers ------------------------ */

  /**
   * Turn API input into the persisted header plus its children: resolves
   * every address, runs the tax engine and decides whether an EWB applies.
   */
  private async prepare(ctx: AuthContext, input: CreateInvoiceInput) {
    const [gstin] = await this.db.select().from(gstins)
      .where(scopedById(ctx, gstins, input.gstinId)).limit(1);
    if (!gstin) throw new AppError("NOT_FOUND", "Billing GSTIN not found");

    const branch = input.branchId
      ? (await this.db.select().from(branches)
          .where(scopedById(ctx, branches, input.branchId)).limit(1))[0] ?? null
      : null;

    const addresses = await this.resolveAddresses(ctx, input, gstin, branch);

    const supplyCategory = input.supplyCategory as SupplyCategory;
    const totals = calculateInvoiceTax({
      supplierStateCode: gstin.stateCode,
      placeOfSupplyStateCode: input.placeOfSupply,
      supplyCategory,
      igstOnIntra: input.igstOnIntra,
      zeroRated: isZeroRated(supplyCategory),
      lines: input.lines.map(toTaxLine),
      charges: input.charges.map(toTaxCharge),
    });

    const goodsInvolved = input.lines.some((l) => !l.isService);
    const settings = await this.settingsFor(ctx);
    const requirement = evaluateEwbRequirement({
      grandTotalPaise: totals.grandTotal,
      isIntraState: totals.supplyType === "intra_state",
      goodsInvolved,
      thresholdPaise: settings.ewbThresholdPaise,
    });
    const ewbRequired = input.ewbRequired ?? requirement.required;

    const transactionType = deriveTransactionType({
      hasSeparateShipTo: !isSamePlace(addresses.shipTo, addresses.billTo),
      hasSeparateDispatchFrom: !isSamePlace(addresses.dispatchFrom, addresses.billFrom),
    });

    const transport = input.transport;
    const vehicleNo = transport?.vehicleNo ? normaliseVehicleNo(transport.vehicleNo) : null;
    if (transport?.transporterId) {
      const [row] = await this.db.select({ id: transporters.id }).from(transporters)
        .where(scopedById(ctx, transporters, transport.transporterId)).limit(1);
      if (!row) throw new AppError("NOT_FOUND", "Transporter not found");
    }

    return {
      header: {
        gstinId: gstin.id,
        branchId: branch?.id ?? null,
        docType: input.docType,
        series: input.series,
        financialYear: financialYear(input.invoiceDate),
        supplyCategory,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate ?? null,
        buyerPartyId: input.buyerPartyId ?? null,
        billFrom: addresses.billFrom,
        billTo: addresses.billTo,
        shipTo: addresses.shipTo,
        dispatchFrom: addresses.dispatchFrom,
        placeOfSupply: input.placeOfSupply,
        isExport: supplyCategory.startsWith("export"),
        reverseCharge: input.reverseCharge,
        igstOnIntra: input.igstOnIntra,
        currency: input.currency,
        exchangeRate: String(input.exchangeRate),
        exportInfo: input.exportInfo
          ? {
              ...input.exportInfo,
              shippingBillDate: input.exportInfo.shippingBillDate?.toISOString() ?? undefined,
            }
          : null,
        grossValue: totals.grossValue,
        totalDiscount: totals.totalDiscount,
        taxableValue: totals.taxableValue,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        cess: totals.cess,
        cessNonAdvol: totals.cessNonAdvol,
        stateCess: totals.stateCess,
        totalTax: totals.totalTax,
        otherCharges: totals.otherCharges,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        ewbRequired,
        transporterId: transport?.transporterId ?? null,
        transportMode: transport?.transportMode ?? null,
        distanceKm: transport?.distanceKm ?? null,
        vehicleNo,
        vehicleType: transport?.vehicleType ?? null,
        transportDocNo: transport?.transportDocNo || null,
        transportDocDate: transport?.transportDocDate ?? null,
        subSupplyType: transport?.subSupplyType ?? "1",
        ewbTransactionType: transactionType,
        referenceInvoiceId: input.referenceInvoiceId ?? null,
        reason: input.reason || null,
        poNumber: input.poNumber || null,
        poDate: input.poDate ?? null,
        notes: input.notes || null,
        terms: input.terms || settings.defaultTerms,
      },
      totals,
      input,
    };
  }

  private async writeChildren(
    tx: DbExecutor,
    ctx: AuthContext,
    invoiceId: string,
    prepared: Awaited<ReturnType<InvoiceService["prepare"]>>,
  ): Promise<void> {
    const { input, totals } = prepared;
    if (input.lines.length) {
      await tx.insert(invoiceLines).values(input.lines.map((line, index) => {
        const computed = totals.lines[index]!;
        return {
          tenantId: ctx.tenantId,
          invoiceId,
          productId: line.productId ?? null,
          position: index,
          name: line.name,
          description: line.description || null,
          hsnSac: line.hsnSac,
          isService: line.isService,
          barcode: line.barcode || null,
          batchNo: line.batchNo || null,
          expiryDate: line.expiryDate ?? null,
          quantity: String(line.quantity),
          unit: line.unit,
          unitPrice: toPaise(line.unitPrice as number | string),
          discountPercent: String(line.discountPercent),
          discountAmount: computed.discountAmount,
          grossValue: computed.grossValue,
          taxableValue: computed.taxableValue,
          gstRate: String(computed.gstRate),
          cgst: computed.cgst,
          sgst: computed.sgst,
          igst: computed.igst,
          cessRate: String(line.cessRate),
          cess: computed.cess,
          cessNonAdvol: computed.cessNonAdvol,
          stateCess: computed.stateCess,
          totalTax: computed.totalTax,
          lineTotal: computed.lineTotal,
        };
      }));
    }
    if (input.charges.length) {
      await tx.insert(invoiceCharges).values(input.charges.map((charge, index) => {
        const computed = totals.charges[index]!;
        return {
          tenantId: ctx.tenantId,
          invoiceId,
          position: index,
          label: charge.label,
          kind: charge.kind,
          hsnSac: charge.hsnSac || null,
          amount: computed.amount,
          gstRate: String(computed.gstRate),
          cgst: computed.cgst,
          sgst: computed.sgst,
          igst: computed.igst,
          taxAmount: computed.taxAmount,
        };
      }));
    }
  }

  private async resolveAddresses(
    ctx: AuthContext,
    input: CreateInvoiceInput,
    gstin: typeof gstins.$inferSelect,
    branch: typeof branches.$inferSelect | null,
  ): Promise<ResolvedAddresses> {
    const billFrom = snapshotFromGstin(gstin, branch);

    let billTo: AddressSnapshot;
    if (input.billTo) {
      billTo = snapshotFromInput(input.billTo);
    } else if (input.buyerPartyId) {
      const [party] = await this.db.select().from(parties)
        .where(scopedById(ctx, parties, input.buyerPartyId)).limit(1);
      if (!party) throw new AppError("NOT_FOUND", "Customer not found");
      billTo = snapshotFromParty(party);
    } else {
      throw new AppError("VALIDATION_FAILED", "Choose a customer or enter Bill To details");
    }

    let shipTo: AddressSnapshot | null = null;
    if (input.shipTo) {
      shipTo = snapshotFromInput(input.shipTo);
    } else if (input.shipToAddressId) {
      const [address] = await this.db.select().from(partyAddresses)
        .where(scopedById(ctx, partyAddresses, input.shipToAddressId)).limit(1);
      if (!address) throw new AppError("NOT_FOUND", "Ship To address not found");
      shipTo = snapshotFromPartyAddress(address);
    }

    let dispatchFrom: AddressSnapshot | null = null;
    if (input.dispatchFrom) {
      dispatchFrom = snapshotFromInput(input.dispatchFrom);
    } else if (input.dispatchFromBranchId) {
      const [dispatchBranch] = await this.db.select().from(branches)
        .where(scopedById(ctx, branches, input.dispatchFromBranchId)).limit(1);
      if (!dispatchBranch) throw new AppError("NOT_FOUND", "Dispatch From branch not found");
      dispatchFrom = snapshotFromBranch(dispatchBranch, gstin);
    }

    return { billFrom, billTo, shipTo, dispatchFrom };
  }

  private async settingsFor(ctx: AuthContext) {
    const [row] = await this.db.select().from(tenantSettings)
      .where(eq(tenantSettings.tenantId, ctx.tenantId)).limit(1);
    return {
      ewbThresholdPaise: row?.ewbThreshold?.paise ?? DEFAULT_EWB_THRESHOLD_PAISE,
      defaultTerms: row?.defaultTerms ?? null,
      autoGenerateEinvoice: row?.autoGenerateEinvoice ?? true,
      autoGenerateEwb: row?.autoGenerateEwb ?? false,
    };
  }
}

function toTaxLine(line: CreateInvoiceInput["lines"][number]): TaxLineInput {
  return {
    quantity: Number(line.quantity),
    unitPrice: toPaise(line.unitPrice as number | string),
    discountPercent: line.discountPercent,
    discountAmount: toPaise(line.discountAmount as number | string),
    gstRate: line.gstRate,
    cessRate: line.cessRate,
    cessNonAdvol: toPaise(line.cessNonAdvol as number | string),
    stateCess: toPaise(line.stateCess as number | string),
  };
}

function toTaxCharge(charge: CreateInvoiceInput["charges"][number]): ChargeInput {
  return {
    label: charge.label,
    amount: toPaise(charge.amount as number | string),
    gstRate: charge.gstRate,
  };
}

/**
 * Placeholder shown while an invoice is a draft. Derived from the row's own
 * primary key so it is unique by construction — no document number is
 * consumed until the invoice is finalized.
 */
function draftNumber(invoiceId: string): string {
  return `DRAFT-${invoiceId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

/** Strip primary keys and timestamps so a row can be re-inserted as a copy. */
function stripIdentity<T extends Record<string, unknown>>(row: T): Omit<T, "id" | "createdAt" | "updatedAt"> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row as Record<string, unknown>;
  return rest as Omit<T, "id" | "createdAt" | "updatedAt">;
}

export { determineSupplyType, inArray };
