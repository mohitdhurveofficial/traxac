import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@ewayvo/database";
import {
  ewayBills,
  invoiceLines,
  invoicePayments,
  invoices,
  parties,
  products,
  transporters,
  vehicles,
  requireScope,
} from "@ewayvo/database";
import { AppError } from "@ewayvo/shared";
import { requirePermission, type AuthContext } from "../auth/context.js";
import { scoped, scopedById } from "../auth/tenant-guard.js";
import { countExpr } from "./query.js";

/**
 * Ledgers and history.
 *
 * Everything here answers "what has happened with this thing?" — a customer,
 * an item, a lorry. All of it is aggregated in SQL rather than by loading
 * rows into memory, because these pages must stay fast on a business with
 * fifty thousand invoices.
 *
 * Cancelled and draft documents are excluded from money totals throughout: a
 * cancelled invoice is not turnover.
 */
const COUNTS_AS_SALE = sql`status NOT IN ('draft', 'cancelled')`;

export interface AgeingBucket {
  label: string;
  from: number;
  to: number | null;
  amount: number;
  count: number;
}

export class LedgerService {
  constructor(private readonly database: Database) {}

  private get db() {
    // The ambient transaction carries the tenant GUC that RLS reads.
    // Unscoped access throws rather than silently using the pool.
    return requireScope();
  }

  /* --------------------------- Customer ledger -------------------------- */

  async customerLedger(ctx: AuthContext, partyId: string) {
    const [party] = await this.db
      .select()
      .from(parties)
      .where(scopedById(ctx, parties, partyId))
      .limit(1);
    if (!party) throw new AppError("NOT_FOUND", "Customer not found");

    const scopeSale = scoped(
      ctx,
      invoices,
      eq(invoices.buyerPartyId, partyId),
      ne(invoices.status, "draft"),
      ne(invoices.status, "cancelled"),
    );

    const [totals, recent, topProducts, payments] = await Promise.all([
      this.db
        .select({
          invoiceCount: countExpr,
          totalSales: sql<number>`COALESCE(SUM(${invoices.grandTotal}), 0)::bigint`,
          totalPaid: sql<number>`COALESCE(SUM(${invoices.amountPaid}), 0)::bigint`,
          outstanding: sql<number>`COALESCE(SUM(${invoices.grandTotal} - ${invoices.amountPaid}), 0)::bigint`,
          overdue: sql<number>`COALESCE(SUM(CASE
              WHEN ${invoices.dueDate} < now() AND ${invoices.amountPaid} < ${invoices.grandTotal}
              THEN ${invoices.grandTotal} - ${invoices.amountPaid} ELSE 0 END), 0)::bigint`,
          firstInvoice: sql<Date | null>`MIN(${invoices.invoiceDate})`,
          lastInvoice: sql<Date | null>`MAX(${invoices.invoiceDate})`,
        })
        .from(invoices)
        .where(scopeSale),

      this.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          docType: invoices.docType,
          grandTotal: invoices.grandTotal,
          amountPaid: invoices.amountPaid,
          dueDate: invoices.dueDate,
          status: invoices.status,
          einvoiceStatus: invoices.einvoiceStatus,
          ewbStatus: invoices.ewbStatus,
        })
        .from(invoices)
        .where(scoped(ctx, invoices, eq(invoices.buyerPartyId, partyId)))
        .orderBy(desc(invoices.invoiceDate))
        .limit(20),

      this.db
        .select({
          name: invoiceLines.name,
          hsnSac: invoiceLines.hsnSac,
          unit: invoiceLines.unit,
          quantity: sql<string>`SUM(${invoiceLines.quantity})`,
          value: sql<number>`SUM(${invoiceLines.lineTotal})::bigint`,
          lastPrice: sql<number>`(ARRAY_AGG(${invoiceLines.unitPrice} ORDER BY ${invoices.invoiceDate} DESC))[1]`,
          lastSoldOn: sql<Date>`MAX(${invoices.invoiceDate})`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .where(scopeSale)
        .groupBy(invoiceLines.name, invoiceLines.hsnSac, invoiceLines.unit)
        .orderBy(desc(sql`SUM(${invoiceLines.lineTotal})`))
        .limit(10),

      this.db
        .select({
          id: invoicePayments.id,
          amount: invoicePayments.amount,
          paidAt: invoicePayments.paidAt,
          method: invoicePayments.method,
          reference: invoicePayments.reference,
          invoiceNumber: invoices.invoiceNumber,
        })
        .from(invoicePayments)
        .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
        .where(scoped(ctx, invoicePayments, eq(invoices.buyerPartyId, partyId)))
        .orderBy(desc(invoicePayments.paidAt))
        .limit(20),
    ]);

    const t = totals[0];
    return {
      party,
      totals: {
        invoiceCount: Number(t?.invoiceCount ?? 0),
        totalSales: Number(t?.totalSales ?? 0),
        totalPaid: Number(t?.totalPaid ?? 0),
        outstanding: Number(t?.outstanding ?? 0),
        overdue: Number(t?.overdue ?? 0),
        firstInvoice: t?.firstInvoice ?? null,
        lastInvoice: t?.lastInvoice ?? null,
      },
      recentInvoices: recent,
      topProducts: topProducts.map((p) => ({ ...p, quantity: Number(p.quantity) })),
      payments,
    };
  }

  /* ---------------------------- Product history ------------------------- */

  async productHistory(ctx: AuthContext, productId: string) {
    const [product] = await this.db
      .select()
      .from(products)
      .where(scopedById(ctx, products, productId))
      .limit(1);
    if (!product) throw new AppError("NOT_FOUND", "Item not found");

    const soldScope = and(
      eq(invoiceLines.tenantId, ctx.tenantId),
      eq(invoiceLines.productId, productId),
      ne(invoices.status, "draft"),
      ne(invoices.status, "cancelled"),
    );

    const [totals, byCustomer, recent] = await Promise.all([
      this.db
        .select({
          invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
          quantity: sql<string>`COALESCE(SUM(${invoiceLines.quantity}), 0)`,
          value: sql<number>`COALESCE(SUM(${invoiceLines.lineTotal}), 0)::bigint`,
          averagePrice: sql<number>`COALESCE(AVG(${invoiceLines.unitPrice}), 0)::bigint`,
          minPrice: sql<number>`COALESCE(MIN(${invoiceLines.unitPrice}), 0)::bigint`,
          maxPrice: sql<number>`COALESCE(MAX(${invoiceLines.unitPrice}), 0)::bigint`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .where(soldScope),

      this.db
        .select({
          partyId: invoices.buyerPartyId,
          customer: sql<string>`${invoices.billTo}->>'name'`,
          quantity: sql<string>`SUM(${invoiceLines.quantity})`,
          value: sql<number>`SUM(${invoiceLines.lineTotal})::bigint`,
          // The price this customer last paid — what a trader actually wants
          // when quoting them again.
          lastPrice: sql<number>`(ARRAY_AGG(${invoiceLines.unitPrice} ORDER BY ${invoices.invoiceDate} DESC))[1]`,
          lastSoldOn: sql<Date>`MAX(${invoices.invoiceDate})`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .where(soldScope)
        .groupBy(invoices.buyerPartyId, sql`${invoices.billTo}->>'name'`)
        .orderBy(desc(sql`SUM(${invoiceLines.lineTotal})`))
        .limit(15),

      this.db
        .select({
          invoiceId: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          customer: sql<string>`${invoices.billTo}->>'name'`,
          quantity: invoiceLines.quantity,
          unit: invoiceLines.unit,
          unitPrice: invoiceLines.unitPrice,
          lineTotal: invoiceLines.lineTotal,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .where(soldScope)
        .orderBy(desc(invoices.invoiceDate))
        .limit(25),
    ]);

    const t = totals[0];
    return {
      product,
      totals: {
        invoiceCount: Number(t?.invoiceCount ?? 0),
        quantity: Number(t?.quantity ?? 0),
        value: Number(t?.value ?? 0),
        averagePrice: Number(t?.averagePrice ?? 0),
        minPrice: Number(t?.minPrice ?? 0),
        maxPrice: Number(t?.maxPrice ?? 0),
      },
      customers: byCustomer.map((c) => ({ ...c, quantity: Number(c.quantity) })),
      recentSales: recent,
    };
  }

  /* --------------------------- Transport history ------------------------ */

  async transporterHistory(ctx: AuthContext, transporterId: string) {
    const [transporter] = await this.db
      .select()
      .from(transporters)
      .where(scopedById(ctx, transporters, transporterId))
      .limit(1);
    if (!transporter) throw new AppError("NOT_FOUND", "Transporter not found");

    const scopeShip = scoped(
      ctx,
      invoices,
      eq(invoices.transporterId, transporterId),
      ne(invoices.status, "draft"),
    );

    const [totals, byVehicle, recent] = await Promise.all([
      this.db
        .select({
          shipments: countExpr,
          value: sql<number>`COALESCE(SUM(${invoices.grandTotal}), 0)::bigint`,
          distance: sql<number>`COALESCE(SUM(${invoices.distanceKm}), 0)::int`,
          lastUsed: sql<Date | null>`MAX(${invoices.invoiceDate})`,
        })
        .from(invoices)
        .where(scopeShip),

      this.db
        .select({
          vehicleNo: invoices.vehicleNo,
          shipments: countExpr,
          lastUsed: sql<Date>`MAX(${invoices.invoiceDate})`,
        })
        .from(invoices)
        .where(and(scopeShip, sql`${invoices.vehicleNo} IS NOT NULL`))
        .groupBy(invoices.vehicleNo)
        .orderBy(desc(countExpr))
        .limit(20),

      this.recentShipments(ctx, eq(invoices.transporterId, transporterId)),
    ]);

    const t = totals[0];
    return {
      transporter,
      totals: {
        shipments: Number(t?.shipments ?? 0),
        value: Number(t?.value ?? 0),
        distanceKm: Number(t?.distance ?? 0),
        lastUsed: t?.lastUsed ?? null,
      },
      vehicles: byVehicle,
      recentShipments: recent,
    };
  }

  async vehicleHistory(ctx: AuthContext, vehicleId: string) {
    const [vehicle] = await this.db
      .select()
      .from(vehicles)
      .where(scopedById(ctx, vehicles, vehicleId))
      .limit(1);
    if (!vehicle) throw new AppError("NOT_FOUND", "Vehicle not found");

    const [totals, recent] = await Promise.all([
      this.db
        .select({
          shipments: countExpr,
          value: sql<number>`COALESCE(SUM(${invoices.grandTotal}), 0)::bigint`,
          lastUsed: sql<Date | null>`MAX(${invoices.invoiceDate})`,
        })
        .from(invoices)
        .where(scoped(ctx, invoices, eq(invoices.vehicleNo, vehicle.vehicleNo))),
      this.recentShipments(ctx, eq(invoices.vehicleNo, vehicle.vehicleNo)),
    ]);

    const t = totals[0];
    return {
      vehicle,
      totals: {
        shipments: Number(t?.shipments ?? 0),
        value: Number(t?.value ?? 0),
        lastUsed: t?.lastUsed ?? null,
      },
      recentShipments: recent,
    };
  }

  private recentShipments(ctx: AuthContext, predicate: ReturnType<typeof eq>) {
    return this.db
      .select({
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        customer: sql<string>`${invoices.billTo}->>'name'`,
        vehicleNo: invoices.vehicleNo,
        distanceKm: invoices.distanceKm,
        transportDocNo: invoices.transportDocNo,
        grandTotal: invoices.grandTotal,
        ewbNumber: ewayBills.ewbNumber,
        ewbStatus: ewayBills.status,
        ewbValidUntil: ewayBills.validUntil,
      })
      .from(invoices)
      .leftJoin(ewayBills, eq(ewayBills.invoiceId, invoices.id))
      .where(scoped(ctx, invoices, predicate, ne(invoices.status, "draft")))
      .orderBy(desc(invoices.invoiceDate))
      .limit(25);
  }

  /* ----------------------------- Receivables ---------------------------- */

  /**
   * Outstanding money, bucketed by how overdue it is. Buckets are computed in
   * SQL so the whole ledger never crosses the wire.
   */
  async receivables(
    ctx: AuthContext,
    options: { gstinId?: string; buckets?: number[] } = {},
  ): Promise<{ buckets: AgeingBucket[]; total: number; byParty: unknown[] }> {
    const edges = options.buckets ?? [30, 60, 90];
    const where = scoped(
      ctx,
      invoices,
      options.gstinId ? eq(invoices.gstinId, options.gstinId) : undefined,
      ne(invoices.status, "draft"),
      ne(invoices.status, "cancelled"),
      sql`${invoices.amountPaid} < ${invoices.grandTotal}`,
    );

    const rows = await this.db
      .select({
        partyId: invoices.buyerPartyId,
        name: sql<string>`${invoices.billTo}->>'name'`,
        outstanding: sql<number>`SUM(${invoices.grandTotal} - ${invoices.amountPaid})::bigint`,
        invoiceCount: countExpr,
        oldestDue: sql<Date | null>`MIN(${invoices.dueDate})`,
        overdueDays: sql<number>`COALESCE(MAX(EXTRACT(DAY FROM now() - ${invoices.dueDate})), 0)::int`,
      })
      .from(invoices)
      .where(where)
      .groupBy(invoices.buyerPartyId, sql`${invoices.billTo}->>'name'`)
      .orderBy(desc(sql`SUM(${invoices.grandTotal} - ${invoices.amountPaid})`));

    const bucketRows = await this.db
      .select({
        age: sql<number>`COALESCE(EXTRACT(DAY FROM now() - ${invoices.dueDate}), 0)::int`,
        amount: sql<number>`(${invoices.grandTotal} - ${invoices.amountPaid})::bigint`,
      })
      .from(invoices)
      .where(where);

    const buckets: AgeingBucket[] = [
      { label: "Not yet due", from: -Infinity, to: 0, amount: 0, count: 0 },
      ...edges.map((edge, index) => ({
        label: `${index === 0 ? 1 : (edges[index - 1] as number) + 1}–${edge} days`,
        from: index === 0 ? 1 : (edges[index - 1] as number) + 1,
        to: edge,
        amount: 0,
        count: 0,
      })),
      {
        label: `Over ${edges[edges.length - 1]} days`,
        from: (edges[edges.length - 1] as number) + 1,
        to: null,
        amount: 0,
        count: 0,
      },
    ];

    for (const row of bucketRows) {
      const age = Number(row.age);
      const bucket =
        buckets.find(
          (b) => age <= (b.to ?? Infinity) && age >= (b.from === -Infinity ? -Infinity : b.from),
        ) ?? buckets[buckets.length - 1];
      if (bucket) {
        bucket.amount += Number(row.amount);
        bucket.count += 1;
      }
    }

    return {
      buckets,
      total: buckets.reduce((sum, b) => sum + b.amount, 0),
      byParty: rows.map((r) => ({ ...r, outstanding: Number(r.outstanding) })),
    };
  }

  /** Every payment recorded, for the payments report. */
  async paymentHistory(
    ctx: AuthContext,
    options: { partyId?: string; from?: Date; to?: Date; limit?: number; page?: number } = {},
  ) {
    requirePermission(ctx, "reports:read");
    const limit = options.limit ?? 50;
    const page = options.page ?? 1;
    const where = scoped(
      ctx,
      invoicePayments,
      options.partyId ? eq(invoices.buyerPartyId, options.partyId) : undefined,
      options.from ? gte(invoicePayments.paidAt, options.from) : undefined,
      options.to ? lte(invoicePayments.paidAt, options.to) : undefined,
    );

    const [items, [count]] = await Promise.all([
      this.db
        .select({
          id: invoicePayments.id,
          amount: invoicePayments.amount,
          paidAt: invoicePayments.paidAt,
          method: invoicePayments.method,
          reference: invoicePayments.reference,
          notes: invoicePayments.notes,
          invoiceId: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          customer: sql<string>`${invoices.billTo}->>'name'`,
        })
        .from(invoicePayments)
        .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
        .where(where)
        .orderBy(desc(invoicePayments.paidAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ n: countExpr })
        .from(invoicePayments)
        .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
        .where(where),
    ]);

    return { items, total: count?.n ?? 0, limit, page, hasMore: page * limit < (count?.n ?? 0) };
  }
}

export { COUNTS_AS_SALE, asc };
