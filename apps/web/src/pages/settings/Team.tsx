import { useState } from "react";
import { ROLES } from "@traxac/shared";
import {
  useApiKeys,
  useCreateApiKey,
  useInviteUser,
  useRemoveMember,
  useRevokeApiKey,
  useSession,
  useTeam,
  useUpdateMemberRole,
} from "../../api/hooks.js";
import { DrawerForm, SettingsList, SettingsSection, useConfirm } from "../../components/forms.js";
import { Pill } from "../../components/status.js";
import { Drawer, Field } from "../../components/ui.js";
import { field, formatDateTime, initials } from "../../lib/format.js";

/**
 * People and machine access.
 *
 * Roles are described by what they let someone do, not by their name — "can
 * bill and record payments" is checkable, "member" is not.
 */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Everything, including billing settings, users and API keys",
  admin: "Everything except users and API keys",
  member: "Create and issue invoices, manage customers and items",
  viewer: "Read only — can see invoices and reports, cannot change anything",
};

export function TeamSettings({ show }: { show: (message: string) => void }) {
  const session = useSession();
  const team = useTeam();
  const invite = useInviteUser();
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const apiKeys = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const { confirm, dialog } = useConfirm();

  const [inviting, setInviting] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(null);
  const [temporary, setTemporary] = useState<{ email: string; password: string } | null>(null);

  const isOwner = session.data?.user.role === "owner";
  const currentUserId = session.data?.user.userId;

  return (
    <div className="max-w-3xl space-y-4">
      <SettingsSection
        title="People"
        description="Everyone who can sign in to this business."
        action={
          isOwner || session.data?.user.role === "admin" ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setInviting(true)}
            >
              Add person
            </button>
          ) : undefined
        }
      >
        <SettingsList
          items={team.data?.items}
          loading={team.isLoading}
          error={team.error}
          keyOf={(m) => m.userId}
          empty={{ title: "Just you so far" }}
          renderItem={(member) => (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {initials(member.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {member.name}
                  {member.userId === currentUserId && (
                    <span className="ml-2 text-xs text-muted">you</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted">{member.email}</p>
                <p className="text-xs text-slate-400">
                  {member.lastLoginAt
                    ? `Last signed in ${formatDateTime(member.lastLoginAt)}`
                    : "Has not signed in yet"}
                </p>
              </div>
              {member.status !== "active" && <Pill>Disabled</Pill>}
              {isOwner && member.userId !== currentUserId ? (
                <select
                  className="field w-auto text-xs"
                  value={member.role}
                  onChange={(event) =>
                    updateRole.mutate(
                      { userId: member.userId, role: event.target.value },
                      { onSuccess: () => show("Role updated") },
                    )
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              ) : (
                <Pill tone={member.role === "owner" ? "good" : "neutral"}>{member.role}</Pill>
              )}
              {isOwner && member.userId !== currentUserId && (
                <button
                  type="button"
                  className="btn-ghost px-2 text-muted hover:text-red-600"
                  aria-label={`Remove ${member.name}`}
                  onClick={() =>
                    confirm(
                      `Remove ${member.name}? They will be signed out immediately and lose access to this business.`,
                      () =>
                        remove.mutate(member.userId, { onSuccess: () => show("Access removed") }),
                    )
                  }
                >
                  ×
                </button>
              )}
            </div>
          )}
        />
      </SettingsSection>

      <SettingsSection
        title="What each role can do"
        description="Roles apply to this business only."
      >
        <ul className="divide-y divide-line">
          {ROLES.map((role) => (
            <li key={role} className="flex gap-3 px-4 py-2.5">
              <span className="w-16 text-sm font-medium capitalize">{role}</span>
              <span className="flex-1 text-xs text-muted">{ROLE_DESCRIPTIONS[role]}</span>
            </li>
          ))}
        </ul>
      </SettingsSection>

      {isOwner && (
        <SettingsSection
          title="API keys"
          description="For connecting another system. Treat a key like a password."
          action={
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setCreatingKey(true)}
            >
              Create key
            </button>
          }
        >
          <SettingsList
            items={apiKeys.data?.items}
            loading={apiKeys.isLoading}
            error={apiKeys.error}
            keyOf={(k) => k.id}
            empty={{
              title: "No API keys",
              description: "Only needed if another system will call Traxac directly.",
            }}
            renderItem={(key) => (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{key.name}</p>
                  <p className="font-mono text-xs text-muted">{key.prefix}…</p>
                  <p className="text-xs text-slate-400">
                    {key.lastUsedAt ? `Last used ${formatDateTime(key.lastUsedAt)}` : "Never used"}
                  </p>
                </div>
                <Pill tone={key.revokedAt ? "bad" : "neutral"}>
                  {key.revokedAt ? "Revoked" : key.role}
                </Pill>
                {!key.revokedAt && (
                  <button
                    type="button"
                    className="btn-ghost px-2 text-muted hover:text-red-600"
                    aria-label={`Revoke ${key.name}`}
                    onClick={() =>
                      confirm(
                        `Revoke "${key.name}"? Anything using this key stops working immediately.`,
                        () => revokeKey.mutate(key.id, { onSuccess: () => show("Key revoked") }),
                      )
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          />
        </SettingsSection>
      )}

      <Drawer
        open={inviting}
        onClose={() => setInviting(false)}
        title="Add a person"
        description="They will be able to sign in to this business with the role you choose."
      >
        <DrawerForm
          submitLabel="Add person"
          pending={invite.isPending}
          error={invite.error}
          onSubmit={(form) =>
            invite.mutate(
              {
                name: field(form, "name"),
                email: field(form, "email"),
                role: field(form, "role"),
              },
              {
                onSuccess: (result) => {
                  setInviting(false);
                  if (result.temporaryPassword) {
                    setTemporary({
                      email: field(form, "email"),
                      password: result.temporaryPassword,
                    });
                  } else {
                    show("Added to the team");
                  }
                },
              },
            )
          }
        >
          <Field label="Name" required>
            <input name="name" className="field" required />
          </Field>
          <Field label="Email" required>
            <input name="email" type="email" className="field" required />
          </Field>
          <Field label="Role" required>
            <select name="role" className="field" defaultValue="member">
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role} — {ROLE_DESCRIPTIONS[role]}
                </option>
              ))}
            </select>
          </Field>
        </DrawerForm>
      </Drawer>

      {/* A temporary password is shown once and never stored in the clear. */}
      <Drawer
        open={temporary !== null}
        onClose={() => {
          setTemporary(null);
          show("Added to the team");
        }}
        title="Share this one-time password"
        description="It is shown once. They should change it after signing in."
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Email delivery is not configured yet, so pass this on yourself — in person or over a
            channel you trust.
          </div>
          <Field label="Email">
            <input className="field" readOnly value={temporary?.email ?? ""} />
          </Field>
          <Field label="Temporary password">
            <input className="field font-mono" readOnly value={temporary?.password ?? ""} />
          </Field>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(temporary?.password ?? "");
              show("Copied");
            }}
          >
            Copy password
          </button>
        </div>
      </Drawer>

      <Drawer open={creatingKey} onClose={() => setCreatingKey(false)} title="Create an API key">
        <DrawerForm
          submitLabel="Create key"
          pending={createKey.isPending}
          error={createKey.error}
          onSubmit={(form) =>
            createKey.mutate(
              { name: field(form, "name"), role: field(form, "role") },
              {
                onSuccess: (result) => {
                  setCreatingKey(false);
                  setIssued({ key: result.key, name: field(form, "name") });
                },
              },
            )
          }
        >
          <Field label="What is it for" required hint='For example "Tally sync".'>
            <input name="name" className="field" required />
          </Field>
          <Field label="Role" required hint="Give the least access the integration needs.">
            <select name="role" className="field" defaultValue="member">
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role} — {ROLE_DESCRIPTIONS[role]}
                </option>
              ))}
            </select>
          </Field>
        </DrawerForm>
      </Drawer>

      <Drawer
        open={issued !== null}
        onClose={() => {
          setIssued(null);
          show("API key created");
        }}
        title="Copy your API key now"
        description="This is the only time it is shown. Only a hash is kept."
      >
        <div className="space-y-3">
          <Field label={issued?.name ?? "Key"}>
            <textarea
              className="field min-h-20 font-mono text-xs"
              readOnly
              value={issued?.key ?? ""}
            />
          </Field>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(issued?.key ?? "");
              show("Copied");
            }}
          >
            Copy key
          </button>
        </div>
      </Drawer>

      {dialog}
    </div>
  );
}
