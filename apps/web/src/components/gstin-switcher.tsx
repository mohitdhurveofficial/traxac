import { useEffect, useRef, useState } from "react";
import { useSetActiveGstin } from "../api/hooks.js";
import type { SessionResponse } from "../api/types.js";
import { Spinner } from "./ui.js";

/**
 * Which books am I working in?
 *
 * A business with several registrations keeps separate books per GSTIN, and
 * billing from the wrong one is a filing error that is painful to unwind. So
 * the active registration is shown permanently rather than hidden in
 * settings, and switching reloads everything — the choice lives on the
 * session, not in this component.
 *
 * With a single registration there is nothing to choose, so the control
 * collapses to a plain label and stops competing for attention.
 */
export function GstinSwitcher({ session }: { session: SessionResponse }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const setActive = useSetActiveGstin();

  const registrations = session.gstins.filter((g) => g.isActive);
  const active = registrations.find((g) => g.id === session.user.activeGstinId);

  useEffect(() => {
    const onClickAway = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  if (registrations.length === 0) {
    return <div className="px-3 py-2 text-xs text-muted">No GSTIN added yet</div>;
  }

  // One registration: state it, do not offer a choice that does not exist.
  if (registrations.length === 1) {
    const only = registrations[0]!;
    return (
      <div className="px-3 py-2">
        <p className="truncate text-xs font-medium">{only.tradeName}</p>
        <p className="truncate font-mono text-[10px] text-muted">{only.gstin}</p>
      </div>
    );
  }

  const label = active ? active.tradeName : "All registrations";
  const sublabel = active ? active.gstin : `${registrations.length} GSTINs`;

  return (
    <div ref={containerRef} className="relative px-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-2 text-left hover:bg-slate-50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-slate-300"}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block truncate font-mono text-[10px] text-muted">{sublabel}</span>
        </span>
        {setActive.isPending ? (
          <Spinner className="size-3" />
        ) : (
          <svg
            className="size-3.5 shrink-0 text-muted"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute inset-x-3 z-40 mt-1 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          {registrations.map((registration) => (
            <button
              key={registration.id}
              type="button"
              role="option"
              aria-selected={registration.id === session.user.activeGstinId}
              onClick={() => {
                setActive.mutate(registration.id);
                setOpen(false);
              }}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 ${
                registration.id === session.user.activeGstinId ? "bg-brand-50" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{registration.tradeName}</span>
                <span className="block truncate font-mono text-[10px] text-muted">
                  {registration.gstin}
                </span>
              </span>
              {registration.isPrimary && (
                <span className="mt-0.5 text-[9px] tracking-wide text-muted uppercase">Main</span>
              )}
            </button>
          ))}

          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              role="option"
              aria-selected={!session.user.activeGstinId}
              onClick={() => {
                setActive.mutate(null);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-xs ${
                session.user.activeGstinId
                  ? "text-muted hover:bg-slate-50"
                  : "bg-brand-50 font-medium"
              }`}
            >
              All registrations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A compact reminder of the active registration, for screens where billing
 * from the wrong one would be costly.
 */
export function ActiveGstinBadge({ session }: { session: SessionResponse }) {
  const active = session.gstins.find((g) => g.id === session.user.activeGstinId);
  if (!active || session.gstins.length < 2) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-muted">
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
      {active.tradeName}
      <span className="font-mono text-[10px]">{active.gstin}</span>
    </span>
  );
}
