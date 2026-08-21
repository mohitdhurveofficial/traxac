/**
 * Sandbox verification harness.
 *
 * Answers one question honestly: does Traxac actually talk to the government
 * sandbox? Every other test in this repository uses a stub, and a stub can
 * only prove that our code agrees with our assumptions.
 *
 * Rules this obeys:
 *
 *  - PASS is printed only when a real portal response arrived. A missing
 *    credential is SKIP, never PASS.
 *  - It refuses to run against production. The whole point is a safe place to
 *    be wrong, and generating a real IRN against a live GSTIN is not that.
 *  - It performs no destructive operation unless explicitly asked, because
 *    an IRN cancelled by mistake cannot be un-cancelled.
 *
 *   pnpm test:gst:sandbox
 */
import { createContainer, loadConfig } from "@traxac/core";

type Outcome = "PASS" | "FAIL" | "SKIP";

interface Step {
  name: string;
  outcome: Outcome;
  detail: string;
}

const steps: Step[] = [];
const record = (name: string, outcome: Outcome, detail = ""): void => {
  steps.push({ name, outcome, detail });
};

/** Environment the harness needs before it can reach the portal at all. */
const REQUIRED = [
  ["GST_ENVIRONMENT", "must be 'sandbox'"],
  ["NIC_CLIENT_ID", "integrator client id issued by NIC"],
  ["NIC_CLIENT_SECRET", "integrator client secret issued by NIC"],
  ["NIC_PUBLIC_KEY_SANDBOX", "NIC's RSA public key (einv_sandbox.pem), login-gated download"],
  ["NIC_IRP_SANDBOX_BASE_URL", "issued to you on registration — there is no public default"],
  ["SANDBOX_GSTIN", "the GSTIN whose API credentials you are testing"],
  ["SANDBOX_API_USERNAME", "API username created on the portal, not the web login"],
  ["SANDBOX_API_PASSWORD", "API password created on the portal"],
] as const;

function missingConfiguration(): string[] {
  return REQUIRED.filter(([key]) => !process.env[key]?.trim()).map(
    ([key, why]) => `  ${key.padEnd(28)} ${why}`,
  );
}

async function main(): Promise<void> {
  const missing = missingConfiguration();

  if (process.env["GST_ENVIRONMENT"] === "production") {
    console.error("REFUSED — GST_ENVIRONMENT=production.");
    console.error("This harness only runs against the sandbox. It will not touch a live GSTIN.");
    process.exit(2);
  }

  if (missing.length > 0) {
    console.log("SANDBOX_NOT_CONFIGURED\n");
    console.log("The government sandbox has not been configured, so nothing was tested.");
    console.log("Traxac's e-Invoice and e-Way Bill code is IMPLEMENTED but NOT LIVE-VERIFIED.\n");
    console.log("Missing:");
    console.log(missing.join("\n"));
    console.log("\nHow to obtain these: docs/gst-integration.md");
    // Not an error: an unconfigured sandbox is the expected state before
    // onboarding, and CI must not fail because of it.
    process.exit(0);
  }

  const config = loadConfig();
  if (config.GST_ENVIRONMENT !== "sandbox") {
    console.error("REFUSED — GST_ENVIRONMENT must be 'sandbox'.");
    process.exit(2);
  }

  const container = createContainer({ processName: "gst-sandbox-check" });
  const gstin = process.env["SANDBOX_GSTIN"] ?? "";
  const credentials = {
    username: process.env["SANDBOX_API_USERNAME"] ?? "",
    password: process.env["SANDBOX_API_PASSWORD"] ?? "",
    clientId: config.NIC_CLIENT_ID ?? "",
    clientSecret: config.NIC_CLIENT_SECRET ?? "",
  };
  const ctx = {
    tenantId: "00000000-0000-0000-0000-000000000000",
    gstin,
    environment: "sandbox" as const,
    credentials,
    idempotencyKey: `sandbox-check:${gstin}`,
  };

  try {
    /* ---------------------------- e-Invoice ---------------------------- */
    const irp = container.registry.einvoice("sandbox");

    const auth = await irp.verify(ctx);
    record(
      "E-INVOICE AUTH",
      auth.ok ? "PASS" : "FAIL",
      auth.ok ? "" : `${auth.error.code}: ${auth.error.message}`,
    );

    if (auth.ok) {
      const lookupTarget = process.env["SANDBOX_LOOKUP_GSTIN"] ?? gstin;
      const lookup = await irp.getGstinDetails(ctx, lookupTarget);
      record(
        "GSTIN LOOKUP",
        lookup.ok ? "PASS" : "FAIL",
        lookup.ok
          ? `${lookup.data.legalName ?? "(no legal name)"} — ${lookup.data.status}`
          : `${lookup.error.code}: ${lookup.error.message}`,
      );

      // Reading back a known IRN is safe; generating one is not, so it only
      // happens when a document is named explicitly.
      const knownIrn = process.env["SANDBOX_IRN"];
      if (knownIrn) {
        const details = await irp.getIrn(ctx, knownIrn);
        record(
          "IRN RETRIEVAL",
          details.ok ? "PASS" : "FAIL",
          details.ok ? `status ${details.data.status}` : `${details.error.code}`,
        );
      } else {
        record("IRN RETRIEVAL", "SKIP", "set SANDBOX_IRN to read an existing document back");
      }

      record(
        "IRN GENERATION",
        "SKIP",
        "generates a real sandbox document — run the end-to-end flow in the app instead",
      );
      record("IRN CANCELLATION", "SKIP", "destructive; not run automatically");
    } else {
      for (const name of ["GSTIN LOOKUP", "IRN RETRIEVAL", "IRN GENERATION", "IRN CANCELLATION"]) {
        record(name, "SKIP", "authentication failed");
      }
    }

    /* ---------------------------- e-Way Bill ---------------------------- */
    if (process.env["SANDBOX_EWB_USERNAME"]?.trim()) {
      const ewbCtx = {
        ...ctx,
        credentials: {
          ...credentials,
          username: process.env["SANDBOX_EWB_USERNAME"] ?? "",
          password: process.env["SANDBOX_EWB_PASSWORD"] ?? credentials.password,
        },
      };
      const ewb = container.registry.ewb("sandbox");
      const ewbAuth = await ewb.verify(ewbCtx);
      record(
        "EWB AUTH",
        ewbAuth.ok ? "PASS" : "FAIL",
        ewbAuth.ok ? "" : `${ewbAuth.error.code}: ${ewbAuth.error.message}`,
      );

      if (ewbAuth.ok) {
        const ewbLookup = await ewb.getGstinDetails(ewbCtx, gstin);
        record(
          "EWB GSTIN LOOKUP",
          ewbLookup.ok ? "PASS" : "FAIL",
          ewbLookup.ok ? `${ewbLookup.data.legalName ?? ""}` : `${ewbLookup.error.code}`,
        );
      }
      record("EWB GENERATION", "SKIP", "creates a real e-Way Bill; run it from the app");
      record("EWB CANCELLATION", "SKIP", "destructive; not run automatically");
    } else {
      record("EWB AUTH", "SKIP", "SANDBOX_EWB_USERNAME not set");
    }
  } finally {
    await container.shutdown();
  }

  report();
}

function report(): void {
  console.log("\nGST SANDBOX CHECK — environment: sandbox\n");
  const width = Math.max(...steps.map((s) => s.name.length)) + 2;
  for (const step of steps) {
    const dots = ".".repeat(Math.max(2, width - step.name.length));
    console.log(`${step.name} ${dots} ${step.outcome}${step.detail ? `  (${step.detail})` : ""}`);
  }

  const failed = steps.filter((s) => s.outcome === "FAIL").length;
  const passed = steps.filter((s) => s.outcome === "PASS").length;
  console.log(
    `\n${passed} passed, ${failed} failed, ${steps.filter((s) => s.outcome === "SKIP").length} skipped`,
  );
  console.log(
    passed > 0 && failed === 0
      ? "\nSANDBOX VERIFIED for the operations marked PASS. Everything else remains IMPLEMENTED — NOT LIVE-VERIFIED."
      : "\nNot sandbox verified.",
  );
  process.exit(failed > 0 ? 1 : 0);
}

await main();
