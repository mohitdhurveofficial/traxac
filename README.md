# Traxac

Multi-tenant Indian GST billing SaaS with e-Invoice (IRN) and e-Way Bill built in.

The point of the product: a trader raises an invoice the way they already think
about it — customer, items, transport — and the compliance layer (IRN, QR, EWB,
validity, extensions, cancellations) happens underneath without them learning
the GST API vocabulary.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (Node 20+, ESM) | one language across API, worker and web |
| Database | PostgreSQL + Drizzle ORM | SQL-first migrations, no hidden magic |
| API | Fastify | API-first so a mobile client reuses the same endpoints |
| Queue | Postgres `SELECT … FOR UPDATE SKIP LOCKED` | no extra infrastructure to run on Railway |
| Storage | S3-compatible (local driver in dev) | PDFs, signed e-Invoice JSON, attachments |
| Web | React + Vite + Tailwind | desktop-first, fully responsive |
| Deploy | Railway | separate development and production configuration |

## Workspace layout

```
packages/
  shared/       GST domain: tax engine, GSTIN/HSN validation, EWB rules, API contracts (zod)
  database/     Drizzle schema, migrations, typed client
  core/         config, logging, crypto, auth, tenant isolation, domain services
  gst-gateway/  transport-agnostic provider interfaces for IRP and EWB
  nic-client/   NIC API client (auth, encryption, retries)
apps/
  api/          Fastify HTTP layer over core services
  worker/       background job runner for compliance operations
  web/          React application
```

## Money and correctness

Every monetary amount is an integer number of **paise**, stored as `bigint`.
The tax engine (`packages/shared/src/gst/calculate.ts`) is pure and
deterministic, and the same function runs in the browser preview, the API and
the worker — a preview can never disagree with what is filed.

## Government integrations

Traxac never fabricates an IRN, QR code or e-Way Bill number. The gateway
packages define provider interfaces; the NIC client speaks the real protocol
against:

- e-Invoice / IRP — <https://einvoice1.gst.gov.in> (sandbox: `einv-apisandbox.nic.in`)
- e-Way Bill — <https://ewaybillgst.gov.in>

Until production credentials are provisioned, `GST_ENVIRONMENT=sandbox` routes
to the NIC sandbox. With no credentials configured at all, compliance actions
fail loudly with `CREDENTIALS_MISSING` rather than returning fake data.

## Local development

```bash
pnpm install
createdb traxac_dev
cp .env.example .env && pnpm gen:env   # generates the master encryption key
pnpm db:migrate
pnpm db:seed                           # reference data + a worked example
pnpm dev                               # API :3000, worker, web :5173
```

Sign in with `owner@demo.traxac.in` / `TraxacDemo2026!`.

The seed creates the transaction that exercises the hard parts of the model:
billed to Bengaluru, shipped to a site in Hosur, dispatched from a plant in
Chakan (e-Way Bill transaction type 4), three HSN codes, freight at 5% and
packing at 18%.

## Tests

```bash
pnpm test        # unit tests
pnpm typecheck   # every package and app
```

70 tests. Unit coverage for the tax engine (discounts, cess, charges,
IGST-on-intra, zero-rated exports, exact CGST/SGST halving, round-off), the
GSTIN checksum, e-Way Bill validity and the extend/cancel windows, IST and
financial-year maths, and credential encryption including key rotation.

Integration tests run against a real Postgres, because the two properties that
matter most are enforced by SQL rather than by application code:

- **Tenant isolation** — two businesses in one database, with twelve attempts
  to read, edit, finalize, cancel or reference across the boundary.
- **Document numbering** — twelve invoices finalized concurrently must produce
  unique, gapless numbers. This test found two real bugs.

Point them at another database with `TEST_DATABASE_URL`.

## Deployment

Two Railway services and a Postgres plugin — see
[docs/deployment.md](docs/deployment.md). The API serves the built web app on
the same origin so the session cookie stays first-party and there is no CORS to
configure.

## Design notes

[docs/architecture.md](docs/architecture.md) covers tenant isolation, the money
representation, document numbering under concurrency, the NIC protocol and why
the job queue lives in Postgres.
