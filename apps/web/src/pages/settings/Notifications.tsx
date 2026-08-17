import {
  useMarkNotificationsRead,
  useNotifications,
  useSettings,
  useUpdateSettings,
} from "../../api/hooks.js";
import { SettingsList, SettingsSection, Toggle } from "../../components/forms.js";
import { formatDateTime } from "../../lib/format.js";
import { Link } from "react-router-dom";

/**
 * Alerts.
 *
 * Everything here is in-app. Email is behind an interface with no transport
 * configured, and the page says so plainly rather than offering a switch that
 * would do nothing.
 */
const ALERT_KINDS = [
  { kind: "einvoice.generate.failed", label: "An e-Invoice could not be generated" },
  { kind: "ewb.generate.failed", label: "An e-Way Bill could not be generated" },
  { kind: "ewb.expiring", label: "An e-Way Bill is close to expiring" },
  { kind: "invoice.overdue", label: "An invoice has passed its due date" },
  { kind: "payment.received", label: "A payment was recorded" },
  { kind: "user.invited", label: "Someone was added to the team" },
];

export function NotificationSettings({ show }: { show: (message: string) => void }) {
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const settings = useSettings();
  const update = useUpdateSettings();

  const unread = notifications.data?.unread ?? 0;

  return (
    <div className="max-w-3xl space-y-4">
      <SettingsSection
        title="Recent alerts"
        description={unread > 0 ? `${unread} unread` : "Nothing needs your attention."}
        action={
          unread > 0 ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() =>
                markRead.mutate(undefined, { onSuccess: () => show("Marked as read") })
              }
            >
              Mark all read
            </button>
          ) : undefined
        }
      >
        <SettingsList
          items={notifications.data?.items.slice(0, 20)}
          loading={notifications.isLoading}
          error={notifications.error}
          keyOf={(n) => n.id}
          empty={{
            title: "No alerts",
            description: "You will be told here when something needs looking at.",
          }}
          renderItem={(item) => (
            <div className={`flex gap-3 px-4 py-3 ${item.readAt ? "" : "bg-brand-50/40"}`}>
              <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                  item.severity === "error"
                    ? "bg-red-500"
                    : item.severity === "warning"
                      ? "bg-amber-500"
                      : "bg-blue-500"
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                {item.body && <p className="mt-0.5 text-sm text-muted">{item.body}</p>}
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(item.createdAt)}</p>
              </div>
              {item.entityType === "invoice" && item.entityId && (
                <Link
                  to={`/invoices/${item.entityId}`}
                  className="shrink-0 self-center text-xs text-brand-700 hover:underline"
                >
                  Open
                </Link>
              )}
            </div>
          )}
        />
      </SettingsSection>

      <SettingsSection
        title="What you get told about"
        description="These alerts are always on — they are the ones that cost money if missed."
      >
        <ul className="divide-y divide-line">
          {ALERT_KINDS.map((alert) => (
            <li key={alert.kind} className="px-4 py-2.5 text-sm">
              {alert.label}
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection title="Email" description="Not configured yet.">
        <div className="space-y-3 p-4">
          <div className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-muted">
            No email provider is connected, so alerts appear in the app only. Nothing is being sent
            and nothing is being silently dropped — messages that would have gone out are recorded
            in the server log.
          </div>
          <Toggle
            name="autoGenerateEinvoice"
            label="Send invoices to the IRP as soon as they are issued"
            hint="Applies when a GST connection is configured."
            defaultChecked={Boolean(settings.data?.settings?.["autoGenerateEinvoice"])}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              update.mutate(
                {
                  autoGenerateEinvoice: !settings.data?.settings?.["autoGenerateEinvoice"],
                },
                { onSuccess: () => show("Preference saved") },
              )
            }
          >
            Save preference
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}
