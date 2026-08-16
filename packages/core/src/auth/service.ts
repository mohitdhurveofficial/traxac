import { eq, and, gt } from "drizzle-orm";
import type { Database } from "@traxac/database";
import { memberships, sessions, users } from "@traxac/database";
import { verifyPassword } from "../password.js";
import type { AuthContext, Role } from "./context.js";

const SESSION_DAYS = 7;

export async function login(
  db: Database,
  email: string,
  password: string,
): Promise<{ token: string; ctx: AuthContext } | null> {
  const rows = await db.db
    .select({
      userId: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      tenantId: memberships.tenantId,
      role: memberships.role,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(2);

  // Exactly one active membership expected for login simplicity.
  const row = rows[0];
  if (!row) return null;
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.db.insert(sessions).values({
    id: token,
    userId: row.userId,
    tenantId: row.tenantId as string,
    role: row.role as string,
    expiresAt,
  });

  return {
    token,
    ctx: {
      userId: row.userId,
      email: row.email,
      tenantId: row.tenantId as string,
      role: row.role as Role,
    },
  };
}

export async function resolveSession(
  db: Database,
  token: string,
): Promise<AuthContext | null> {
  const rows = await db.db
    .select({
      userId: sessions.userId,
      tenantId: sessions.tenantId,
      role: sessions.role,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    email: row.email,
    tenantId: row.tenantId,
    role: row.role as Role,
  };
}

export async function logout(db: Database, token: string): Promise<void> {
  await db.db.delete(sessions).where(eq(sessions.id, token));
}
