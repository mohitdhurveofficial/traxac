import { NavLink, useNavigate } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { useLogout, useMarkNotificationsRead, useNotifications } from "../api/hooks.js";
import { formatDateTime, initials } from "../lib/format.js";
import type { SessionResponse } from "../api/types.js";
import { GstinSwitcher } from "./gstin-switcher.js";
import { Drawer } from "./ui.js";

/**
 * Application shell.
 *
 * The brief asks for a minimal primary navigation, so there are four
 * destinations and one action. Everything else — settings, credentials,
 * transporters, team — lives behind Settings, because a trader touches those
 * once and then never again.
 */
/**
 * Mobile shows four destinations around the primary action; Overview is the
 * one that drops, because on a phone the invoice list is the overview.
 */
const NAV = [
  { to: "/overview", label: "Overview", icon: OverviewIcon },
  { to: "/invoices", label: "Invoices", icon: InvoiceIcon },
  { to: "/customers", label: "Customers", icon: CustomerIcon },
  { to: "/items", label: "Items", icon: ItemIcon },
  { to: "/reports", label: "Reports", icon: ReportIcon },
];

const MOBILE_NAV = NAV.filter((item) => item.to !== "/overview");

export function Shell({ session, children }: { session: SessionResponse; children: ReactNode }) {
  const user = session.user;
  const navigate = useNavigate();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const logout = useLogout();
  const unread = notifications.data?.unread ?? 0;

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="no-print hidden w-56 shrink-0 border-r border-line bg-white lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2 px-5">
          <Logo />
          <span className="text-sm font-semibold tracking-tight">Ewayvo</span>
        </div>

        {/* Which books am I in? Shown before the primary action, because
            billing from the wrong registration is expensive to unwind. */}
        <GstinSwitcher session={session} />

        <div className="mt-3 px-3">
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => navigate("/invoices/new")}
          >
            <PlusIcon /> New invoice
          </button>
        </div>

        <nav className="mt-4 flex-1 space-y-0.5 px-3">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              <item.icon />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-line p-3">
          <button
            type="button"
            onClick={() => setAlertsOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-slate-100 hover:text-ink"
          >
            <BellIcon />
            Alerts
            {unread > 0 && (
              <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {unread}
              </span>
            )}
          </button>
          <NavLink to="/activity" className={navClass}>
            <ActivityIcon />
            Activity
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            <SettingsIcon />
            Settings
          </NavLink>
        </div>

        <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{user.name}</p>
            <p className="truncate text-[11px] text-muted capitalize">{user.role}</p>
          </div>
          <button
            type="button"
            title="Sign out"
            aria-label="Sign out"
            onClick={() =>
              void logout.mutate(undefined, { onSuccess: () => void navigate("/login") })
            }
            className="btn-ghost px-1.5"
          >
            <LogoutIcon />
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <span className="text-sm font-semibold">Ewayvo</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAlertsOpen(true)}
            className="btn-ghost relative px-2"
            aria-label="Alerts"
          >
            <BellIcon />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500" />
            )}
          </button>
          <NavLink to="/settings" className="btn-ghost px-2" aria-label="Settings">
            <SettingsIcon />
          </NavLink>
        </div>
      </header>

      <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>

      {/* Mobile bottom navigation with the primary action in the middle */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 backdrop-blur lg:hidden">
        {MOBILE_NAV.slice(0, 2).map((item) => (
          <NavLink key={item.to} to={item.to} className={mobileNavClass}>
            <item.icon /> <span className="text-[10px]">{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => navigate("/invoices/new")}
          className="flex flex-col items-center justify-center gap-0.5 py-2"
          aria-label="New invoice"
        >
          <span className="grid size-9 place-items-center rounded-full bg-brand-600 text-white shadow-sm">
            <PlusIcon />
          </span>
        </button>
        {MOBILE_NAV.slice(2).map((item) => (
          <NavLink key={item.to} to={item.to} className={mobileNavClass}>
            <item.icon /> <span className="text-[10px]">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <Drawer
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        title="Alerts"
        description={unread > 0 ? `${unread} unread` : "You are all caught up"}
        footer={
          unread > 0 ? (
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => void markRead.mutate()}
            >
              Mark all as read
            </button>
          ) : undefined
        }
      >
        <ul className="space-y-2">
          {(notifications.data?.items ?? []).map((item) => (
            <li
              key={item.id}
              className={`rounded-lg border p-3 ${item.readAt ? "border-line bg-white" : "border-brand-100 bg-brand-50"}`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                    item.severity === "error"
                      ? "bg-red-500"
                      : item.severity === "warning"
                        ? "bg-amber-500"
                        : "bg-blue-500"
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.body && <p className="mt-0.5 text-sm text-muted">{item.body}</p>}
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(item.createdAt)}</p>
                  {item.entityType === "invoice" && item.entityId && (
                    <button
                      type="button"
                      className="mt-1.5 text-xs font-medium text-brand-700 hover:underline"
                      onClick={() => {
                        setAlertsOpen(false);
                        void navigate(`/invoices/${item.entityId}`);
                      }}
                    >
                      Open invoice →
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {(notifications.data?.items.length ?? 0) === 0 && (
            <p className="py-8 text-center text-sm text-muted">Nothing needs your attention.</p>
          )}
        </ul>
      </Drawer>
    </div>
  );
}

/** Page header used by every screen, so titles and actions line up. */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="no-print border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6">{children}</div>}
    </div>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">{children}</div>;
}

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
    isActive
      ? "bg-brand-50 font-medium text-brand-700"
      : "text-muted hover:bg-slate-100 hover:text-ink"
  }`;

const mobileNavClass = ({ isActive }: { isActive: boolean }): string =>
  `flex flex-col items-center justify-center gap-0.5 py-2 ${
    isActive ? "text-brand-700" : "text-muted"
  }`;

/* --------------------------------- icons -------------------------------- */

function Logo() {
  return (
    <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
      T
    </span>
  );
}

function PlusIcon() {
  return (
    <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" />
    </svg>
  );
}
function OverviewIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M3 3h6v6H3V3zm8 0h6v4h-6V3zM3 11h6v6H3v-6zm8 2h6v4h-6v-4z" />
    </svg>
  );
}
function InvoiceIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M4 3a2 2 0 012-2h8a2 2 0 012 2v14l-3-1.5L11 17l-2-1.5L7 17l-3-1.5V3zm3 3h6v1.5H7V6zm0 3.5h6V11H7V9.5zm0 3.5h4v1.5H7V13z"
        clipRule="evenodd"
      />
    </svg>
  );
}
function CustomerIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM3 17a7 7 0 1114 0H3z" />
    </svg>
  );
}
function ItemIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 1.5l7.5 4v9L10 18.5l-7.5-4v-9l7.5-4zm0 2.2L5.3 6.2 10 8.7l4.7-2.5L10 3.7zM4 8v5.3l5 2.7v-5.3L4 8zm7 8l5-2.7V8l-5 2.7V16z" />
    </svg>
  );
}
function ReportIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M3 16h14v2H3v-2zM5 9h2v5H5V9zm4-5h2v10H9V4zm4 3h2v7h-2V7z" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm.75 3.5v4.19l2.78 1.66-.77 1.29-3.51-2.1V5.5h1.5z" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M8.34 2.3a1 1 0 011-.8h1.32a1 1 0 011 .8l.2 1.03a6.4 6.4 0 011.36.79l.99-.35a1 1 0 011.2.44l.66 1.14a1 1 0 01-.2 1.25l-.79.68a6.5 6.5 0 010 1.58l.79.68a1 1 0 01.2 1.25l-.66 1.14a1 1 0 01-1.2.44l-.99-.35a6.4 6.4 0 01-1.36.79l-.2 1.03a1 1 0 01-1 .8H9.34a1 1 0 01-1-.8l-.2-1.03a6.4 6.4 0 01-1.36-.79l-.99.35a1 1 0 01-1.2-.44l-.66-1.14a1 1 0 01.2-1.25l.79-.68a6.5 6.5 0 010-1.58l-.79-.68a1 1 0 01-.2-1.25l.66-1.14a1 1 0 011.2-.44l.99.35a6.4 6.4 0 011.36-.79l.2-1.03zM10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg className="size-4.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10 2a5 5 0 00-5 5v3l-1.3 2.6A1 1 0 004.6 14h10.8a1 1 0 00.9-1.4L15 10V7a5 5 0 00-5-5zM8 16a2 2 0 104 0H8z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M11 3a1 1 0 100 2h2v10h-2a1 1 0 100 2h2a2 2 0 002-2V5a2 2 0 00-2-2h-2z" />
      <path d="M8.7 6.3a1 1 0 011.4 1.4L8.4 9.4H12a1 1 0 110 2H8.4l1.7 1.7a1 1 0 11-1.4 1.4l-3.4-3.4a1 1 0 010-1.4l3.4-3.4z" />
    </svg>
  );
}
