import { and, eq } from "drizzle-orm";
import type { Database, DbExecutor } from "@traxac/database";
import { invoiceSequences } from "@traxac/database";
import { AppError, financialYear, type DocType } from "@traxac/shared";
import type { AuthContext } from "../auth/context.js";

/**
 * Document numbering.
 *
 * GST requires invoice numbers to be a consecutive series, unique within a
 * financial year, per registration. Numbers are handed out inside the same
 * transaction that inserts the invoice, using a row lock on the sequence so
 * two concurrent finalizations can never receive the same number.
 */

export interface AllocateNumberInput {
  gstinId: string;
  docType: DocType;
  series?: string;
  invoiceDate: Date;
}

export interface AllocatedNumber {
  invoiceNumber: string;
  series: string;
  financialYear: string;
  sequenceValue: number;
}

const DEFAULT_SERIES: Record<DocType, string> = {
  invoice: "INV",
  credit_note: "CRN",
  debit_note: "DBN",
  delivery_challan: "DCH",
  bill_of_supply: "BOS",
};

export class NumberingService {
  constructor(private readonly database: Database) {}

  /**
   * Reserve the next number. Must run inside a transaction — pass the
   * transaction handle so the lock is released with the invoice insert.
   */
  async allocate(
    tx: DbExecutor,
    ctx: AuthContext,
    input: AllocateNumberInput,
  ): Promise<AllocatedNumber> {
    const series = input.series?.trim() || DEFAULT_SERIES[input.docType];
    const fy = financialYear(input.invoiceDate);

    // Create the series lazily the first time it is used.
    await tx.insert(invoiceSequences).values({
      tenantId: ctx.tenantId,
      gstinId: input.gstinId,
      docType: input.docType,
      series,
      financialYear: fy,
      nextNumber: 1,
    }).onConflictDoNothing();

    // `FOR UPDATE` serialises concurrent allocations on this exact series.
    const [locked] = await tx
      .select()
      .from(invoiceSequences)
      .where(and(
        eq(invoiceSequences.tenantId, ctx.tenantId),
        eq(invoiceSequences.gstinId, input.gstinId),
        eq(invoiceSequences.docType, input.docType),
        eq(invoiceSequences.series, series),
        eq(invoiceSequences.financialYear, fy),
      ))
      .for("update")
      .limit(1);
    if (!locked) throw new AppError("INTERNAL", "Could not reserve a document number");

    const value = locked.nextNumber;
    await tx.update(invoiceSequences)
      .set({ nextNumber: value + 1, updatedAt: new Date() })
      .where(eq(invoiceSequences.id, locked.id));

    const body = String(value).padStart(locked.padding, "0");
    const invoiceNumber = `${locked.prefix}${series}/${fy}/${body}${locked.suffix}`;

    return { invoiceNumber, series, financialYear: fy, sequenceValue: value };
  }

  /** Show the number an invoice would receive, without consuming it. */
  async peek(ctx: AuthContext, input: AllocateNumberInput): Promise<string> {
    const series = input.series?.trim() || DEFAULT_SERIES[input.docType];
    const fy = financialYear(input.invoiceDate);
    const [row] = await this.database.db.select().from(invoiceSequences)
      .where(and(
        eq(invoiceSequences.tenantId, ctx.tenantId),
        eq(invoiceSequences.gstinId, input.gstinId),
        eq(invoiceSequences.docType, input.docType),
        eq(invoiceSequences.series, series),
        eq(invoiceSequences.financialYear, fy),
      )).limit(1);
    const next = row?.nextNumber ?? 1;
    const padding = row?.padding ?? 4;
    return `${row?.prefix ?? ""}${series}/${fy}/${String(next).padStart(padding, "0")}${row?.suffix ?? ""}`;
  }

  async listSeries(ctx: AuthContext) {
    return this.database.db.select().from(invoiceSequences)
      .where(eq(invoiceSequences.tenantId, ctx.tenantId));
  }

  /**
   * Adjust a series (prefix/padding/next number). Moving `nextNumber`
   * backwards is refused: reusing a consumed number breaks the GST
   * requirement that a series is consecutive and unique.
   */
  async configureSeries(ctx: AuthContext, id: string, input: {
    prefix?: string; suffix?: string; padding?: number; nextNumber?: number;
  }) {
    const [current] = await this.database.db.select().from(invoiceSequences)
      .where(and(eq(invoiceSequences.id, id), eq(invoiceSequences.tenantId, ctx.tenantId)))
      .limit(1);
    if (!current) throw new AppError("NOT_FOUND", "Number series not found");
    if (input.nextNumber !== undefined && input.nextNumber < current.nextNumber) {
      throw new AppError("VALIDATION_FAILED",
        `The next number cannot go below ${current.nextNumber} — those numbers are already issued`);
    }
    const [row] = await this.database.db.update(invoiceSequences)
      .set({
        prefix: input.prefix ?? current.prefix,
        suffix: input.suffix ?? current.suffix,
        padding: input.padding ?? current.padding,
        nextNumber: input.nextNumber ?? current.nextNumber,
        updatedAt: new Date(),
      })
      .where(eq(invoiceSequences.id, id)).returning();
    return row;
  }
}
