# NIC / GST integration

How Ewayvo talks to the government portals, what it needs to do so, and what
has actually been proven against a live endpoint.

## Status

| Operation           | Implemented | Contract-tested | Live sandbox round trip        |
| ------------------- | ----------- | --------------- | ------------------------------ |
| Authentication      | yes         | yes             | **no — no credentials issued** |
| Generate IRN        | yes         | yes             | no                             |
| Get IRN by document | yes         | yes             | no                             |
| Cancel IRN          | yes         | yes             | no                             |
| Generate e-Way Bill | yes         | yes             | no                             |
| Get e-Way Bill      | yes         | yes             | no                             |
| Update Part-B       | yes         | yes             | no                             |
| Extend validity     | yes         | yes             | no                             |
| Cancel e-Way Bill   | yes         | yes             | no                             |

**No document has been filed against a real portal.** Nothing here should be
described as working end to end until `pnpm test:sandbox` passes with real
credentials. What _has_ been exercised against the live NIC host is the
transport: request, response, error decoding, mapping and logging — see
"What the live probes proved" below.

## Endpoints

Both hosts were probed directly; these are observed, not assumed.

| Gateway         | Environment | Base URL                                       |
| --------------- | ----------- | ---------------------------------------------- |
| e-Invoice (IRP) | production  | `https://api.einvoice1.gst.gov.in`             |
| e-Invoice (IRP) | sandbox     | **issued on registration** — no public default |
| e-Way Bill      | sandbox     | `https://einv-apisandbox.nic.in`               |
| e-Way Bill      | production  | `https://ewaybillgst.gov.in`                   |

`einvoice1.gst.gov.in` is the taxpayer web portal, **not** the API — requests
to it 404. The API is on the `api.` host. `einv-apisandbox.nic.in` is the
developer portal and also serves the e-Way Bill sandbox API.

Paths:

```
IRP   POST /eivital/v1.04/auth
      POST /eicore/v1.03/Invoice
      POST /eicore/v1.03/Invoice/Cancel
      GET  /eicore/v1.03/Invoice/irn/{irn}
      GET  /eicore/v1.03/Invoice/irnbydocdetails?doctype=&docno=&docdate=
EWB   POST /ewaybillapi/v1.03/auth
      POST /ewaybillapi/v1.03/ewayapi          (action=GENEWAYBILL|VEHEWB|…)
      GET  /ewaybillapi/v1.03/ewayapi/GetEwayBill?ewbNo=
```

## Getting sandbox access

1. Register at <https://einv-apisandbox.nic.in> as an API user.
2. NIC issues a **client ID**, **client secret**, **API username/password**,
   the **sandbox base URL** and the **RSA public key** for that environment.
   The public key is per-environment and rotates; treat it as configuration.
3. The account is tied to a test GSTIN — use that GSTIN, not a real one.

## Authentication flow

Confirmed by probing `api.einvoice1.gst.gov.in`: an empty body returns
`5003 "Data cannot be null or empty"`, and a non-encrypted `Data` field
returns `1020 "Decryption failed"`.

```
1  generate a random 32-byte AppKey
2  build {UserName, Password, AppKey, ForceRefreshAccessToken}
3  RSA-encrypt it with NIC's public key   -> {"Data": "<base64>"}
4  POST with headers client_id, client_secret, and the GSTIN header
5  response Data is AES-256-ECB encrypted with the AppKey
6  decrypt -> {AuthToken, Sek, TokenExpiry}
7  the Sek is itself AppKey-wrapped; unwrap it
8  every later call: AES-encrypt the body with the Sek
```

The GSTIN header is named `Gstin` for the IRP and lowercase `gstin` for the
EWB API. **Send exactly one.** Setting both makes `fetch` merge them into
`"GSTIN, GSTIN"`, which the EWB portal rejects with error 393 — this was found
by probing the live endpoint, not by reading the spec.

Tokens last about six hours and the auth endpoint is rate-limited, so they are
cached in Postgres (encrypted) and shared by the API and every worker replica
rather than re-fetched per process.

## Environment variables

```
GST_ENVIRONMENT=sandbox                 sandbox | production

NIC_PUBLIC_KEY_SANDBOX=<base64 or PEM>  required before any call is attempted
NIC_PUBLIC_KEY_PRODUCTION=<base64 or PEM>

NIC_IRP_SANDBOX_BASE_URL=https://…      required: no public default exists
NIC_IRP_PRODUCTION_BASE_URL=            optional override
NIC_EWB_SANDBOX_BASE_URL=               optional override
NIC_EWB_PRODUCTION_BASE_URL=            optional override

NIC_CLIENT_ID=                          platform default; a tenant may override
NIC_CLIENT_SECRET=
GATEWAY_TIMEOUT_MS=30000
```

All of these are declared in the validated config schema, so a typo fails at
boot rather than at the first portal call. Without a public key the gateway
refuses to authenticate rather than sending an unwrapped payload.

## Per-tenant credentials

The API username and password belong to the taxpayer, not the platform, so
they are stored per GSTIN per service in `gst_credentials`, AES-256-GCM
encrypted with the platform master key and re-wrapped on key rotation. The API
returns a masked hint (`PRO…SER`) and never the value. Plaintext exists only
inside `CredentialService.resolve` for the duration of one call.

Add them in **Settings → GST credentials**, then use **Test** — the only
honest way to check a credential is to authenticate with it.

## Idempotency and retries

A timeout on a document-creating call is the dangerous case: the portal may
have issued the document and the response was lost. Filing a second IRN is a
compliance problem, not a glitch.

The rules:

- **Document-creating calls are sent once.** Reads retry; `generateIrn` and
  EWB `generate` do not.
- **Any attempt after the first reconciles before sending.** The IRN path asks
  `irnbydocdetails` for the document number; the EWB path confirms a recorded
  bill number with `GetEwayBill`. If the portal already holds it, that is the
  answer and nothing is sent. `attempts > 0` on the tracking row is the
  trigger — the first attempt has nothing to reconcile and pays no round trip.
- **A recovered document is persisted identically** to a freshly issued one,
  with `source: "reconciliation"` on the audit entry.
- **Duplicate rejections are outcomes, not errors.** IRP 2150/2172 and EWB
  604/312 mean the portal already has it; the existing document is read back.
- **Enqueueing is idempotent.** `einvoice.generate:<invoiceId>` is a unique
  key, so a double click collapses onto one job.
- **A completed document short-circuits** before any call is made.

Covered by `packages/core/test/idempotency.test.ts`.

## Error handling

Portals report failures in two different shapes, neither presentable:

```
IRP  {"Status":0,"ErrorDetails":[{"ErrorCode":"2150","ErrorMessage":"…"}]}
EWB  {"status":"0","error":"<base64 of {\"errorCodes\":\"116\"}>"}
```

`packages/nic-client/src/errors.ts` parses both and produces a plain sentence.
The portal's verbatim text and every code are kept in `gateway_calls` and on
the `einvoices`/`eway_bills` row; the user sees only the sentence.

```
portal: {"errorCodes":"212"}
user:   "The HSN code is not valid for one of the items."
```

An unmapped code degrades to a readable sentence naming the portal and the
code, rather than surfacing a bare number.

## Running the live sandbox tests

Ordinary CI never touches NIC. The live suite is skipped unless every piece of
integration material is present:

```bash
export EWAYVO_SANDBOX_ENABLED=1
export EWAYVO_SANDBOX_GSTIN=…          # the GSTIN the sandbox account covers
export EWAYVO_SANDBOX_USERNAME=…
export EWAYVO_SANDBOX_PASSWORD=…
export EWAYVO_SANDBOX_CLIENT_ID=…
export EWAYVO_SANDBOX_CLIENT_SECRET=…
export NIC_PUBLIC_KEY_SANDBOX=…
export NIC_IRP_SANDBOX_BASE_URL=…

pnpm test:sandbox
```

It skips with the reason printed when anything is missing. These tests file
real documents in the sandbox.

## Test layers

| Layer        | Location                                          | Network       | In CI |
| ------------ | ------------------------------------------------- | ------------- | ----- |
| Unit         | `packages/shared/test`                            | no            | yes   |
| Contract     | `packages/nic-client/test/error-contract.test.ts` | no            | yes   |
| Integration  | `packages/core/test/*.test.ts`                    | Postgres only | yes   |
| Live sandbox | `packages/core/test/sandbox-live.test.ts`         | NIC           | no    |

Contract tests replay envelopes captured verbatim from the live endpoints, so
they pin the real wire format without depending on NIC being up.

## What the live probes proved

Against the real hosts, with no credentials:

- Both hosts reachable; the endpoint paths above exist and process requests.
- The IRP auth contract is exactly `{Data: RSA(...)}` plus headers — an empty
  body gives 5003, an unencrypted one gives 1020.
- The EWB error envelope is base64-encoded `errorCodes`, not the IRP's
  `ErrorDetails`. The original implementation assumed one shape for both and
  would have silently lost every EWB error code.
- The duplicate GSTIN header bug: 393 before the fix, 107 after, confirming
  the header now arrives correctly.
- A real portal error was decoded, mapped to an actionable sentence, and
  written to `gateway_calls` with a duration and no secrets.

What this does **not** prove: that a document can be created. That needs
credentials.
