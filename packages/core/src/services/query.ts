import { asc, desc, ilike, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Paginated } from "@traxac/shared/contracts";

/** Build a case-insensitive OR search across several text columns. */
export function searchAcross(columns: PgColumn[], term?: string): SQL | undefined {
  const q = term?.trim();
  if (!q) return undefined;
  const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const clauses = columns.map((c) => ilike(c, pattern));
  return clauses.length === 1 ? clauses[0] : (or(...clauses) as SQL);
}

export function orderBy(column: PgColumn, direction: "asc" | "desc"): SQL {
  return direction === "asc" ? asc(column) : desc(column);
}

export function paginate<T>(items: T[], total: number, limit: number, page: number): Paginated<T> {
  return { items, total, limit, page, hasMore: page * limit < total };
}

export const countExpr = sql<number>`count(*)::int`;

/** Narrow a possibly-undefined predicate list for `and(...)`. */
export function compact(...clauses: Array<SQLWrapper | undefined>): SQLWrapper[] {
  return clauses.filter(Boolean) as SQLWrapper[];
}
