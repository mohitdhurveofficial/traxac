import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLogin, useRegister } from "../api/hooks.js";
import { ErrorNote, Field, Spinner } from "../components/ui.js";

/**
 * Sign-in and sign-up share one screen. A new business is three fields away
 * from raising its first invoice, which is the whole promise of the product.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const login = useLogin();
  const register = useRegister();
  const pending = login.isPending || register.isPending;
  const error = login.error ?? register.error;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const done = { onSuccess: () => navigate("/invoices", { replace: true }) };

    if (mode === "login") {
      login.mutate({
        email: String(data.get("email")),
        password: String(data.get("password")),
      }, done);
    } else {
      register.mutate({
        name: String(data.get("name")),
        email: String(data.get("email")),
        password: String(data.get("password")),
        businessName: String(data.get("businessName")),
      }, done);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-base font-bold text-white">T</span>
            <span className="text-lg font-semibold tracking-tight">Traxac</span>
          </div>

          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "login" ? "Sign in" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "login"
              ? "Bill your customers and stay GST compliant."
              : "Set up your business in under a minute."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode === "register" && (
              <>
                <Field label="Your name" required>
                  <input name="name" className="field" required autoComplete="name" placeholder="Ramesh Kumar" />
                </Field>
                <Field label="Business name" required hint="This appears on your invoices.">
                  <input name="businessName" className="field" required placeholder="Sundar Steel Traders" />
                </Field>
              </>
            )}

            <Field label="Email" required>
              <input name="email" type="email" className="field" required
                autoComplete="email" placeholder="you@business.in" />
            </Field>

            <Field
              label="Password"
              required
              hint={mode === "register" ? "At least 10 characters, with an uppercase letter and a number." : undefined}
            >
              <input name="password" type="password" className="field" required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "register" ? 10 : 8} />
            </Field>

            <ErrorNote error={error} />

            <button type="submit" className="btn-primary w-full" disabled={pending}>
              {pending && <Spinner />}
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {mode === "login" ? "New to Traxac?" : "Already have an account?"}{" "}
            <button type="button" className="font-medium text-brand-700 hover:underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>

      {/* The value proposition, stated once, in the customer's own words. */}
      <div className="hidden flex-col justify-center bg-ink px-12 text-white lg:flex">
        <p className="text-2xl leading-snug font-semibold tracking-tight">
          Invoice, e-Invoice and e-Way Bill.<br />One screen, one click.
        </p>
        <ul className="mt-8 space-y-3 text-sm text-slate-300">
          {[
            "Pick a customer, add items, done — tax is worked out for you.",
            "IRN and QR code from the Government portal, attached to the invoice.",
            "e-Way Bills with validity tracked, and a warning before they lapse.",
            "Everything you billed, searchable — by number, buyer, IRN or vehicle.",
          ].map((line) => (
            <li key={line} className="flex gap-3">
              <svg className="mt-0.5 size-4 shrink-0 text-brand-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
              </svg>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
