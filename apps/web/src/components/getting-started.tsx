import { Link } from "react-router-dom";
import { useGstins, useParties, useProducts } from "../api/hooks.js";

/**
 * First-run checklist.
 *
 * A brand new account is the one moment where an empty screen is unhelpful.
 * Four steps, in the order they are actually needed to raise a bill, each
 * linking straight to the screen that completes it. The whole card removes
 * itself the moment the first invoice exists — it is scaffolding, not a
 * permanent fixture.
 */
export function GettingStarted() {
  const gstins = useGstins();
  const parties = useParties({ limit: 1 });
  const products = useProducts({ limit: 1 });

  if (gstins.isLoading || parties.isLoading || products.isLoading) return null;

  const steps = [
    {
      done: (gstins.data?.items.length ?? 0) > 0,
      title: "Add your GSTIN",
      description: "The registration you bill from, with its address.",
      to: "/settings?tab=business",
      cta: "Add GSTIN",
    },
    {
      done: (parties.data?.total ?? 0) > 0,
      title: "Add a customer",
      description: "Their GSTIN and place of supply decide the tax split.",
      to: "/customers",
      cta: "Add customer",
    },
    {
      done: (products.data?.total ?? 0) > 0,
      title: "Add what you sell",
      description: "An HSN code and rate, saved once and reused.",
      to: "/items",
      cta: "Add item",
    },
    {
      done: false,
      title: "Raise your first invoice",
      description: "Everything else — PDF, tax working, records — follows from it.",
      to: "/invoices/new",
      cta: "New invoice",
    },
  ];

  const remaining = steps.filter((step) => !step.done);
  const next = remaining[0];
  if (!next) return null;

  return (
    <section className="mb-5 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Set up Ewayvo</h2>
        <p className="text-xs text-muted">
          {steps.length - remaining.length} of {steps.length} done
        </p>
      </div>

      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <li
            key={step.title}
            className={`rounded-lg border bg-white p-3 ${
              step === next ? "border-brand-400" : "border-line"
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  step.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                }`}
                aria-hidden
              >
                {step.done ? "✓" : ""}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${step.done ? "text-muted line-through" : ""}`}>
                  {step.title}
                </p>
                {!step.done && <p className="mt-0.5 text-xs text-muted">{step.description}</p>}
              </div>
            </div>
            {!step.done && (
              <Link
                to={step.to}
                className={`mt-2.5 inline-block text-xs font-medium ${
                  step === next ? "text-brand-700 hover:underline" : "text-muted hover:text-ink"
                }`}
              >
                {step.cta} →
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
