# Architecture

## Shape

```
                    ┌──────────────────────────────┐
  browser ────────► │  apps/api  (Fastify)         │
                    │  · session + API-key auth    │
                    │  · serves the built web app  │
                    └───────┬──────────────┬───────┘
                            │              │
                    ┌───────▼───────┐  ┌───▼────────────┐
                    │  packages/    │  │  Postgres      │
                    │  core         │  │  · data        │
                    │  · services   │  │  · job queue   │
                    │  · compliance │  │  · audit log   │
                    └───────┬───────┘  └───▲────────────┘
                            │              │
                    ┌───────▼──────────────┴───────┐
                    │  apps/worker                 │
                    │  · IRN, e-Way Bill, PDFs     │
                    │  · expiry sweep              │
                    └───────┬──────────────────────┘
                            │
                    ┌───────▼──────────────────────┐
                    │  packages/nic-client         │
                    │  → einvoice1.gst.gov.in      │
                    │  → ewaybillgst.gov.in        │
                    └──────────────────────────────┘
```

## Why the business logic is not in the HTTP layer

Every operation lives in `packages/core` as a service method taking an
`AuthContext` as its first argument. The API is a thin translation layer:
parse, call, serialise. The worker calls the same methods with a system
context. A mobile app will call the same HTTP endpoints the web app does.

The practical consequence: there is exactly one place where an invoice gets
finalized, and it is not reachable without a tenant context.

## Tenant isolation

Three layers, deliberately redundant:

1. Every tenant-owned table has a `tenant_id` column with a foreign key.
2. Every query is built with `scoped(ctx, table)` or `scopedById(...)`, which
   inject `tenant_id = ctx.tenantId`. Writes go through `withTenant(...)`,
   which throws if the values carry a foreign tenant.
3. `assertSameTenant(ctx, row)` is available as a last check on anything loaded
   by a path that did not go through the helpers.

The helpers are typed against the Drizzle table, so a table without a
`tenantId` column will not compile as an argument.

## Money

Integer **paise**, stored as `bigint`. Never a float, never a decimal string in
arithmetic. `bigint` rather than `integer` because a single invoice can exceed
the 32-bit ceiling of about ₹2.1 crore.

The tax engine (`packages/shared/src/gst/calculate.ts`) is pure: same inputs,
same outputs, no I/O. It runs in the browser for the live preview, in the API
on save, and in the worker when building the portal payload. There is no second
implementation to drift.

Rounding rules, applied in this order and nowhere else:

- every intermediate rounds to whole paise, half-up;
- CGST and SGST are derived so their sum is exactly the total GST, even when
  the total is odd;
- round-off to the nearest rupee happens once, at grand-total level.

## Document numbering

GST requires a consecutive series, unique per registration per financial year.
Numbers are allocated inside the same transaction that finalizes the invoice,
under `SELECT … FOR UPDATE` on the sequence row. Two concurrent finalizations
serialise; a crash rolls back both the number and the status, so a number is
never burned.

A series cannot be moved backwards through the API — reusing a consumed number
would break the consecutiveness requirement.

## Government integration

`packages/gst-gateway` defines provider interfaces. `packages/nic-client`
implements them against the real NIC protocol: an RSA-wrapped auth payload, a
portal-issued session key (SEK), and AES-256-ECB on every subsequent body. The
scheme is dated, but it is what the portal implements.

Four properties matter:

- **Nothing is fabricated.** No credentials, no public key, no network — the
  call fails with `CREDENTIALS_MISSING` or `GATEWAY_ERROR`. There is no mock
  provider wired into any runtime path.
- **Document-creating calls are sent once.** Reads retry; `generateIrn` and
  `generate` (EWB) do not, because a timeout on a request the portal actually
  processed would otherwise file a second document.
- **Duplicates are recovered, not failed.** IRP error 2150 and EWB 604 mean the
  portal already holds this document. The client reads the existing one back
  and reports success, which is the correct answer for a retried job.
- **Tokens are shared.** The portal rate-limits authentication, so tokens are
  cached in Postgres (encrypted) rather than per-process.

## Job queue

Postgres, not Redis — one fewer thing to run, back up and pay for at this
scale. `SELECT … FOR UPDATE SKIP LOCKED` for claiming; an `idempotency_key`
unique index so re-enqueueing the same logical operation collapses onto the
existing row.

Failure handling distinguishes retryable (timeout, 5xx, rate limit) from
permanent (payload rejected, credentials missing). Permanent failures park
immediately and raise an alert; retrying them only repeats the answer.

## Audit trail

`audit_logs` is append-only: action, entity, actor, exact timestamp, and a
field-level before/after diff. Written for every state change, by users and by
the worker alike — the worker's entries are attributed to `system:worker`.

`ewb_events` holds the same for the e-Way Bill lifecycle specifically, with the
portal request and response for each action, because that is what gets
questioned at a checkpoint.
