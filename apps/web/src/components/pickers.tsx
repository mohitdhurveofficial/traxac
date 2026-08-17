import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Type-ahead picker.
 *
 * Repeat billing is the common case, so the fastest path is: type two letters,
 * press Enter. The list is keyboard-navigable and the "create new" row is
 * always the last option rather than a separate button.
 */
export interface PickerOption<T> {
  id: string;
  label: string;
  sublabel?: string;
  meta?: string;
  value: T;
}

export function Picker<T>({
  value,
  options,
  onSelect,
  onSearch,
  placeholder,
  onCreate,
  createLabel,
  loading,
  error,
  autoFocus,
}: {
  value: PickerOption<T> | null;
  options: PickerOption<T>[];
  onSelect: (option: PickerOption<T> | null) => void;
  onSearch: (term: string) => void;
  placeholder: string;
  onCreate?: (term: string) => void;
  createLabel?: string;
  loading?: boolean;
  error?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickAway = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  const rows = useMemo(() => {
    const list: Array<{ kind: "option"; option: PickerOption<T> } | { kind: "create" }> =
      options.map((option) => ({ kind: "option" as const, option }));
    if (onCreate && term.trim()) list.push({ kind: "create" });
    return list;
  }, [options, onCreate, term]);

  const commit = (index: number): void => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "create") {
      onCreate?.(term.trim());
    } else {
      onSelect(row.option);
      setTerm("");
    }
    setOpen(false);
  };

  if (value) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 ${
          error ? "border-red-300" : "border-line"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.label}</p>
          {value.sublabel && <p className="truncate text-xs text-muted">{value.sublabel}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setTerm("");
          }}
          className="btn-ghost -mr-1 px-1.5"
          aria-label="Change"
        >
          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className={`field ${error ? "border-red-300" : ""}`}
        placeholder={placeholder}
        value={term}
        autoFocus={autoFocus}
        onChange={(event) => {
          setTerm(event.target.value);
          onSearch(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((h) => Math.min(h + 1, rows.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            commit(highlight);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {loading && <p className="px-3 py-2 text-sm text-muted">Searching…</p>}
          {!loading && rows.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted">Nothing found</p>
          )}
          {rows.map((row, index) => (
            <button
              key={row.kind === "create" ? "__create" : row.option.id}
              type="button"
              onMouseEnter={() => setHighlight(index)}
              onClick={() => commit(index)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                highlight === index ? "bg-brand-50" : ""
              }`}
            >
              {row.kind === "create" ? (
                <span className="font-medium text-brand-700">
                  {createLabel ?? "Add"} “{term.trim()}”
                </span>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.option.label}</span>
                    {row.option.sublabel && (
                      <span className="block truncate text-xs text-muted">
                        {row.option.sublabel}
                      </span>
                    )}
                  </span>
                  {row.option.meta && (
                    <span className="shrink-0 text-xs text-muted">{row.option.meta}</span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Collapsible optional section — keeps the default form short. */
export function Section({
  title,
  hint,
  badge,
  defaultOpen,
  children,
}: {
  title: string;
  hint?: string;
  badge?: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {hint && !open && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
        </div>
        {badge && <span className="pill bg-brand-50 text-brand-700">{badge}</span>}
        <svg
          className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
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
      </button>
      {open && <div className="border-t border-line p-4">{children}</div>}
    </section>
  );
}
