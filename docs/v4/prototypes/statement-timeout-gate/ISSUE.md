# TIMEOUT-GATE: make the accepted runtime time bounds enforceable

Tracker: **not opened.** This is the issue text; the number belongs to whoever
opens it. `api-ergonomics-gate/ISSUE.md` carries `Tracker: #301` and
`acceptance-determinism/` carries #317, and this gate has neither a number nor an
`ISSUE.md` until now — the decision existed and the thing that makes it
openable did not.

This gate is interstitial: it follows the accepted BETA-08 durable kernel and
does not count as one of the beta implementation slices. Its full reasoning,
measurements and judgment calls are in `DECISION.md` beside this file; this is
the short form.

## What it proves

1. **Two accepted bounds are enforced by nothing server-side.** ADR-0013 accepts
   a finite attempt timeout and the Mutation program declares
   `limits: { rows: 100, durationMilliseconds: 5_000 }`
   (`packages/runtime/src/mutation/postgres-program-types.ts:132`), while
   `statement_timeout` and `lock_timeout` appear nowhere in
   `packages/runtime/src`.
2. **The client-side substitute does not substitute.** Measured against
   PostgreSQL 17.10 through Bun 1.3.14: `query.cancel()` leaves the backend
   running, only `pg_cancel_backend` from a second connection ends it, and the
   caller is not released either — a `pg_sleep(9)` cancelled at 800 ms resolved
   **successfully** at 9,015 ms. Neither call site races the signal;
   `packages/runtime/src/mutation/postgres.ts:70` and the compiler's
   `executeAbortable` at `packages/compiler/src/postgres-session.ts:65` both
   `return await query`.
3. **A lock wait compounds it.** `lockRun` takes `FOR UPDATE` without
   `SKIP LOCKED` (`packages/runtime/src/durable/postgres-maintenance.ts:111`),
   and the Mutation lowering emits a second bare `FOR UPDATE` for every keyed
   collection `get` (`packages/compiler/src/mutation/postgres.ts:138`) on a
   key-only predicate, held to `COMMIT`, **before Policy is evaluated**.

## What it changes

1. Transaction-scoped `set_config` wherever a transaction already exists —
   Mutation, relational, and the durable kernel transactions. This is the only
   part the framework guarantees rather than inherits.
2. A database- or role-level baseline for everything else, as a deployment
   requirement asserted in conformance rather than serving-path code. Measured
   with a non-superuser role: it is inherited by a new login, fires on a bare
   statement outside any transaction, and still yields to a tighter
   transaction-local `set_config`.
3. No wrap for the five bare-statement reads. Four are `run_id` point lookups
   that cannot grow with the table; the fifth, `admit`, is the scheduler.

## What it must not do

Pin a number it has not measured. `statement_timeout` bounds a **statement**
while `durationMilliseconds` bounds a **transaction**, and the durable attempt
runs outside any transaction at all — ADR-0013 states the claim "commits before
user code". Both numbers an earlier revision proposed to install were therefore
scope errors, and the evidence plan measures all three paths before pinning any.

## What it risks

A `statement_timeout` does not slow a query down, it kills it. Every statement
that today succeeds slowly begins failing: a cold cache, a large tenant's page,
a first query after deploy, a plan regression. The Mutation path fails
mid-transaction, converting a slow success into a visible rollback. That is why
the evidence plan's last item is to run the measured tail against the proposed
bound and state how many observed statements would now fail — if that number is
not zero, the bound is wrong or the query is.

## Open before it can be opened

The gate needs a tracker number, and its second item is a deployment
requirement rather than code, so it needs an owner decision on where
conformance asserts it. Neither is a design question.
