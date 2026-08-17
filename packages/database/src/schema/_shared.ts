import { bigint, timestamp } from "drizzle-orm/pg-core";

/**
 * All monetary columns are integer **paise** stored as bigint so that a single
 * invoice can safely exceed the 32-bit integer ceiling (~Rs 2.1 crore).
 * `mode: "number"` is safe: 2^53 paise is ~Rs 90,000 crore.
 */
export const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

export const moneyNullable = (name: string) => bigint(name, { mode: "number" });

export const tsCol = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => tsCol("created_at").notNull().defaultNow();
export const updatedAt = () => tsCol("updated_at").notNull().defaultNow();
