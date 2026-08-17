import { dismissToast, useToasts } from "../lib/toast.js";

/**
 * Renders whatever the toast store is holding.
 *
 * Bottom-centre so it never covers the action rail on the right, and errors
 * stay twice as long as confirmations because there is something to read.
 */
export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg ${
            toast.tone === "error" ? "bg-red-600 text-white" : "bg-ink text-white"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{toast.title}</p>
            {toast.detail && <p className="mt-0.5 text-white/80">{toast.detail}</p>}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
            className="-mr-1 shrink-0 rounded px-1.5 text-white/70 hover:text-white"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
