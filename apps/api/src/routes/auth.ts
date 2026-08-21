import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  changePasswordSchema,
  inviteUserSchema,
  loginSchema,
  registerSchema,
  switchTenantSchema,
} from "@ewayvo/shared/contracts";
import { ROLE_PERMISSIONS, ROLES, AppError } from "@ewayvo/shared";
import { EMAIL_TEMPLATES } from "@ewayvo/core";
import { requireAuth } from "../context.js";
import { SESSION_COOKIE } from "../plugins/auth.js";

/** Session cookie: httpOnly so no script can read it, SameSite=Lax for CSRF. */
function sessionCookie(token: string, expiresAt: Date, secure: boolean, domain?: string): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function clearCookie(secure: boolean, domain?: string): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

/**
 * Credential endpoints get their own budget, far below the global one.
 *
 * The global limit is per tenant once authenticated and per IP before that,
 * which left sign-in open to hundreds of guesses a minute. This keys strictly
 * on the client address so one attacker cannot spend another tenant's budget,
 * and counts successful requests too — a burst is suspicious either way.
 */
function credentialRateLimit(max: number) {
  return {
    config: {
      rateLimit: {
        max,
        timeWindow: "5 minutes",
        keyGenerator: (request: FastifyRequest) => `auth:${request.ip}`,
        // The 429 body is shaped by the global error handler, so every error
        // the API returns keeps the same envelope.
      },
    },
  } as const;
}

export async function authRoutes(
  app: FastifyInstance,
  options: { authRateLimitMax?: number } = {},
): Promise<void> {
  const CREDENTIAL_RATE_LIMIT = credentialRateLimit(options.authRateLimitMax ?? 10);

  app.post("/register", CREDENTIAL_RATE_LIMIT, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const { config, auth } = request.container;
    const result = await auth.register(input, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.header(
      "set-cookie",
      sessionCookie(result.token, result.expiresAt, config.cookieSecure, config.COOKIE_DOMAIN),
    );
    return reply.status(201).send({
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
      tenants: result.tenants,
    });
  });

  app.post("/login", CREDENTIAL_RATE_LIMIT, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const { config, auth } = request.container;
    const result = await auth.login(input.email, input.password, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.header(
      "set-cookie",
      sessionCookie(result.token, result.expiresAt, config.cookieSecure, config.COOKIE_DOMAIN),
    );
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
      tenants: result.tenants,
    };
  });

  app.post("/logout", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) await request.container.auth.logout(token);
    const { config } = request.container;
    reply.header("set-cookie", clearCookie(config.cookieSecure, config.COOKIE_DOMAIN));
    return { ok: true };
  });

  /** Who am I — the call the web app makes on boot. */
  app.get("/me", async (request) => {
    const ctx = requireAuth(request);
    const [gstinList, teams] = await Promise.all([
      request.container.masters.listGstins(ctx),
      request.container.auth.listTenants(ctx.userId),
    ]);
    return {
      user: {
        userId: ctx.userId,
        email: ctx.email,
        name: ctx.name,
        tenantId: ctx.tenantId,
        role: ctx.role,
        permissions: ROLE_PERMISSIONS[ctx.role] ?? [],
        activeGstinId: ctx.activeGstinId ?? null,
      },
      // The switcher needs both lists on boot; two extra indexed reads.
      gstins: gstinList.map((g) => ({
        id: g.id,
        gstin: g.gstin,
        tradeName: g.tradeName,
        stateCode: g.stateCode,
        isPrimary: g.isPrimary,
        isActive: g.isActive,
      })),
      tenants: teams,
    };
  });

  /**
   * Choose the registration to work in.
   *
   * Stored on the session so every subsequent request is scoped the same way,
   * including one posted from a tab the user left open.
   */
  app.post("/active-gstin", async (request) => {
    const ctx = requireAuth(request);
    const { gstinId } = z.object({ gstinId: z.string().uuid().nullable() }).parse(request.body);
    await request.container.auth.setActiveGstin(ctx, gstinId);
    return { activeGstinId: gstinId };
  });

  app.post("/switch-tenant", async (request) => {
    const ctx = requireAuth(request);
    const { tenantId } = switchTenantSchema.parse(request.body);
    return { user: await request.container.auth.switchTenant(ctx, tenantId) };
  });

  app.post("/change-password", CREDENTIAL_RATE_LIMIT, async (request) => {
    const ctx = requireAuth(request);
    const input = changePasswordSchema.parse(request.body);
    await request.container.auth.changePassword(ctx, input.currentPassword, input.newPassword);
    return { ok: true };
  });

  /* -------------------------- Password reset --------------------------- */

  /**
   * Always answers the same way, whether or not the account exists — telling
   * an anonymous caller which addresses are registered is an enumeration hole.
   */
  app.post("/forgot-password", CREDENTIAL_RATE_LIMIT, async (request) => {
    const { email } = z
      .object({ email: z.string().trim().toLowerCase().email() })
      .parse(request.body);
    const { auth, mailer, config, logger } = request.container;

    const reset = await auth.requestPasswordReset(email, { ip: request.ip });
    if (reset) {
      const message = EMAIL_TEMPLATES.passwordReset({
        name: reset.user.name,
        resetUrl: `${config.APP_URL}/reset-password?token=${reset.token}`,
        expiresInMinutes: 60,
      });
      const delivery = await mailer.send({ ...message, to: reset.user.email });
      if (!delivery.delivered) {
        // Visible to the operator, never to the caller.
        logger.warn(
          { userId: reset.user.id, reason: delivery.reason },
          "password reset email could not be delivered",
        );
      }
    }
    return {
      ok: true,
      message: "If that email is registered, a reset link is on its way.",
      // So the UI can warn an operator during setup that nothing was sent.
      emailConfigured: request.container.mailer.deliverable,
    };
  });

  app.post("/reset-password", CREDENTIAL_RATE_LIMIT, async (request) => {
    const { token, password } = z
      .object({
        token: z.string().min(10),
        password: z
          .string()
          .min(10, "Use at least 10 characters")
          .max(200)
          .regex(/[a-z]/, "Add a lowercase letter")
          .regex(/[A-Z]/, "Add an uppercase letter")
          .regex(/[0-9]/, "Add a number"),
      })
      .parse(request.body);
    await request.container.auth.completePasswordReset(token, password);
    return { ok: true };
  });

  /* ------------------------------- Team -------------------------------- */

  app.get("/team", async (request) => {
    const ctx = requireAuth(request);
    return { items: await request.container.auth.listTeam(ctx) };
  });

  app.post("/team", async (request, reply) => {
    const ctx = requireAuth(request);
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new AppError("FORBIDDEN", "Only owners and admins can invite teammates");
    }
    const input = inviteUserSchema.parse(request.body);
    return reply.status(201).send(await request.container.auth.inviteUser(ctx, input));
  });

  app.patch("/team/:userId", async (request) => {
    const ctx = requireAuth(request);
    if (ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner can change roles");
    const { userId } = request.params as { userId: string };
    const body = request.body as { role?: string };
    const role = ROLES.find((r) => r === body.role);
    if (!role) throw new AppError("VALIDATION_FAILED", "Unknown role");
    await request.container.auth.updateMemberRole(ctx, userId, role);
    return { ok: true };
  });

  app.delete("/team/:userId", async (request) => {
    const ctx = requireAuth(request);
    if (ctx.role !== "owner")
      throw new AppError("FORBIDDEN", "Only the owner can remove teammates");
    const { userId } = request.params as { userId: string };
    await request.container.auth.removeMember(ctx, userId);
    return { ok: true };
  });

  /* ----------------------------- API keys ------------------------------ */

  app.get("/api-keys", async (request) => {
    const ctx = requireAuth(request);
    return { items: await request.container.auth.listApiKeys(ctx) };
  });

  app.post("/api-keys", async (request, reply) => {
    const ctx = requireAuth(request);
    if (ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner can issue API keys");
    const body = request.body as { name?: string; role?: string; expiresAt?: string };
    if (!body.name?.trim()) throw new AppError("VALIDATION_FAILED", "Give the key a name");
    const role = ROLES.find((r) => r === body.role) ?? "member";
    const created = await request.container.auth.createApiKey(ctx, {
      name: body.name.trim(),
      role,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    // The plaintext key is shown once and never stored.
    return reply.status(201).send(created);
  });

  app.delete("/api-keys/:id", async (request) => {
    const ctx = requireAuth(request);
    if (ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner can revoke API keys");
    const { id } = request.params as { id: string };
    await request.container.auth.revokeApiKey(ctx, id);
    return { ok: true };
  });
}
