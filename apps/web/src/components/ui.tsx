import { type ReactNode, useEffect, useRef, useState } from "react";
import { describeError } from "../lib/errors.js";
import { notify } from "../lib/toast.js";

/** Small, unopinionated primitives. Anything reused three times lands here. */

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The one way failures are shown.
 *
 * Every screen renders this rather than its own `{error.message}`, so a user
 * never sees a raw code, and every failure that we caused carries a reference
 * they can quote to support.
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const described = describeError(error);
  if (!described) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{described.title}</p>
          {described.detail && <p className="mt-0.5 text-red-700">{described.detail}</p>}
          {described.reference && (
            <p className="mt-1 font-mono text-[11px] text-red-600/80">
              Reference {described.reference}
            </p>
          )}
        </div>
        {onRetry && described.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/** Full-panel failure, for when a page has nothing else to show. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const described = describeError(error) ?? {
    title: "Something went wrong",
    retryable: true as const,
  };
  return (
    <div className="grid place-items-center px-6 py-20 text-center">
      <div className="max-w-sm">
        <p className="text-base font-medium">{described.title}</p>
        {described.detail && <p className="mt-1 text-sm text-muted">{described.detail}</p>}
        {described.reference && (
          <p className="mt-2 font-mono text-[11px] text-muted">Reference {described.reference}</p>
        )}
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-secondary mt-4">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

/** Slide-over panel. Used for every create/edit form so the list stays visible. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-[1px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex h-full w-full flex-col bg-white shadow-2xl
          ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-2 px-2"
            aria-label="Close"
          >
            <svg className="size-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Centre modal, for confirmations and short forms. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/25" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-t-2xl bg-white shadow-2xl sm:rounded-xl"
      >
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** Debounced search box; the value only propagates once typing pauses. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocal(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.08 3.08a1 1 0 01-1.42 1.42l-3.08-3.08A7 7 0 012 9z"
          clipRule="evenodd"
        />
      </svg>
      <input
        type="search"
        className="field pl-9"
        placeholder={placeholder}
        value={local}
        autoFocus={autoFocus}
        onChange={(event) => {
          const next = event.target.value;
          setLocal(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(next), 250);
        }}
      />
    </div>
  );
}

/**
 * Transient confirmation, e.g. after copying an IRN.
 *
 * Kept as a hook for the call sites that already use it, but the message now
 * goes to the single global Toaster so confirmations and failures stack in one
 * place instead of fighting for the same corner of the screen.
 */
export function useToast() {
  return { toast: null, show: notify };
}
