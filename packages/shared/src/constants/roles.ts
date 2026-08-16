/** Role-based access control. Roles are per-tenant, assigned via membership. */

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Permissions are `<resource>:<action>` strings. Keeping them explicit (rather
 * than inferring from the role at each call site) means a new role only
 * changes this table.
 */
export const PERMISSIONS = [
  "invoices:read", "invoices:write", "invoices:finalize", "invoices:cancel",
  "compliance:generate", "compliance:cancel",
  "parties:read", "parties:write",
  "products:read", "products:write",
  "logistics:read", "logistics:write",
  "documents:read", "documents:write",
  "reports:read",
  "settings:read", "settings:write",
  "credentials:read", "credentials:write",
  "users:read", "users:invite", "users:manage",
  "audit:read",
  "apikeys:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  "invoices:read", "parties:read", "products:read", "logistics:read",
  "documents:read", "reports:read", "settings:read",
];

const MEMBER: Permission[] = [
  ...READ_ONLY,
  "invoices:write", "invoices:finalize",
  "compliance:generate",
  "parties:write", "products:write", "logistics:write", "documents:write",
];

const ADMIN: Permission[] = [
  ...MEMBER,
  "invoices:cancel", "compliance:cancel",
  "settings:write", "credentials:read", "credentials:write",
  "users:read", "users:invite", "audit:read",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [...ADMIN, "users:manage", "apikeys:manage"],
  admin: ADMIN,
  member: MEMBER,
  viewer: READ_ONLY,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
