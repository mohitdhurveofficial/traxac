import { useState, type ReactNode } from "react";
import { ApiError } from "../api/client.js";
import { useIsOnline } from "./connection.js";
import { ErrorNote, Field, Spinner } from "./ui.js";

/**
 * Shared form and list furniture.
 *
 * Every settings and master-data screen is the same shape — a titled section,
 * a list with an empty state, a drawer form — so it lives here once. Screens
 * that each invent their own spacing are how an application starts feeling
 * like several applications.
 */

export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A list with a built-in empty state, so no screen forgets one. */
export function SettingsList<T>({
  items,
  loading,
  error,
  empty,
  renderItem,
  keyOf,
}: {
  items: T[] | undefined;
  loading?: boolean;
  error?: unknown;
  empty: { title: string; description?: string; action?: ReactNode };
  renderItem: (item: T) => ReactNode;
  keyOf: (item: T) => string;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center py-10 text-muted">
        <Spinner />
      </div>
    );
  }
  // A list that failed to load must say so; showing the empty state instead
  // would tell the user their data is gone.
  if (error) {
    return (
      <div className="p-4">
        <ErrorNote error={error} />
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium">{empty.title}</p>
        {empty.description && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{empty.description}</p>
        )}
        {empty.action && <div className="mt-4">{empty.action}</div>}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={keyOf(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}

/**
 * A form that owns its own pending and error state.
 *
 * Screens pass an async submit and get consistent behaviour: the button
 * disables, errors render in the same place, and a success closes the drawer.
 */
/**
 * Field-level problems only.
 *
 * Everything else is reported once by the global toast, so a single failure
 * never appears twice on the same screen.
 */
export function FormError({ error }: { error: unknown }) {
  return error instanceof ApiError && error.status === 422 ? <ErrorNote error={error} /> : null;
}

/**
 * The submit button every form uses.
 *
 * Carries the two states a form can be in that are not about the data: the
 * request is in flight, or it is queued because the browser is offline. The
 * second one matters — React Query holds paused mutations silently, and a
 * button that looks idle after a click reads as broken.
 */
export function SubmitButton({
  pending,
  children,
  className = "btn-primary w-full",
}: {
  pending?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const online = useIsOnline();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending && <Spinner />}
      {pending && !online ? "Waiting for connection…" : children}
    </button>
  );
}

export function DrawerForm({
  submitLabel,
  onSubmit,
  error,
  pending,
  children,
}: {
  submitLabel: string;
  onSubmit: (form: FormData) => void;
  error?: unknown;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      {children}
      <FormError error={error} />
      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </form>
  );
}

/** A labelled switch. Reads as a sentence rather than a bare checkbox. */
export function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 rounded border-line"
      />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Tabs that keep their selection in the URL, so a reload lands in place. */
export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: ReadonlyArray<{ key: string; label: string }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            active === tab.key ? "bg-ink text-white" : "bg-slate-100 text-muted hover:bg-slate-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Confirm before something irreversible. */
export function useConfirm() {
  const [pending, setPending] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const confirm = (message: string, onConfirm: () => void): void =>
    setPending({ message, onConfirm });

  const dialog = pending ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/25" onClick={() => setPending(null)} />
      <div className="relative w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
        <p className="text-sm">{pending.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => {
              pending.onConfirm();
              setPending(null);
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}

export { Field };
