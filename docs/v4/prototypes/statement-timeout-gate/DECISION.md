# The runtime enforces no server-side statement timeout

Design record for the interstitial gate the tenant-share decision pulled
forward (`docs/v4/prototypes/tenant-share-control/DECISION.md`). It records the
gate's shape, its measured evidence plan, and what it risks breaking.

This record decides. It writes no production code, opens no slice branch, and
changes no ADR, public projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`. **That base is 148
commits behind current `feat/v4` and every code claim below still holds**:
`git diff --name-only <base>..HEAD -- packages/` is empty, so every source file
this record cites is byte-identical to what it was measured against.

**That claim originally covered `tests/` too and no longer can.** `65643c1c`, the
Studio descope, changed one test file —
`tests/type/beta01-generated-contract.test.ts` — by removing the `"apps/studio"`
workspace entries alongside the deleted application. It is a workspace-list
edit, not a behavioural one, and this record cites nothing in it. The narrower
claim is the true one and is what the gate's measurements actually rest on.

## What this record decides, in three parts

Stated here because the reasoning below reached it through several corrections,
and a reader should not have to reconstruct the current position from them.

1. **Transaction-scoped `set_config` wherever a transaction already exists** —
   Mutation, relational, and the durable kernel transactions. This is the only
   part that gives the framework a bound it _guarantees_ rather than inherits.
2. **A database- or role-level baseline for everything else**, as a deployment
   requirement asserted in conformance rather than serving-path code. It reaches
   the five bare-statement reads, which the transaction-scoped mechanism cannot.
3. **No wrap for those five reads.** Four are `run_id` point lookups that cannot
   grow with the table and the fifth, `admit`, is the scheduler rather than an
   operator surface.

Item 3 reversed an earlier decision to wrap them, and the section at "The edge
that decides the gate's real scope" records why and what would restore it — the
run worklist shipping as a bare statement, or a deployment target that cannot set
a database default.

## This is a defect, not a feature

Two accepted bounds exist and nothing server-side makes either true.

- ADR-0013 accepts that "retry, exponential backoff, full jitter, attempt
  timeout, cancellation, dead-letter inspection, concurrency, payload/result
  bytes, history, retry horizon, and retention are finite."
- The Mutation program declares `limits: { rows: 100, durationMilliseconds:
5_000 }` (`packages/runtime/src/mutation/postgres-program-types.ts:132`).

What actually enforces them: three client-side readers, not the one an earlier
revision named. `AbortSignal.timeout(5_000)`
(`packages/runtime/src/mutation/postgres.ts:159`) with `query.cancel()` (`:66`);
a wall-clock check immediately before `COMMIT` (`:336`); and two more in
`packages/runtime/src/mutation/collection.ts:199` and `:202`, sandwiching the
`await input.query(...)` between them. All three are assertions taken _around_ an
uninterruptible await, so they convert a sixty-second transaction into a
sixty-second transaction followed by a throw. The threefold appearance of
enforcement is worth naming as a plausible reason this gap survived, and as three
checks an implementer must reconcile when a real bound lands.
A PostgreSQL cancel request is advisory and racy — it asks the backend to stop
and the backend may not. So a pathological statement holds a backend and a pool
slot for as long as PostgreSQL wants, and the declared bound is enforced
nowhere — measured below, it does not even bound the caller's wait.

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
backend from another connection. The runtime carries **neither**.

An earlier revision attributed the runtime's cancel to `executeAbortable` at
`postgres-session.ts:57`–`:62`. That is **compiler** code, and the runtime does
not import it — `grep -rn "postgres-session" packages/runtime/src` is empty. The
runtime has two independently written helpers, and they differ in a way that
matters:

- `packages/runtime/src/mutation/postgres.ts:58`–`:74` calls `query.cancel()`
  and nothing else.
- `packages/runtime/src/relational/postgres.ts:38`–`:58` takes a `disconnect`
  callback, which the relational path supplies as
  `transaction.close({ timeout: 0 })` (`:91`–`:93`) — it drops the connection.

So the Mutation path is the weaker of the two, which is consistent with the
measurement below: closing the socket at least settles the caller's promise,
while `cancel()` alone leaves it pending. Neither stops the backend.

**Measured, not asserted.** Against PostgreSQL 17.10 through Bun 1.3.14, a
`SELECT pg_sleep(20)` was started, then cancelled through the same
`query.cancel()` the runtime uses, while a second connection watched
`pg_stat_activity`:

| moment                                                 | active sleeping backends |
| ------------------------------------------------------ | ------------------------ |
| before the client cancel                               | 1                        |
| **2 s after `query.cancel()`**                         | **1**                    |
| after `pg_cancel_backend(pid)` from another connection | 0                        |

The backend kept running. Only the server-side cancel ended it, rejecting with
errno `57014`, `canceling statement due to user request`, from
`ProcessInterrupts`. This is the claim the whole gate rests on and it is the one
that survived checking.

**Re-verified, and the client does not give up either.** An earlier revision of
this section read "the client gave up and the backend kept running", which
implies the caller at least stops waiting. Re-measured in the exact shape the
Mutation path uses — `session.unsafe(...).execute()` inside `sql.begin`, awaited
directly, with an abort listener calling `query.cancel()` — against PostgreSQL
17.10 through Bun 1.3.14, cancelling 800 ms into a `pg_sleep(9)`:

| moment        | sleeping backend | caller                   |
| ------------- | ---------------- | ------------------------ |
| t = 3,000 ms  | still active     | still pending            |
| t = 10,000 ms | ended on its own | **resolved at 9,015 ms** |

The statement ran its full duration and returned **success**. Neither call site
races the signal against the query: `packages/runtime/src/mutation/postgres.ts:70`
and the compiler's `executeAbortable`
(`packages/compiler/src/postgres-session.ts:65`) both `return await query`.

_Both line numbers were wrong here until checked against content._ They pointed
at `:72` and `:66`, which are the `removeEventListener` and `} finally {` lines
two and one below the statements the sentence describes. Each resolved to a real
line inside the right function, so an audit that checks a citation exists and is
within the file passes them. Only reading the cited line catches it. The
abort listener fires, `cancel()` does nothing, and the code keeps awaiting the
same promise.

So the declared 5,000 ms bound holds neither the backend, nor the pool slot, nor
the caller's wait, and exceeding it raises no error anywhere: a Mutation that
runs ten times its declared budget returns a normal result late. That also
sharpens "what this risks breaking" below — today's failure mode is a silent
slow success, and the gate converts it into a visible rollback.

The stand-in is disclosed: the probe drove an `AbortController` rather than the
shipped `AbortSignal.timeout(5_000)`, since both deliver the same event to the
same listener. What is measured is the shape, not the shipped Mutation end to
end.

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
| `admit`        | `packages/runtime/src/durable/postgres-kernel.ts:357`      |
| `inspect`      | `postgres-kernel.ts:652`                                   |
| `events`       | `postgres-kernel.ts:694`                                   |
| effects `read` | `packages/runtime/src/durable/postgres-effects.ts:193`     |
| `audit`        | `packages/runtime/src/durable/postgres-maintenance.ts:384` |

A transaction-local `set_config` cannot reach them. They are also, not
coincidentally, four of the five surfaces BETA-09's inspection contract is built
on — the operator-facing reads, which are exactly the ones an operator runs
against a large or unhealthy database.

**Decision, revised — and the revision is the point.** An earlier version of this
line read: "the gate covers both, by two different means rather than by
pretending one mechanism suffices: transaction-scoped `set_config` where a
transaction already exists, and an explicit wrap for those five." Three of that
sentence's premises were later corrected in this same record, and the conclusion
was left standing on them. Correcting a premise without revisiting what it
carried is its own failure, distinct from leaving a stale claim in a second file,
and this record had it.

What changed beneath it:

- The wrap was justified by latency on operator-facing reads run against an
  unhealthy database. Four of the five are `run_id` point lookups that cannot
  grow with the database.
- The tax was said to be unavoidable without pool ownership. A database- or
  role-level default avoids it entirely, fires on bare statements, needs no
  superuser, and still lets a transaction set something tighter.
- The two numbers the wrap would have installed were a wrong unit and a wrong
  scope.

**So the decision is now:**

1. **Transaction-scoped `set_config` on every path that already has a
   transaction** — Mutation, relational, and the durable kernel transactions.
   Unchanged, and it is the only part that gives the framework a bound it
   guarantees rather than inherits.
2. **A database- or role-level baseline for everything else**, named as a
   deployment requirement and asserted in conformance rather than implemented in
   the serving path. It covers the five bare reads at no round-trip cost.
3. **No wrap for the five bare reads.** It buys a framework guarantee over a
   deployment-supplied baseline, on four reads that are structurally bounded and
   one — `admit` — that is the scheduler rather than an operator surface.

**What would overturn item 3**, and it is worth stating because it is the part
that reversed: the run worklist landing as a bare statement. That is the one read
in this design whose cost grows with the table, it does not exist yet
(`docs/v4/implementation/beta09/inspection-contract.md` D3), and if it
ships without a transaction the wrap becomes the cheapest way to bound it. A
deployment target that cannot set a database default would also restore item 3,
since the baseline is then unavailable.

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
PostgreSQL project as a conformance target, so the wrap is nearly free locally
and materially expensive remotely, and the gate should measure against the
managed target before fixing the shape, not only against a container.

**But "these five are the operator-facing reads … run against a database that is
already unhealthy" overstated what they are.** Their predicates say otherwise:
`inspect` (`postgres-kernel.ts:652`), `events` (`:694`), effects `read`
(`postgres-effects.ts:193`), and `audit` (`postgres-maintenance.ts:384`) are all
`WHERE application_name = $1 AND run_id = $2` — point lookups against one run's
primary key or its prefix. Only `admit` (`postgres-kernel.ts:357`) is
`WHERE application_name = $1` with no run scope, and `admit` is the scheduler,
not a surface an operator calls.

So four of the five are structurally bounded and do not grow with the database,
which weakens the latency worry for exactly the reads the wrap is aimed at. The
surface that would genuinely be unbounded is the run worklist BETA-09 decided
(`docs/v4/implementation/beta09/inspection-contract.md` D3), and it does
not exist in the tree yet. The gate should say plainly that its expensive case is
a read nobody has written.

**What this rules out.** Any mechanism that adds statements pays the same
round-trip tax, including the `cancelBackendOnAbort` alternative below, which
needs a reserved connection.

**An earlier revision claimed the only tax-free shape is a connection-level
`SET` per checkout, which the framework cannot do. That is false, and measuring
it changes what the wrap is for.** A database- or role-level default needs no
pool ownership and no superuser. Measured on PostgreSQL 17.10 with a
non-superuser role (`rolsuper = f`):

| probe                                                          | result                   |
| -------------------------------------------------------------- | ------------------------ |
| `ALTER ROLE lowpriv SET statement_timeout='150ms'`, new login  | `SHOW` reads **150ms**   |
| bare `SELECT pg_sleep(2)`, outside any transaction             | **canceled by timeout**  |
| `set_config('statement_timeout','50ms',true)` in a transaction | still overrides, tighter |

The third row is what keeps the per-path design intact: a baseline does not
prevent a path from setting a stricter bound. The second row is the important
one — **a default fires on bare statements**, which is exactly the hole the five
uncovered reads represent and which transaction-scoped `set_config` cannot
reach.

What the framework cannot do is _guarantee_ it, since it is a deployment-time
action rather than serving-path code. So the honest framing is not "the tax is
unavoidable" but: a deployment can supply a free baseline covering every path
including the bare reads, and the wrap is only needed where the framework must
guarantee a bound itself, or wants one tighter than the baseline. That weakens
the case for wrapping the five reads specifically, and it is the question the
evidence plan should settle before the wrap is built.

## A second finding: maintenance can block without bound

`readRun` takes `FOR UPDATE` without `SKIP LOCKED`
(`packages/runtime/src/durable/postgres-maintenance.ts:160`). Two concurrent
maintenance commands against the same run therefore serialize, and the loser
waits — with **no `lock_timeout` anywhere in the runtime**.

**Updated after BETA-09 merged (#326).** This finding was written against
`lockRun` at `:111`. The slice renamed that function `readRun`, gave it a
`locking` parameter, and made the lock conditional. The finding survives the
rename and narrows: all three commands still take `FOR UPDATE` once their
authorization check passes — `:342`, `:430` and `:493` each call `readRun` with
the default `locking = true`, immediately after `if (refusal) return refusal`.
Two authorized commands against one run still serialize. What the slice removed
is the _unauthorized_ caller's ability to hold that lock, by reading with
`locking: false` on the denial path at `:316`.

**The slice's own comment assumes the bound this gate would create.** The
justification at `:141`–`:146` says a second maintenance command "would wait out
`lock_timeout` behind it." Nothing sets one: that comment is the only occurrence
of the string in `packages/runtime/src`, and `configurePostgresTimeouts` is
still called from exactly two places, both compiler-side
(`packages/compiler/src/schema/postgres/apply.ts:251`,
`packages/compiler/src/seed/postgres/apply.ts:231`). So the implementers reached
this record's premise independently, and then assumed the timeout it argues for
already existed. That is corroboration of the reasoning and evidence for its
urgency in the same sentence.

**Measured, and the two gaps compound.** One session held a row `FOR UPDATE` for
six seconds while another attempted the same lock: the waiter blocked for
**5,706 ms**, the holder's full remaining duration, returned **no error**, and
`SHOW lock_timeout` read **`0`**.

So the wait is not unbounded in isolation — it is bounded by how long the holder
holds. But the holder's duration is itself unbounded, because nothing sets a
`statement_timeout` either. **Either gap alone is survivable; together the wait
is genuinely without limit**, and a maintenance command can block behind a
statement that will never be stopped.

That is the argument for setting both rather than a convention borrowed from the
compiler's helper. `resolvePostgresControl` already pairs them and enforces
`lockTimeoutMs < statementTimeoutMs`
(`packages/compiler/src/postgres-session.ts:29`–`:34`), which is the right shape
for the same reason: a statement timeout alone converts an unbounded lock wait
into a slower unbounded wait, and a lock timeout alone still leaves the holder
running forever.

The durable claim path is unaffected because it uses `FOR UPDATE SKIP LOCKED`
(`postgres-kernel.ts:421`), which never waits. **That mitigation was measured
too, rather than assumed, because it is what scopes the finding.** With one row
held `FOR UPDATE` for four seconds, a concurrent `FOR UPDATE SKIP LOCKED`
returned in **6 ms** with rows `[2,3]` — the held row skipped, no wait, no
error.

So the two halves of the lock analysis are both evidenced: maintenance waits for
the holder's full duration with no timeout, and the claim path steps around a
held row immediately.

**But "specific to maintenance" was wrong, and the search behind it was too
narrow.** An earlier revision scoped the finding to maintenance on the strength
of having checked the durable claim path. It did not check the Mutation
lowering, which generates a second bare `FOR UPDATE` for every keyed collection
`get` — `SELECT TRUE AS "qp_locked" FROM <table> WHERE <key predicates> LIMIT 1
FOR UPDATE` (`packages/compiler/src/mutation/postgres.ts:138`), with no
`SKIP LOCKED` and no `NOWAIT`. It executes at
`packages/runtime/src/mutation/collection.ts:242` inside
`BEGIN ISOLATION LEVEL READ COMMITTED`
(`packages/runtime/src/mutation/postgres.ts:181`), and the lock is held until
`COMMIT` (`:339`).

Two things make this the worse case rather than the milder one. Its predicates
come from `operation.keyFields` alone
(`packages/compiler/src/mutation/postgres.ts:72`–`:75`), while Policy predicates
go into the _read_ that runs after it — the lifecycle is literally
`["keyedRowLock", "freshPolicyRead", …]` (`:131`–`:136`). So a caller reaches a
blocking, unbounded row lock on a row named by a supplied key **before Policy is
evaluated**, holding a reserved pool slot for the whole wait. And it sits on the
highest-volume tenant-reachable path rather than on an operator command.

The compounding argument above applies here verbatim, which makes this the
strongest single case for the `lock_timeout` half of the gate. What the earlier
scoping got right is narrower than what it claimed: the durable _claim_ path is
unaffected.

## The value is per path, and one of them must be measured

A single global runtime timeout would be wrong, because the paths have
different legitimate durations and only some of them have an accepted bound.

**Both numbers an earlier revision proposed to ship were scope errors, and the
record's own "derive, do not choose" rule is what they break.**

- **Mutation: 5,000 ms — wrong unit.** `statement_timeout` bounds a _statement_;
  `durationMilliseconds: 5_000` bounds a _transaction_. A Mutation transaction
  runs many statements between `BEGIN`
  (`packages/runtime/src/mutation/postgres.ts:181`) and `COMMIT` (`:339`) — the
  receipt insert, the business statements, the kernel marker, the dispatch
  acceptance, the receipt update. Setting the GUC to 5,000 permits a transaction
  of 5,000 ms × the statement count. It does not make the declared number true;
  it installs a looser, differently shaped bound and calls it the same number.
- **Durable attempt: wrong scope.** The attempt does not run inside a statement
  or a transaction. The claim transaction commits first — ADR-0013 states it as
  a decision, "commits before user code" (`docs/adr/0013:32`) — and
  `worker.ts:334` invokes `runAttempt` after that commit. No `statement_timeout`
  can bound it. The attempt deadline is already enforced, by the heartbeat
  aborting on `deadlineExpired`.

So neither of the two "already-accepted numbers that are currently untrue" is a
number this gate can install. What the GUC _can_ bound is a single statement,
and the honest derivation is per-path from the measured statement tail — which
is what the evidence plan below already asks for, and which the earlier bullets
short-circuited.

- **Query: unknown, and it must not be invented.** The framework fixes no query
  duration. The `first` page bound is author-declared — the compiler requires a
  codec `maximum` and fixes no number
  (`packages/compiler/src/relational/postgres/index.ts:377`, `:438`). Choosing a
  query timeout without measuring is precisely the failure BETA-08's first round
  was blocked for: pinning a number nothing derives.

So the gate measures **all three** before pinning any, rather than transplanting
two numbers across a unit and a scope boundary. That is slower than the earlier
plan and it is the plan the record's own rule requires.

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
3. **Falsify the enforcement, on both mechanisms.** The transaction-local
   `set_config` and the deployment baseline fail differently and must each be
   driven; a test that only exercises the first proves nothing about the bare
   reads. A test that issues a deliberately slow statement
   — `pg_sleep` beyond the bound — must fail with a PostgreSQL timeout, and must
   fail _differently_ with the GUC removed. Without that, the gate proves only
   that nothing broke.
4. **Prove the baseline covers the five bare reads — not that a wrap does.**
   This item was written for the superseded decision to wrap them, and the
   revision above removed that wrap; leaving it would have the gate prove a
   mechanism it no longer ships. What replaces it is a conformance assertion,
   because the baseline is a deployment property rather than framework code:
   connect as the application role, `SHOW statement_timeout`, assert it is
   finite, and assert a deliberately slow bare statement is cancelled by it.
   The assertion must fail when the database or role default is absent, which is
   the whole point of moving the guarantee out of the serving path — a
   deployment that skips it must not pass silently.
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

**Superseded: wrapping five bare reads in transactions purely to carry a GUC.**
This was taken, and the decision above reverses it — item 3 is "no wrap for the
five bare reads". Two of its premises failed: the reads are not
"operator-facing … against an unhealthy database" but four `run_id` point
lookups plus the scheduler, and a database or role default closes the same hole
with no round trip. The paragraphs that follow belong to this superseded call
and are kept because the `cancelBackendOnAbort` finding in them survives on its
own.

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

**Superseded: pinning Mutation and attempt timeouts now while deferring the
query one.** Taken on the ground that two of the three were already-accepted
numbers merely going unenforced. Neither was. `statement_timeout` bounds a
statement while `durationMilliseconds` bounds a transaction, and the durable
attempt runs outside any transaction at all — so the gate could install neither
number. The evidence plan now measures all three paths before pinning any, which
is what "derive, do not choose" required in the first place.

**Treating this as a defect rather than a feature — this one stands, on a
narrower ground than it was taken.** It changes runtime behaviour, which normally
argues for a tracer slice. The original reason cited "both pinned numbers", which
the correction above removes. What survives is the gap itself: ADR-0013 accepts a
finite attempt timeout and the Mutation program declares a 5,000 ms bound, and
the runtime enforces no server-side timeout of any kind, so the gate makes an
accepted bound enforceable rather than adding a capability. What would overturn
it: evidence
that every supported deployment target already sets a server-side timeout on
the pool, in which case the framework is right not to and the accepted bounds
should say so instead.
