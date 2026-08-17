import { useSession } from "../../api/hooks.js";
import { post } from "../../api/client.js";
import { DrawerForm, SettingsSection } from "../../components/forms.js";
import { Field } from "../../components/ui.js";
import { field } from "../../lib/format.js";
import { useMutation } from "@tanstack/react-query";

/**
 * Account security.
 *
 * Deliberately short. The things that actually protect an account here are
 * the password and knowing which sessions are live; anything else would be
 * settings theatre.
 */
export function SecuritySettings({ show }: { show: (message: string) => void }) {
  const session = useSession();

  const changePassword = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      post("/v1/auth/change-password", input),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <SettingsSection title="Password" description="Changing it signs out every other device.">
        <div className="p-4">
          <DrawerForm
            submitLabel="Change password"
            pending={changePassword.isPending}
            error={changePassword.error}
            onSubmit={(form) => {
              const next = field(form, "newPassword");
              if (next !== field(form, "confirmPassword")) {
                // Caught here so the user is not told by a server round trip.
                show("The two new passwords do not match");
                return;
              }
              changePassword.mutate(
                { currentPassword: field(form, "currentPassword"), newPassword: next },
                { onSuccess: () => show("Password changed — sign in again on your other devices") },
              );
            }}
          >
            <Field label="Current password" required>
              <input
                name="currentPassword"
                type="password"
                className="field"
                required
                autoComplete="current-password"
              />
            </Field>
            <Field
              label="New password"
              required
              hint="At least 10 characters, with an uppercase letter and a number."
            >
              <input
                name="newPassword"
                type="password"
                className="field"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm new password" required>
              <input
                name="confirmPassword"
                type="password"
                className="field"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </Field>
          </DrawerForm>
        </div>
      </SettingsSection>

      <SettingsSection title="This account">
        <dl className="divide-y divide-line text-sm">
          <Row label="Signed in as" value={session.data?.user.email ?? "—"} />
          <Row label="Role" value={session.data?.user.role ?? "—"} />
          <Row
            label="Businesses"
            value={`${session.data?.tenants.length ?? 0} you can switch between`}
          />
        </dl>
      </SettingsSection>

      <SettingsSection
        title="How your data is protected"
        description="What the system does whether or not you configure anything."
      >
        <ul className="space-y-2.5 px-4 py-4 text-sm text-muted">
          <li>Sessions are held in a cookie scripts cannot read, and only a hash is stored.</li>
          <li>Passwords are hashed with scrypt; nobody can read them, including us.</li>
          <li>
            GST API credentials are encrypted before they reach the database and are never returned
            by the API.
          </li>
          <li>Every business's data is separated at the query layer and again in the database.</li>
          <li>Repeated sign-in attempts from one address are rate limited.</li>
        </ul>
      </SettingsSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
