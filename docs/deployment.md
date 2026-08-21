# Deploying Ewayvo on Railway

Two services and one database.

| Service         | Root           | Start command       | Notes                                               |
| --------------- | -------------- | ------------------- | --------------------------------------------------- |
| `ewayvo-app`    | repo root      | `pnpm start`        | Fastify API **and** the built web app on one origin |
| `ewayvo-worker` | repo root      | `pnpm start:worker` | Compliance jobs, PDFs, e-Way Bill expiry sweep      |
| Postgres        | Railway plugin | —                   | `DATABASE_URL` is injected automatically            |

## Why the API also serves the web app

Running the UI and the API on one origin keeps the session cookie first-party.
No CORS to configure, no `SameSite=None`, and a deploy cannot leave the UI on a
different version from the API it is calling.

**Every API route is mounted under `/api`**, and the browser requests exactly
that path in development and in production. The Vite dev server proxies `/api`
straight through without rewriting it. This matters: an earlier version served
the API at `/v1` while the client called `/api/v1`, so in production every call
fell through to the SPA fallback and returned `200 text/html`. The client
treated the HTML as a response body and the app failed silently with nothing in
the console. `apps/api/test/production-routing.test.ts` now asserts that an API
path can never answer with HTML.

`pnpm build` builds the web bundle **and** the packages, so the app service has
something to serve. `vite preview` is not used anywhere — it is a development
convenience, not a production server.

If you later want to scale them separately, set `CORS_ORIGINS` to the web
origin and serve `apps/web/dist` from a static host; nothing in the code
assumes co-location.

## First deploy

1. **Create the project** and add the Postgres plugin.
2. **Create the app service** from this repository.
   - Build: `pnpm install --frozen-lockfile && pnpm build`
   - Start: `pnpm start`
   - Health check: `/health/ready`
3. **Create the worker service** from the same repository.
   - Build: `pnpm install --frozen-lockfile`
   - Start: `pnpm start:worker`
4. **Set the variables** (below) on both services.
5. **Run migrations.** Set the release command to `pnpm db:migrate`, or run it
   once from the Railway shell. Migrations are forward-only and idempotent.
6. **Seed reference data**: `pnpm --filter @ewayvo/core exec tsx -e "…"` or let
   the first `pnpm db:seed` populate UQC units and common HSN codes.

## Environment variables

Required on **both** services:

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
EWAYVO_MASTER_KEY=<openssl rand -base64 32>
```

Required on the **app** service:

```
PORT=${{PORT}}
APP_URL=https://<your-domain>
API_URL=https://<your-domain>
CORS_ORIGINS=https://<your-domain>
```

`COOKIE_SECURE` is **not** in that list on purpose: the Secure flag is derived
from `NODE_ENV=production` and cannot be switched off by forgetting a variable.

Storage paths are resolved against the repository root rather than the process
working directory. pnpm starts each service from its own package folder, so a
relative `STORAGE_LOCAL_DIR` previously meant a different directory in the API
and the worker, and generated PDFs were written where the API never looked.

Object storage (production refuses to start on the local driver):

```
STORAGE_DRIVER=s3
S3_BUCKET=ewayvo-documents
S3_REGION=auto
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

Government gateway — keep on `sandbox` until you have tested against it. Every
one of these is declared in the validated config schema, so a typo fails at
boot rather than at the first portal call:

```
GST_ENVIRONMENT=sandbox
NIC_PUBLIC_KEY_SANDBOX=<base64 public key issued by NIC>
NIC_PUBLIC_KEY_PRODUCTION=<base64 public key issued by NIC>
NIC_CLIENT_ID=…          # optional platform default; tenants can supply their own
NIC_CLIENT_SECRET=…
```

Without the public key and credentials, invoices still work end to end —
create, issue, number, PDF — and the compliance panel reports "GST portal not
connected" with a link to the settings screen. No portal job is queued at all
in that state, so an unconnected business never accumulates failed jobs, and
nothing is simulated.

## Before the first deploy: object storage

The most common first-deploy failure. `STORAGE_DRIVER` defaults to `local`,
and in production the API refuses to start on it:

```
[api] failed to start: Error: STORAGE_DRIVER=local is not allowed in production; configure S3
```

Railway surfaces that as a container that restarts five times and a deployment
marked failed, because `/health/ready` never answers. Set all five before
deploying:

```
STORAGE_DRIVER=s3
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # omit for AWS S3
```

Setting the driver without a bucket fails the same way, with
`S3_BUCKET is required when STORAGE_DRIVER=s3`. Both checks are deliberate:
local disk on Railway is ephemeral, so an invoice PDF written there is lost on
the next deploy.

## The database role

Row-level security is **bypassed entirely for a superuser**, FORCE or not. A
deployment that connects as the database owner therefore has RLS in name only.
Provision the application role once, then point `DATABASE_URL` at it:

```bash
TARGET_DATABASE_URL="postgres://owner@host/ewayvo" node scripts/create-app-role.mjs
```

It creates `traxac_app` with `SELECT/INSERT/UPDATE/DELETE` on the public schema
and nothing else — no `CREATE`, no ownership, no `BYPASSRLS`. The enforcement
suite (`packages/core/test/rls-enforced.test.ts`) connects as this role, and CI
sets `REQUIRE_RLS_ROLE=1` so its absence fails the build rather than skipping
the tests.

## The master key

`EWAYVO_MASTER_KEY` wraps every stored GST credential and cached portal token.

- **Losing it means losing every stored credential.** Back it up somewhere
  other than Railway.
- **Rotating it** is online: set `EWAYVO_MASTER_KEY` to the new key,
  `EWAYVO_MASTER_KEY_PREVIOUS` to the old one, and bump
  `EWAYVO_MASTER_KEY_VERSION`. Existing ciphertext keeps decrypting with the
  previous key and is re-wrapped with the new one the next time it is read.
  Remove `EWAYVO_MASTER_KEY_PREVIOUS` once `SELECT count(*) FROM
gst_credentials WHERE key_version < <new version>` reaches zero.

## Scaling

The worker claims jobs with `SELECT … FOR UPDATE SKIP LOCKED`, so adding
replicas is the only thing needed to add throughput — there is no leader
election and no lock to lose. A replica that dies mid-job has its work
reclaimed after five minutes by whichever worker notices first.

The API is stateless apart from the Postgres connection pool. Keep
`DATABASE_POOL_MAX × replicas` below the Postgres connection limit.

## Backups

Railway's Postgres plugin takes automated snapshots; verify the retention on
your plan. Two things are **not** in the database and must be backed up
separately:

- `EWAYVO_MASTER_KEY` — without it the credential rows are unreadable.
- The object storage bucket — invoice PDFs and signed e-Invoice JSON. Enable
  versioning and a lifecycle policy on the bucket rather than relying on the
  application never deleting.

The signed e-Invoice JSON is the legally meaningful artefact; the PDF is only a
rendering of it and can always be regenerated from the database.

## Monitoring

| Endpoint        | Purpose                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `/health`       | Liveness. Answers while the process is up.                                   |
| `/health/ready` | Readiness. Also checks the database. Use this for the platform health check. |
| `/health/queue` | Job counts by status. Alert if `failed` grows or `pending` stops draining.   |

Every outbound government API call is recorded in `gateway_calls` with the
endpoint, attempt number, duration, response status and redacted payloads.
That table is the record when a portal disputes what was filed.

Logs are structured JSON with credentials, tokens and password hashes redacted
at the logger, not at the call site.
