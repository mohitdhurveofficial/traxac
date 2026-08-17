import { describe, expect, it } from "vitest";
import {
  EWB_AUTH_CODES,
  EWB_DUPLICATE_CODES,
  IRP_AUTH_CODES,
  IRP_DUPLICATE_CODES,
  isSuccess,
  parseEwbError,
  parseIrpError,
} from "../src/errors.js";

/**
 * Contract tests against envelopes captured from the live NIC endpoints.
 *
 * These are not invented shapes. Each fixture below was recorded by calling
 * the real host:
 *
 *   POST https://api.einvoice1.gst.gov.in/eivital/v1.04/auth  {}
 *     -> {"Status":0,"ErrorDetails":[{"ErrorCode":"5003",...}],...}
 *   POST https://einv-apisandbox.nic.in/ewaybillapi/v1.03/auth
 *     -> {"status":"0","error":"eyJlcnJvckNvZGVzIjoiMTE2In0=","info":null}
 *
 * They run without credentials and without network access, so CI never
 * depends on NIC being up — but they still pin the real wire format.
 */

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64");

describe("IRP error envelope (captured from api.einvoice1.gst.gov.in)", () => {
  const emptyBody = {
    Status: 0,
    ErrorDetails: [{ ErrorCode: "5003", ErrorMessage: "Data cannot be null or empty" }],
    Data: null,
    InfoDtls: null,
  };
  const decryptionFailed = {
    Status: 0,
    ErrorDetails: [{ ErrorCode: "1020", ErrorMessage: "Decryption failed" }],
    Data: null,
    InfoDtls: null,
  };

  it("recognises the numeric Status field the portal actually sends", () => {
    expect(isSuccess(emptyBody)).toBe(false);
    expect(isSuccess({ Status: 1 })).toBe(true);
    expect(isSuccess({ Status: "1" })).toBe(true);
  });

  it("extracts the portal code and keeps the portal text for the audit trail", () => {
    const parsed = parseIrpError(emptyBody);
    expect(parsed.code).toBe("5003");
    expect(parsed.rawMessage).toContain("Data cannot be null or empty");
  });

  it("turns a credential failure into an instruction, not a code", () => {
    const parsed = parseIrpError(decryptionFailed);
    expect(parsed.code).toBe("1020");
    expect(parsed.userMessage).toMatch(/credentials/i);
    expect(parsed.userMessage).not.toMatch(/1020|Decryption failed/);
  });

  it("collects every reported code, not just the first", () => {
    const parsed = parseIrpError({
      Status: 0,
      ErrorDetails: [
        { ErrorCode: "2182", ErrorMessage: "Taxable value mismatch" },
        { ErrorCode: "2189", ErrorMessage: "Invoice value mismatch" },
      ],
    });
    expect(parsed.details.map((d) => d.code)).toEqual(["2182", "2189"]);
    expect(parsed.userMessage).toMatch(/taxable value/i);
  });

  it("degrades readably for a code it has never seen", () => {
    const parsed = parseIrpError({
      Status: 0,
      ErrorDetails: [{ ErrorCode: "9999", ErrorMessage: "Some new portal rule" }],
    });
    expect(parsed.code).toBe("9999");
    expect(parsed.userMessage).toContain("Some new portal rule");
    expect(parsed.userMessage).toMatch(/e-Invoice portal/);
  });

  it("survives a body with no error details at all", () => {
    const parsed = parseIrpError({ Status: 0 });
    expect(parsed.code).toBe("UNKNOWN");
    expect(parsed.userMessage.length).toBeGreaterThan(10);
  });

  it("treats a duplicate IRN as a recoverable outcome", () => {
    expect(IRP_DUPLICATE_CODES.has("2150")).toBe(true);
    const parsed = parseIrpError({
      Status: 0,
      ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }],
    });
    expect(parsed.userMessage).toMatch(/already has an IRN/i);
  });

  it("marks only session errors as retryable", () => {
    expect(parseIrpError({ ErrorDetails: [{ ErrorCode: "1005" }] }).retryable).toBe(true);
    // A rejected payload must never be resent — that risks a duplicate.
    expect(parseIrpError({ ErrorDetails: [{ ErrorCode: "2182" }] }).retryable).toBe(false);
    for (const code of IRP_AUTH_CODES) {
      expect(parseIrpError({ ErrorDetails: [{ ErrorCode: code }] }).retryable, code).toBe(true);
    }
  });
});

describe("EWB error envelope (captured from einv-apisandbox.nic.in)", () => {
  // Verbatim from the live endpoint with no gstin header.
  const missingHeader = { status: "0", error: "eyJlcnJvckNvZGVzIjoiMzkzIn0=", info: null };
  // Verbatim from the live endpoint with headers but no valid credentials.
  const badCredentials = { status: "0", error: "eyJlcnJvckNvZGVzIjoiMTE2In0=", info: null };

  it("decodes the base64 error blob the portal returns", () => {
    expect(parseEwbError(missingHeader).code).toBe("393");
    expect(parseEwbError(badCredentials).code).toBe("116");
  });

  it("does not mistake the EWB envelope for the IRP one", () => {
    // The IRP parser would find no ErrorDetails and lose the code entirely,
    // which is exactly the bug this envelope handling replaced.
    expect(parseIrpError(badCredentials).code).toBe("UNKNOWN");
    expect(parseEwbError(badCredentials).code).toBe("116");
  });

  it("explains a credential failure in the user's terms", () => {
    const parsed = parseEwbError(badCredentials);
    expect(parsed.userMessage).toMatch(/username or client credentials/i);
    expect(parsed.userMessage).not.toContain("116");
  });

  it("splits a multi-code response", () => {
    const parsed = parseEwbError({ status: "0", error: b64({ errorCodes: "212,220" }) });
    expect(parsed.details.map((d) => d.code)).toEqual(["212", "220"]);
    expect(parsed.userMessage).toMatch(/HSN code/i);
  });

  it("recovers the existing bill number from a duplicate rejection", () => {
    const parsed = parseEwbError({
      status: "0",
      error: b64({ errorCodes: "604", message: "E-way Bill 391000123456 already generated" }),
    });
    expect(EWB_DUPLICATE_CODES.has(parsed.code)).toBe(true);
    expect(parsed.rawMessage).toContain("391000123456");
  });

  it("survives an error field that is not base64 JSON", () => {
    const parsed = parseEwbError({ status: "0", error: "plain text failure" });
    expect(parsed.rawMessage).toBe("plain text failure");
    expect(parsed.userMessage.length).toBeGreaterThan(10);
  });

  it("marks only session errors as retryable", () => {
    for (const code of EWB_AUTH_CODES) {
      expect(parseEwbError({ error: b64({ errorCodes: code }) }).retryable, code).toBe(true);
    }
    expect(parseEwbError({ error: b64({ errorCodes: "212" }) }).retryable).toBe(false);
  });

  it("recognises the lowercase success status", () => {
    expect(isSuccess({ status: "1" })).toBe(true);
    expect(isSuccess({ status: "0" })).toBe(false);
  });
});

describe("no secret ever reaches a parsed error", () => {
  it("keeps credentials out of the message and the raw text", () => {
    const parsed = parseIrpError({
      Status: 0,
      ErrorDetails: [{ ErrorCode: "1020", ErrorMessage: "Decryption failed" }],
      Password: "hunter2",
      AppKey: "c2VjcmV0",
    });
    const serialised = JSON.stringify(parsed);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("c2VjcmV0");
  });
});
