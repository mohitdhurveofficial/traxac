import { and, eq, sql } from "drizzle-orm";
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

export const DEFAULT_SERIES: Record<DocType, string> = {
  invoice: "INV",
  credit_note: "CRN",
  debit_note: "DBN",
  delivery_challan: "DCH",
  bill_of_supply: "BOS",
};

/** The series a document type uses when the caller does not name one. */
export function defaultSeriesFor(docType: DocType, requested?: string | null): string {
  return requested?.trim() || DEFAULT_SERIES[docType];
}

export class NumberingService {
  constructor(private readonly database: Database) {}

  /**
   * Reserve the next number.
   *
   * A single `INSERT … ON CONFLICT DO UPDATE … RETURNING` does the whole
   * allocation atomically. Under READ COMMITTED, PostgreSQL guarantees that
   * concurrent executions of this statement serialise on the conflicting row:
   * exactly one wins the insert and the rest take the update branch, each
   * seeing the value the previous one left behind.
   *
   * The earlier read-then-write version needed `SELECT … FOR UPDATE` to hold
   * between two statements, which is one more thing to get right for no gain.
   * A concurrency test that finalizes twelve invoices at once covers this.
   *
   * Must still run inside the invoice transaction, so a rollback returns the
   * number to the series instead of burning it.
   */
  async allocate(
    tx: DbExecutor,
    ctx: AuthContext,
    input: AllocateNumberInput,
  ): Promise<AllocatedNumber> {
    const series = input.series?.trim() || DEFAULT_SERIES[input.docType];
    const fy = financialYear(input.invoiceDate);

    const [row] = await tx
      .insert(invoiceSequences)
      .values({
        tenantId: ctx.tenantId,
        gstinId: input.gstinId,
        docType: input.docType,
        series,
        financialYear: fy,
        // The first invoice consumes 1, so the row is created already pointing
        // at 2 and the RETURNING expression below yields 1 either way.
        nextNumber: 2,
      })
      .onConflictDoUpdate({
        target: [
          invoiceSequences.tenantId, invoiceSequences.gstinId,
          invoiceSequences.docType, invoiceSequences.series,
          invoiceSequences.financialYear,
        ],
        set: {
          nextNumber: sql`${invoiceSequences.nextNumber} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({
        allocated: sql<number>`${invoiceSequences.nextNumber} - 1`,
        prefix: invoiceSequences.prefix,
        suffix: invoiceSequences.suffix,
        padding: invoiceSequences.padding,
      });

    if (!row) throw new AppError("INTERNAL", "Could not reserve a document number");

    const value = Number(row.allocated);
    const body = String(value).padStart(row.padding, "0");
    const invoiceNumber = `${row.prefix}${series}/${fy}/${body}${row.suffix}`;

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
