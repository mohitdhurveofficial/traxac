# GST integration

How Ewayvo talks to the government e-Invoice (IRP) and e-Way Bill systems.

The promise this serves: a business enters an invoice once, in Ewayvo, and
never retypes it into a government portal. Everything below exists to make
that true without ever inventing a government artefact.

## Status vocabulary

Used precisely throughout this document and in every report:

| Term                    | Means                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| **IMPLEMENTED**         | Code exists and conforms to the published specification.                                               |
| **TESTED LOCALLY**      | Unit/integration tests pass against a stub. Proves our code agrees with our assumptions, nothing more. |
| **SANDBOX VERIFIED**    | A real request to the government sandbox succeeded.                                                    |
| **PRODUCTION VERIFIED** | A real production transaction succeeded.                                                               |

Nothing is "working" because a mocked test passed.

## Architecture

```
Tenant ─┬─ GSTIN A ─┬─ e-Invoice credentials (encrypted)
        │           └─ e-Way Bill credentials (encrypted)
        └─ GSTIN B ─── …

apps/api ──┐
           ├─► packages/core (compliance service, credential service)
apps/worker┘        │
                    ▼
            packages/gst-gateway   ← provider interfaces, no HTTP
                    │
                    ▼
            packages/nic-client    ← the only place NIC's protocol lives
```

Core invoice logic never imports `nic-client`. It depends on the interfaces in
`gst-gateway`, so a GSP can be added as another implementation without the
invoice model changing.

## Credential model

Credentials are per **tenant + GSTIN + service + environment**, enforced by
`unique(tenant_id, gstin, provider, environment, service)` on `gst_credentials`.
There is no global credential and no shared token.

- Encrypted at rest with `EWAYVO_MASTER_KEY`; only the server decrypts.
- The browser receives `CredentialSummary` — a masked username hint, status,
  last verified time, last error. Never a secret, in any response.
- Session tokens are cached under `gateway:environment:gstin:username`, so one
  tenant's token can never serve another.

**Why per-GSTIN and not per-tenant:** the API username and password are created
by the taxpayer on the government portal against a specific registration. A
credential belonging to GSTIN A is not authorised for GSTIN B even inside the
same business.

## Authentication

Both portals use the same shape: authenticate once, reuse the token.

1. Generate a random 32-byte **AppKey**.
2. Build `{UserName, Password, AppKey, ForceRefreshAccessToken}`.
3. **Base64-encode that JSON, then RSA-encrypt those base64 characters** with
   NIC's public key (PKCS#1 v1.5). The order matters and is the single most
   common integration mistake — encrypting the raw JSON fails every time.
4. The portal returns `AuthToken` and `Sek`, the session key, itself AES
   -encrypted with the AppKey.
5. Every later payload is AES-256-ECB encrypted with the decrypted SEK.

### Token lifetime

Valid ~360 minutes in production, 60 in sandbox. The portal returns **the same
token** for any auth call within its life, so re-authenticating early achieves
nothing. Within the last 10 minutes, `ForceRefreshAccessToken: true` is
required to actually roll it — without that flag the client would re-ask on
every request and hammer a rate-limited endpoint.

### A capacity limit worth knowing before onboarding

Base64 inflates the auth payload by four thirds, against a 245-byte ceiling for
PKCS#1 v1.5 on a 2048-bit key. **API username and password together must be
roughly 66 characters or fewer.** Longer credentials cannot be encrypted at
all; Ewayvo raises a message naming the cause rather than OpenSSL's opaque
"data too large for key size".

### The e-Way Bill master APIs are different

`GetGSTINDetails` and `GetTransporterDetails` do not encrypt with the session
key. Each response carries a per-response key:

```
data = Encrypt(Base64(json), rek)
rek  = Encrypt(rek, sek)
hmac = HMAC-SHA256(Base64(json)) keyed with rek
```

Ewayvo unwraps this and verifies the HMAC — the only integrity check on data
that gets written into a customer record.

## Signed responses

`SignedInvoice` and `SignedQRCode` are JWS (`SHA256RSA`). Ewayvo verifies them
against `NIC_SIGNING_CERT_*` — a **different key** from the auth public key —
and stores the outcome per document: `verified`, `invalid`, `unverified`,
`absent`, `malformed`.

`unverified` means no certificate is configured. It is never promoted to
`verified` by assumption, and a government response is never rejected merely
because verification was unavailable.

## Operations

| Operation                                                    | Endpoint                                                   | Status      |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ----------- |
| Authenticate (IRP)                                           | `/eivital/v1.04/auth`                                      | IMPLEMENTED |
| Generate IRN                                                 | `/eicore/v1.03/Invoice`                                    | IMPLEMENTED |
| Cancel IRN                                                   | `/eicore/v1.03/Cancel`                                     | IMPLEMENTED |
| Get IRN                                                      | `/eicore/v1.03/Invoice/irn/{irn}`                          | IMPLEMENTED |
| Get IRN by document                                          | `/eicore/v1.03/Invoice/irnbydocdetails`                    | IMPLEMENTED |
| GSTIN details                                                | `/eivital/v1.04/Master/gstin/{gstin}`                      | IMPLEMENTED |
| Sync GSTIN from Common Portal                                | `/eivital/v1.04/Master/syncgstin/{gstin}`                  | IMPLEMENTED |
| Get e-Way Bill by IRN                                        | `/eiewb/v1.03/ewaybill/irn/{irn}`                          | IMPLEMENTED |
| e-Way Bill generate / Part-B / transporter / extend / cancel | e-Way Bill portal                                          | IMPLEMENTED |
| e-Way Bill GSTIN + TRANSIN lookup                            | `/Master/GetGSTINDetails`, `/Master/GetTransporterDetails` | IMPLEMENTED |

**Cancel e-Way Bill via the IRP is sandbox-only.** The specification states
that in production the e-Way Bill System's own cancel API must be used, which
is the path Ewayvo takes.

## Error handling

Portal errors keep their identity. `ErrorDetails` arrives in three shapes
depending on the API — a JSON array, a plain JSON string, or a base64-encoded
string — and all three are decoded. Losing the code is not cosmetic: duplicate
recovery (2150) and token refresh (1005/1006) both branch on it.

Errors are classified as authentication, validation, duplicate, rate-limit,
temporary, or permanent. Only genuinely retryable ones are retried.

## Idempotency

A timeout does not mean the portal rejected the request — it may have succeeded
while the response was lost. Ewayvo never blindly resends a document-creating
call. On a duplicate rejection it reads back the existing IRN by document
number and links that, so one invoice can never end up with two IRNs.

Document-creating calls are sent once. Only reads are retried.

## Tenant isolation

Enforced in two independent layers:

- **Application** — `scoped()` / `scopedById()` on every query.
- **PostgreSQL RLS** — policies on every tenant table, `FORCE`d, reading
  `traxac.tenant_id`. The API sets this from the resolved session inside the
  transaction the queries run in; the worker sets it from the claimed `jobs`
  row, never the payload.

The application runs as a **non-superuser** role. A superuser bypasses RLS
entirely, which would make the policies decorative. Provision with:

```bash
TARGET_DATABASE_URL="postgres://owner@host/db" node scripts/create-app-role.mjs
```

Missing tenant context fails closed — queries throw rather than silently
falling back to the pool.

## Environment variables

Platform-level only. **Tenant credentials never belong here** — they live
encrypted in the database.

| Variable                                   | Purpose                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| `GST_ENVIRONMENT`                          | `sandbox` or `production`                              |
| `NIC_CLIENT_ID` / `NIC_CLIENT_SECRET`      | Integrator credentials from NIC                        |
| `NIC_PUBLIC_KEY_SANDBOX` / `_PRODUCTION`   | RSA public key (`einv_sandbox.pem`)                    |
| `NIC_SIGNING_CERT_SANDBOX` / `_PRODUCTION` | Certificate for verifying signed responses             |
| `NIC_IRP_SANDBOX_BASE_URL`                 | Issued at registration — **no default, never guessed** |
| `NIC_IRP_PRODUCTION_BASE_URL`              | `https://api.einvoice1.gst.gov.in`                     |
| `NIC_EWB_SANDBOX_BASE_URL` / `_PRODUCTION` | e-Way Bill hosts                                       |

`einvoice1.gst.gov.in` is the taxpayer _web_ portal and 404s for API calls. The
API host is `api.einvoice1.gst.gov.in`.

## Running the sandbox check

```bash
pnpm test:gst:sandbox
```

Unconfigured, it prints `SANDBOX_NOT_CONFIGURED` and lists exactly what is
missing. It exits 0 — an unconfigured sandbox is the expected state before
onboarding and must not fail CI.

It **refuses to run** when `GST_ENVIRONMENT=production`, and never generates or
cancels a document automatically. `PASS` is printed only for a real portal
response.

Additional variables for a configured run: `SANDBOX_GSTIN`,
`SANDBOX_API_USERNAME`, `SANDBOX_API_PASSWORD`, optionally
`SANDBOX_LOOKUP_GSTIN`, `SANDBOX_IRN`, `SANDBOX_EWB_USERNAME`,
`SANDBOX_EWB_PASSWORD`.

## Getting sandbox access

**e-Invoice** — register at <https://einv-apisandbox.nic.in/>. Requires a GSTIN
enabled for e-invoicing; the portal publishes turnover bands. You receive the
client id, client secret and your sandbox base URL, and can download the public
key after logging in.

**e-Way Bill** — a _separate_ registration at <https://ewaybillgst.gov.in/>,
with its own credentials.

Then, per GSTIN, the taxpayer creates an **API username and password** on the
portal. This is not their web login.

Test GSTINs are published on the sandbox portal for the GSTIN-sync API.

## Production prerequisites

1. Production API registration — separate from sandbox.
2. **Static egress IP.** NIC whitelists production callers by IP. Railway does
   not provide a stable egress IP by default. This is a hard launch dependency
   with no code workaround; it needs a static-IP path or a GSP that provides
   one.
3. `NIC_SIGNING_CERT_PRODUCTION`, or every IRN stays `unverified`.
4. Sandbox verified first. Do not point production credentials at sandbox or
   the reverse — the environment is stored on each credential and selects the
   base URL.

## Rotation and revocation

Credentials can be replaced in place; nothing caches them beyond a request. On
rotation the cached session token is invalidated by the username changing in
the cache key. Revoking is deleting the credential — the affected GSTIN
immediately reports "not connected" and invoices continue to be raised without
compliance, which is the correct degradation.

`EWAYVO_MASTER_KEY` rotation is online via `EWAYVO_MASTER_KEY_PREVIOUS`; see
[deployment.md](deployment.md).

## Troubleshooting

| Symptom                                    | Cause                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Every auth fails, `1020` decryption failed | Auth payload not base64-encoded before RSA, or wrong public key                                         |
| "credentials are too long to encrypt"      | Username + password exceed the RSA capacity; shorten them                                               |
| Auth called on every request               | Refresh flag not set inside the 10-minute window                                                        |
| All error codes read `UNKNOWN`             | `ErrorDetails` base64 form not decoded                                                                  |
| Requests 404                               | Using the web portal host instead of `api.einvoice1.gst.gov.in`, or a sandbox base URL that was guessed |
| e-Way Bill rejects with `393`              | Two GSTIN headers merged into one comma-joined value                                                    |
| Master lookups return garbage              | REK envelope decrypted with the session key instead of the per-response key                             |
