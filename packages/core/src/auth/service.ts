import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "@traxac/database";
import {
  apiKeys,
  gstins,
  memberships,
  passwordResets,
  requireScope,
  sessions,
  tenantSettings,
  tenants,
  users,
} from "@traxac/database";
import { AppError, ROLE_PERMISSIONS, type Role } from "@traxac/shared";
import type { SessionUser } from "@traxac/shared/contracts";
import { hashPassword, needsRehash, verifyPassword } from "../infra/password.js";
import { randomToken, sha256 } from "../infra/crypto.js";
import type { AuthContext } from "./context.js";

/** Short enough to limit exposure, long enough for the user to find the email. */
const PASSWORD_RESET_TTL_MINUTES = 60;

export interface AuthServiceOptions {
  sessionTtlDays: number;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: SessionUser;
  /** Other businesses this account can switch into. */
  tenants: Array<{ id: string; name: string; slug: string; role: Role }>;
}

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "business"
  );
}

export class AuthService {
  constructor(
    private readonly database: Database,
    private readonly options: AuthServiceOptions,
  ) {}

  private get db() {
    // Auth runs inside whichever scope the caller established: a system
    // scope while resolving a caller or signing in, a tenant scope once the
    // session is known. Never the bare pool.
    return requireScope();
  }

  /** Create a user, their first business, and sign them in. */
  async register(
    input: {
      name: string;
      email: string;
      password: string;
      businessName: string;
      phone?: string | undefined;
    },
    meta: RequestMeta = {},
  ): Promise<LoginResult> {
    const email = input.email.toLowerCase().trim();
    const existing = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      throw new AppError("CONFLICT", "An account with this email already exists");
    }

    const passwordHash = await hashPassword(input.password);

    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          name: input.name.trim(),
          phone: input.phone ?? null,
          passwordHash,
        })
        .returning();
      if (!user) throw new AppError("INTERNAL", "Could not create the account");

      const slug = await this.uniqueSlug(slugify(input.businessName));
      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: input.businessName.trim(),
          slug,
        })
        .returning();
      if (!tenant) throw new AppError("INTERNAL", "Could not create the business");

      await tx.insert(memberships).values({
        userId: user.id,
        tenantId: tenant.id,
        role: "owner",
        status: "active",
      });
      await tx.insert(tenantSettings).values({ tenantId: tenant.id });
      return { user, tenant };
    });

    return this.issueSession(result.user, result.tenant.id, "owner", meta);
  }

  private async uniqueSlug(base: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const hit = await this.db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, candidate))
        .limit(1);
      if (hit.length === 0) return candidate;
    }
    return `${base}-${randomToken(4)}`;
  }

  async login(
    email: string,
    password: string,
    meta: RequestMeta = {},
    tenantId?: string,
  ): Promise<LoginResult> {
    const normalised = email.toLowerCase().trim();
    const [user] = await this.db.select().from(users).where(eq(users.email, normalised)).limit(1);

    // Always run a hash comparison so timing does not reveal account existence.
    const hash =
      user?.passwordHash ?? "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA==";
    const ok = await verifyPassword(password, hash);
    if (!user || !ok) throw new AppError("UNAUTHENTICATED", "Email or password is incorrect");

    const memberRows = await this.listMemberships(user.id);
    if (memberRows.length === 0) {
      throw new AppError("FORBIDDEN", "This account is not linked to any business");
    }
    const chosen = tenantId ? memberRows.find((m) => m.id === tenantId) : memberRows[0];
    if (!chosen) throw new AppError("FORBIDDEN", "You do not have access to that business");

    if (needsRehash(user.passwordHash)) {
      const upgraded = await hashPassword(password);
      await this.db
        .update(users)
        .set({ passwordHash: upgraded, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    return this.issueSession(user, chosen.id, chosen.role, meta);
  }

  /** Businesses this account can switch into. */
  async listTenants(userId: string) {
    return this.listMemberships(userId);
  }

  private async listMemberships(userId: string) {
    const rows = await this.db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        role: memberships.role,
        status: memberships.status,
        tenantStatus: tenants.status,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
    return rows
      .filter((r) => r.tenantStatus === "active")
      .map((r) => ({ id: r.id, name: r.name, slug: r.slug, role: r.role as Role }));
  }

  private async issueSession(
    user: { id: string; email: string; name: string },
    tenantId: string,
    role: Role,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.options.sessionTtlDays * 86_400_000);
    await this.db.insert(sessions).values({
      tokenHash: sha256(token),
      userId: user.id,
      tenantId,
      role,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt,
    });
    const tenantList = await this.listMemberships(user.id);
    const tenant = tenantList.find((t) => t.id === tenantId);
    return {
      token,
      expiresAt,
      user: {
        userId: user.id,
        email: user.email,
        name: user.name,
        tenantId,
        tenantName: tenant?.name ?? "",
        role,
        permissions: [...(ROLE_PERMISSIONS[role] ?? [])],
      },
      tenants: tenantList,
    };
  }

  /** Resolve a bearer token to an auth context; also refreshes last-seen. */
  async resolveSession(token: string, meta: RequestMeta = {}): Promise<AuthContext | null> {
    const tokenHash = sha256(token);
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        tenantId: sessions.tenantId,
        role: sessions.role,
        activeGstinId: sessions.activeGstinId,
        email: users.email,
        name: users.name,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, new Date()),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);
    if (!row) return null;

    // Cheap heartbeat; avoids a write on every single request.
    void this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(sessions.id, row.sessionId),
          sql`${sessions.lastSeenAt} < now() - interval '5 minutes'`,
        ),
      )
      .catch(() => undefined);

    return {
      userId: row.userId,
      email: row.email,
      name: row.name,
      tenantId: row.tenantId,
      role: row.role as Role,
      actor: "session",
      sessionId: row.sessionId,
      // Without this the session's chosen registration never reaches any
      // query, and every GSTIN filter silently does nothing.
      activeGstinId: row.activeGstinId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
  }

  /** Resolve an `Authorization: Bearer txk_...` API key. */
  async resolveApiKey(rawKey: string, meta: RequestMeta = {}): Promise<AuthContext | null> {
    const keyHash = sha256(rawKey);
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    void this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined);

    return {
      userId: row.createdByUserId ?? "00000000-0000-0000-0000-000000000000",
      email: `apikey:${row.prefix}`,
      name: row.name,
      tenantId: row.tenantId,
      role: row.role as Role,
      actor: "api_key",
      apiKeyId: row.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
  }

  async logout(token: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, sha256(token)));
  }

  async logoutAll(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  /** Move an existing session to another business the user belongs to. */
  async switchTenant(ctx: AuthContext, tenantId: string): Promise<SessionUser> {
    const available = await this.listMemberships(ctx.userId);
    const target = available.find((t) => t.id === tenantId);
    if (!target) throw new AppError("FORBIDDEN", "You do not have access to that business");
    if (ctx.sessionId) {
      await this.db
        .update(sessions)
        .set({ tenantId: target.id, role: target.role })
        .where(eq(sessions.id, ctx.sessionId));
    }
    return {
      userId: ctx.userId,
      email: ctx.email,
      name: ctx.name,
      tenantId: target.id,
      tenantName: target.name,
      role: target.role,
      permissions: [...(ROLE_PERMISSIONS[target.role] ?? [])],
    };
  }

  /**
   * Choose which registration the session works in.
   *
   * Verified against the tenant's own registrations, so a crafted id cannot
   * point the session at another business's books.
   */
  async setActiveGstin(ctx: AuthContext, gstinId: string | null): Promise<void> {
    // Ownership first: a caller without a session must still be told the
    // registration is not theirs, rather than quietly doing nothing.
    if (gstinId) {
      const [owned] = await this.db
        .select({ id: gstins.id })
        .from(gstins)
        .where(and(eq(gstins.id, gstinId), eq(gstins.tenantId, ctx.tenantId)))
        .limit(1);
      if (!owned) throw new AppError("NOT_FOUND", "That GSTIN registration was not found");
    }
    if (!ctx.sessionId) return;
    await this.db
      .update(sessions)
      .set({ activeGstinId: gstinId })
      .where(eq(sessions.id, ctx.sessionId));
  }

  async changePassword(ctx: AuthContext, current: string, next: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
    if (!user) throw new AppError("NOT_FOUND", "Account not found");
    if (!(await verifyPassword(current, user.passwordHash))) {
      throw new AppError("UNAUTHENTICATED", "Current password is incorrect");
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));
    await this.logoutAll(ctx.userId);
  }

  /** Add a teammate to the caller's business, creating the account if needed. */
  async inviteUser(
    ctx: AuthContext,
    input: {
      email: string;
      name: string;
      role: Role;
    },
  ): Promise<{ userId: string; temporaryPassword?: string }> {
    const email = input.email.toLowerCase().trim();
    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    let userId = existing?.id;
    let temporaryPassword: string | undefined;
    if (!existing) {
      temporaryPassword = randomToken(9);
      const [created] = await this.db
        .insert(users)
        .values({
          email,
          name: input.name.trim(),
          passwordHash: await hashPassword(temporaryPassword),
        })
        .returning();
      userId = created?.id;
    }
    if (!userId) throw new AppError("INTERNAL", "Could not create the teammate account");

    const [already] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, ctx.tenantId)))
      .limit(1);
    if (already) throw new AppError("CONFLICT", "This person is already on your team");

    await this.db.insert(memberships).values({
      userId,
      tenantId: ctx.tenantId,
      role: input.role,
      status: "active",
      invitedByUserId: ctx.userId,
    });
    return temporaryPassword ? { userId, temporaryPassword } : { userId };
  }

  async listTeam(ctx: AuthContext) {
    return this.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        role: memberships.role,
        status: memberships.status,
        lastLoginAt: users.lastLoginAt,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, ctx.tenantId));
  }

  async updateMemberRole(ctx: AuthContext, userId: string, role: Role): Promise<void> {
    if (userId === ctx.userId) {
      throw new AppError("VALIDATION_FAILED", "You cannot change your own role");
    }
    await this.db
      .update(memberships)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, ctx.tenantId)));
  }

  async removeMember(ctx: AuthContext, userId: string): Promise<void> {
    if (userId === ctx.userId) {
      throw new AppError("VALIDATION_FAILED", "You cannot remove yourself");
    }
    await this.db
      .update(memberships)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, ctx.tenantId)));
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), eq(sessions.tenantId, ctx.tenantId)));
  }

  /** Issue a machine key. The plaintext is returned exactly once. */
  async createApiKey(
    ctx: AuthContext,
    input: {
      name: string;
      role: Role;
      expiresAt?: Date | undefined;
    },
  ): Promise<{ id: string; key: string; prefix: string }> {
    const secret = randomToken(24);
    const prefix = `txk_${randomToken(4).slice(0, 6)}`;
    const key = `${prefix}.${secret}`;
    const [row] = await this.db
      .insert(apiKeys)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        prefix,
        keyHash: sha256(key),
        role: input.role,
        expiresAt: input.expiresAt ?? null,
        createdByUserId: ctx.userId,
      })
      .returning();
    if (!row) throw new AppError("INTERNAL", "Could not create the API key");
    return { id: row.id, key, prefix };
  }

  async listApiKeys(ctx: AuthContext) {
    return this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        role: apiKeys.role,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, ctx.tenantId));
  }

  async revokeApiKey(ctx: AuthContext, id: string): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, ctx.tenantId)));
  }

  /* --------------------------- Password reset -------------------------- */

  /**
   * Begin a password reset.
   *
   * Always reports success, whether or not the account exists — telling an
   * anonymous caller which email addresses are registered is an account
   * enumeration hole. The token is returned to the caller only so the API can
   * hand it to the mailer; it is never put in an HTTP response.
   */
  async requestPasswordReset(
    email: string,
    meta: RequestMeta = {},
  ): Promise<{ token: string; user: { id: string; name: string; email: string } } | null> {
    const [user] = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);
    if (!user) return null;

    // Any earlier outstanding request is invalidated, so a stolen old link
    // cannot be used after the user asks again.
    await this.db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));

    const token = randomToken(32);
    await this.db.insert(passwordResets).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      requestedIp: meta.ip ?? null,
    });

    return { token, user };
  }

  /** Complete a reset. The token is single-use and every session is dropped. */
  async completePasswordReset(token: string, newPassword: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, sha256(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) {
      throw new AppError("UNAUTHENTICATED", "This reset link has expired or has already been used");
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
        .where(eq(users.id, row.userId));
      await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.id, row.id));
      // Anyone holding a session for this account loses it.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
    });
  }

  /** Housekeeping: drop expired and long-revoked sessions. */
  async purgeExpiredSessions(): Promise<number> {
    const result = await this.database.client`
      DELETE FROM sessions
      WHERE expires_at < now() - interval '30 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
    `;
    return result.count ?? 0;
  }
}
