import type { FastifyInstance } from "fastify";
import {
  changePasswordSchema, inviteUserSchema, loginSchema, registerSchema, switchTenantSchema,
} from "@traxac/shared/contracts";
import { ROLE_PERMISSIONS, ROLES, AppError } from "@traxac/shared";
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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const { config, auth } = request.container;
    const result = await auth.register(input, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.header("set-cookie", sessionCookie(
      result.token, result.expiresAt, config.COOKIE_SECURE, config.COOKIE_DOMAIN,
    ));
    return reply.status(201).send({
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
      tenants: result.tenants,
    });
  });

  app.post("/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const { config, auth } = request.container;
    const result = await auth.login(input.email, input.password, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    reply.header("set-cookie", sessionCookie(
      result.token, result.expiresAt, config.COOKIE_SECURE, config.COOKIE_DOMAIN,
    ));
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
    reply.header("set-cookie", clearCookie(config.COOKIE_SECURE, config.COOKIE_DOMAIN));
    return { ok: true };
  });

  /** Who am I — the call the web app makes on boot. */
  app.get("/me", async (request) => {
    const ctx = requireAuth(request);
    return {
      user: {
        userId: ctx.userId,
        email: ctx.email,
        name: ctx.name,
        tenantId: ctx.tenantId,
        role: ctx.role,
        permissions: ROLE_PERMISSIONS[ctx.role] ?? [],
      },
    };
  });

  app.post("/switch-tenant", async (request) => {
    const ctx = requireAuth(request);
    const { tenantId } = switchTenantSchema.parse(request.body);
    return { user: await request.container.auth.switchTenant(ctx, tenantId) };
  });

  app.post("/change-password", async (request) => {
    const ctx = requireAuth(request);
    const input = changePasswordSchema.parse(request.body);
    await request.container.auth.changePassword(ctx, input.currentPassword, input.newPassword);
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
    if (ctx.role !== "owner") throw new AppError("FORBIDDEN", "Only the owner can remove teammates");
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
