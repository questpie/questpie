# The runtime enforces no server-side statement timeout

Design record for the interstitial gate the tenant-share decision pulled
forward (`docs/v4/prototypes/tenant-share-control/DECISION.md`). It records the
gate's shape, its measured evidence plan, and what it risks breaking.

This record decides. It writes no production code, opens no slice branch, and
changes no ADR, public projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## This is a defect, not a feature

Two accepted bounds exist and nothing server-side makes either true.

- ADR-0013 accepts that "retry, exponential backoff, full jitter, attempt
  timeout, cancellation, dead-letter inspection, concurrency, payload/result
  bytes, history, retry horizon, and retention are finite."
- The Mutation program declares `limits: { rows: 100, durationMilliseconds:
5_000 }` (`packages/runtime/src/mutation/postgres-program-types.ts:132`).

What actually enforces them: a client-side `AbortSignal.timeout(5_000)`
(`packages/runtime/src/mutation/postgres.ts:159`) and `query.cancel()` (`:66`).
A PostgreSQL cancel request is advisory and racy — it asks the backend to stop
and the backend may not. So a pathological statement holds a backend and a pool
slot for as long as PostgreSQL wants, and the declared bound is a client-side
hope.

`configurePostgresTimeouts` already exists
(`packages/compiler/src/postgres-session.ts:39`) with defaults of 5,000 ms
`lock_timeout` and 30,000 ms `statement_timeout` (`:23`–`:24`). It is called
from exactly two places, both compiler-side:
`packages/compiler/src/schema/postgres/apply.ts:251` and
`packages/compiler/src/seed/postgres/apply.ts:231`. `statement_timeout` appears
nowhere in `packages/runtime/src`.

So the migration and seed paths are protected and the serving path is not — and
the asymmetry is wider than a missing timeout.

**The compiler also issues a real server-side cancel; the runtime does not.**
`cancelBackendOnAbort` (`packages/compiler/src/postgres-session.ts:71`) runs
`select pg_catalog.pg_cancel_backend($pid)` from a _second_ connection when the
signal aborts (`:80`). It is called from exactly the same two places as the
timeouts — `packages/compiler/src/schema/postgres/apply.ts:245` and
`packages/compiler/src/seed/postgres/apply.ts:225`.

So the compiler's DDL and seed sessions carry **two** independent defences: a
server-side `statement_timeout`, and an out-of-band cancel that reaches the
backend from another connection. The runtime carries **neither**. Its
`query.cancel()` is the client-side abort inside `executeAbortable`
(`postgres-session.ts:57`–`:62`), which asks the driver to stop waiting.

**Measured, not asserted.** Against PostgreSQL 17.10 through Bun 1.3.14, a
`SELECT pg_sleep(20)` was started, then cancelled through the same
`query.cancel()` the runtime uses, while a second connection watched
`pg_stat_activity`:

| moment                                                 | active sleeping backends |
| ------------------------------------------------------ | ------------------------ |
| before the client cancel                               | 1                        |
| **2 s after `query.cancel()`**                         | **1**                    |
| after `pg_cancel_backend(pid)` from another connection | 0                        |

The client gave up and the backend kept running. Only the server-side cancel
ended it, rejecting with errno `57014`, `canceling statement due to user
request`, from `ProcessInterrupts`. This is the claim the whole gate rests on
and it is the one that survived checking.

The GUC mechanism was checked the same way: inside a transaction,
`set_config('statement_timeout','150ms',true)` aborts a two-second sleep with
`canceling statement due to statement timeout`, and after `ROLLBACK`
`statement_timeout` reads `0` — enforced, and transaction-scoped without
leaking to the pooled connection.

An earlier revision of this record described the gap as a missing timeout. It is
a missing layer _and_ a missing timeout, and the second half was already built.

## The mechanism already exists in the runtime

The framework never constructs the connection pool — every runtime PostgreSQL
module takes `SQL` as a type-only import from `bun`, so the host owns pool
sizing and any connection-level configuration. That rules out setting the GUC
at checkout.

It does not rule out setting it per transaction, and **the runtime already does
exactly this once**: `durableKernelMarkerStatement` is
`SELECT set_config('questpie.durable_kernel', 'on', true)`
(`packages/runtime/src/durable/rows.ts:24`), whose third argument `true` means
transaction-local. Every durable kernel transaction runs it
(`markDurableKernelTransaction`, `:26`).

So the shape is: **transaction-scoped `set_config`, on the pattern the durable
kernel already proves.** No new dependency, no pool ownership, no connection
hook.

It fits the main read path cleanly too. Relational queries reserve a connection
and open an explicit `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`
(`packages/runtime/src/relational/postgres.ts:83`), so the timeout is one
statement after the `BEGIN` that is already there.

## The edge that decides the gate's real scope

Five durable reads run **outside any transaction**, as bare statements on the
pool:

| Read           | Site                                                       |
| -------------- | ---------------------------------------------------------- |
| `admit`        | `packages/runtime/src/durable/postgres-kernel.ts:455`      |
| `inspect`      | `postgres-kernel.ts:687`                                   |
| `events`       | `postgres-kernel.ts:729`                                   |
| effects `read` | `packages/runtime/src/durable/postgres-effects.ts:193`     |
| `audit`        | `packages/runtime/src/durable/postgres-maintenance.ts:384` |

A transaction-local `set_config` cannot reach them. They are also, not
coincidentally, four of the five surfaces BETA-09's inspection contract is built
on — the operator-facing reads, which are exactly the ones an operator runs
against a large or unhealthy database.

**Decision.** The gate covers both, by two different means rather than by
pretending one mechanism suffices: transaction-scoped `set_config` where a
transaction already exists, and an explicit wrap for those five.

**The wrap's cost is measured rather than asserted.** 300 iterations after 50
warm-up rounds, against PostgreSQL 17.10 over TCP to a container on the same
machine, reading one `durable_runs` row by primary key:

| Shape                                          | Per read                      |
| ---------------------------------------------- | ----------------------------- |
| bare statement on the pool                     | 0.142 ms                      |
| wrapped in a transaction carrying `set_config` | 0.376 ms                      |
| **delta**                                      | **0.234 ms, a 2.6× increase** |

**The number that matters is not 0.234 ms.** The delta is round-trip-bound: the
wrap turns one statement into four — `BEGIN`, `set_config`, the read, `COMMIT` —
so it scales with network latency rather than with the query. On this loopback
measurement a round trip is worth roughly 0.08 ms and the cost is negligible.
Against a managed PostgreSQL at 1–5 ms round trip, the same wrap costs 3–15 ms
per read.

That sharpens the trade rather than settling it. ADR-0014 names a managed
PostgreSQL project as a conformance target, and these five are the
operator-facing reads — the ones run against a database that is already
unhealthy, where added latency is least welcome. So the wrap is nearly free
locally and materially expensive remotely, and the gate should measure against
the managed target before fixing the shape, not only against a container.

**What this rules out.** Any mechanism that adds statements pays the same
round-trip tax, including the `cancelBackendOnAbort` alternative below, which
needs a reserved connection. The only shape that avoids it entirely is a
connection-level `SET` applied once per checkout — which the framework cannot do,
because it does not own the pool. That constraint is the reason this gate is
awkward, and it is worth stating plainly rather than rediscovering.

## A second finding: maintenance can block without bound

`lockRun` takes `FOR UPDATE` without `SKIP LOCKED`
(`packages/runtime/src/durable/postgres-maintenance.ts:111`). Two concurrent
maintenance commands against the same run therefore serialize, and the loser
waits — with **no `lock_timeout` anywhere in the runtime**. The wait is
unbounded.

The durable claim path is unaffected because it uses `FOR UPDATE SKIP LOCKED`
(`postgres-kernel.ts:504`), which never waits. This is specific to maintenance.

The compiler's helper already pairs the two timeouts and enforces
`lockTimeoutMs < statementTimeoutMs`
(`packages/compiler/src/postgres-session.ts:29`–`:34`). The gate sets both, for
the same reason the compiler does: a statement timeout alone converts an
unbounded lock wait into a slower unbounded wait.

## The value is per path, and one of them must be measured

A single global runtime timeout would be wrong, because the paths have
different legitimate durations and only some of them have an accepted bound.

- **Mutation: 5,000 ms**, because that is the bound the Mutation program already
  declares. The GUC makes an existing declared number true rather than
  introducing one.
- **Durable attempt: the attempt deadline the kernel already computes**, for the
  same reason.
- **Query: unknown, and it must not be invented.** The framework fixes no query
  duration. The `first` page bound is author-declared — the compiler requires a
  codec `maximum` and fixes no number
  (`packages/compiler/src/relational/postgres/index.ts:377`, `:438`). Choosing a
  query timeout without measuring is precisely the failure BETA-08's first round
  was blocked for: pinning a number nothing derives.

So the gate ships the two derived values and **measures** the third before
pinning it.

## What this risks breaking

Stated plainly, because it is the reason this is its own gate rather than a
line folded into another slice.

A `statement_timeout` does not slow a query down; it kills it. Every statement
that today succeeds slowly begins failing. The population at risk is real: a
cold cache, a large tenant's page, a first query after a deploy, a plan
regression after statistics change. Each of those is a legitimate slow query,
not a pathological one.

The failure is also mid-transaction for the Mutation path, so a timeout is a
rollback — correct behaviour, and identical to what the client-side abort
intends, but it converts a slow success into a visible failure the caller must
handle.

This is why the gate cannot be justified by reasoning alone. It needs the
distribution.

## Measured evidence plan

1. **Establish the tail before changing anything.** Instrument the existing
   scenario and load suites to record per-path statement duration, and report
   p50, p95, p99, and max for the Mutation path, the relational query path, and
   the five durable reads. The BETA-08 contention scenario is the natural host:
   it already drives 64 runs against 8 workers.
2. **Derive, do not choose.** Any timeout this gate pins is derived from the
   measured maximum by the same rule BETA-08 used —
   `ceil(observed × multiplier / quantum) × quantum` — with the derivation
   asserted in-test rather than stated in prose.
3. **Falsify the enforcement.** A test that issues a deliberately slow statement
   — `pg_sleep` beyond the bound — must fail with a PostgreSQL timeout, and must
   fail _differently_ with the GUC removed. Without that, the gate proves only
   that nothing broke.
4. **Prove the five uncovered reads are covered.** Same probe against each of
   the bare-statement reads, since those are the ones the transaction-scoped
   mechanism cannot reach.
5. **Prove the lock bound.** Two concurrent maintenance commands on one run,
   with the loser asserted to fail on `lock_timeout` rather than wait.
6. **Prove the cancel layer independently of the timeout.** A statement aborted
   client-side must be shown to actually stop server-side — assert the backend
   is gone from `pg_stat_activity`, not merely that the client promise
   rejected. This is the assertion that distinguishes a real cancel from a
   client giving up, and nothing in the runtime asserts it today.
7. **Report what the change would have killed.** Run the measured tail against
   the proposed bound and state how many observed statements would now fail.
   If that number is not zero, the bound is wrong or the query is.

## Judgment calls

**Wrapping five bare reads in transactions purely to carry a GUC.** It costs a
round trip on the operator-facing reads. Taken because the alternative is a
timeout contract with a hole in exactly the surface an operator uses against an
unhealthy database.

I named as the thing that would overturn this "a per-statement mechanism that
does not need a transaction." Verifying the record afterwards found one:
`cancelBackendOnAbort` needs a **reserved connection**, not a transaction. That
refines the call rather than reversing it, because for the five bare durable
reads a reservation costs what a transaction costs — they run straight on the
pool today (`input.sql.unsafe(...)`) and would have to reserve either way.

Where it does change the answer is the relational path, which **already**
reserves (`packages/runtime/src/relational/postgres.ts:80`). That path can carry
both defences at no additional round trip, and should, since it is the
highest-volume statement in the system.

**Pinning Mutation and attempt timeouts now while deferring the query one.** It
ships an asymmetric contract, which is less tidy than waiting and pinning all
three together. Taken because two of the three are already-accepted numbers
that are currently untrue, and making an accepted bound true should not wait on
a measurement for a different path. What would overturn it: evidence that the
query path is where the real exposure is, in which case the whole gate should
wait for the distribution.

**Treating this as a defect rather than a feature.** It changes runtime
behaviour, which normally argues for a tracer slice. Taken because both pinned
numbers already exist in accepted authority and neither is enforced, so this
closes a gap rather than opening a capability. What would overturn it: evidence
that every supported deployment target already sets a server-side timeout on
the pool, in which case the framework is right not to and the accepted bounds
should say so instead.
