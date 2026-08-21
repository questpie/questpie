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

## What this record decides, in four parts

Stated here because the reasoning below reached it through several corrections,
and a reader should not have to reconstruct the current position from them.

1. **Transaction-scoped `set_config` wherever a transaction already exists** —
   Mutation, relational, and the durable kernel transactions. This is the only
   part that gives the framework a bound it _guarantees_ rather than inherits,
   and on the **durable** paths it costs **no additional round trip**: the
   durable kernel, maintenance and effects transactions each send a `set_config`
   marker as their first statement, and `set_config` composes in one `SELECT`.
   Measured at 0.027 ms per transaction, server-side work rather than a round
   trip — see "And it costs no round trip at all" below. **The Mutation path is
   not one of them**: its marker sits inside
   `for (const dispatch of reactions.pending)`
   (`packages/runtime/src/mutation/postgres.ts:270`, marker at `:281`), so a
   Mutation that dispatches no Reaction sends no marker and there is nothing to
   fold into. There, and on the relational path, the timeout is one added
   statement after the `BEGIN` already opened.
2. **A database- or role-level baseline for everything else**, as a deployment
   requirement asserted in conformance rather than serving-path code. It reaches
   the five bare-statement reads, which the transaction-scoped mechanism cannot.
   **It reaches them only on connections opened after it is set** — a role
   default applies at login and leaves a running pool unbounded — so the
   requirement is ordering as well as configuration, and the conformance
   assertion has to read the value through a connection the application is
   already using. See the measured note under evidence-plan item 4.

   **It does not break migrations, and the reason is a call rather than a
   structure.** A role default reaches every connection the deployment opens,
   including the compiler's schema and seed apply sessions, so a 200 ms baseline
   would bound DDL that legitimately runs for minutes. It does not, because
   `configurePostgresTimeouts` raises the session ceiling to
   `statementTimeoutMs ?? 30_000` (`packages/compiler/src/postgres-session.ts:24`)
   before any DDL runs. Measured on PostgreSQL 17 with a role carrying
   `statement_timeout = '150ms'`: a fresh connection reads `150ms`, a session
   that runs `set_config('statement_timeout','30000ms',false)` reads `30s` and
   completes a one-second sleep, and a **control** connection without the
   override dies `57014` on the same sleep — so the baseline was enforcing and
   the override is what survived it.

   **The dependency is worth naming because nothing enforces it.** Migrations are
   safe under this gate only for as long as the apply paths keep calling
   `configurePostgresTimeouts` first. Remove it, reorder it after the DDL, or add
   an apply path that skips it, and every migration silently inherits the
   deployment's serving bound. The one statement that already runs ahead of it —
   `probeCommittedSession` (`packages/compiler/src/postgres-session.ts:215`), a
   `pg_backend_pid()` inside a transaction — is exposed to the baseline and far
   too small to reach it.

3. **No wrap for those five reads.** Four are `run_id` point lookups that cannot
   grow with the table and the fifth, `admit`, is the scheduler rather than an
   operator surface. **That ground is wrong for `audit`, and the decision still
   holds**: `audit` grows without limit in one run's own command count, and what
   it needs is a bound on rows, which neither a wrap nor a timeout supplies. See
   "Corrected: `audit` does not belong in that four" below.

4. **The number is not decided here; the measurements say why it cannot be one
   number, and a derived pair is offered as a candidate.** Every served statement across three subsystems sits at or under
   3.4 ms except the Mutation lock, which sits at p95 15.560 ms over six
   executions. `statement_timeout` bounds a statement including any lock wait
   inside it, and `resolvePostgresControl` requires
   `lockTimeoutMs < statementTimeoutMs`
   (`packages/compiler/src/postgres-session.ts:30`). **So the statement bound
   cannot be tighter than the longest lock wait anyone is willing to tolerate**,
   even though the work it is meant to bound is five times smaller. Tolerating a
   20 ms wait forces a statement bound above 20 ms on a path whose real work
   finishes in 3.4. See "Measured across three paths" and evidence-plan item 7.

   **A pair is now derivable, and it is offered as a candidate rather than a
   decision.** Across roughly 12,000 measured executions the largest served
   statement is a contended `COMMIT` at 23.091 ms and the largest non-`COMMIT`
   served statement is the Mutation `qp_locked` wait at 17.064 ms. Applying this
   record's own rule at the ×5 multiplier and 100 ms quantum that the shipped
   `postgresMaintenance20Ms` baseline uses:
   - `statement_timeout` = `ceil(23.091 × 5 / 100) × 100` = **200 ms**
   - `lock_timeout` = `ceil(17.064 × 5 / 100) × 100` = **100 ms**

   The pair keeps `lock_timeout` below `statement_timeout`, and by evidence-plan
   item 7 it kills nothing observed — not even the 132.532 ms fixture insert. At
   a 10 ms quantum the same rule gives 120 and 90, also valid and tighter.

   **That ordering is a semantic requirement here, not an enforced one.**
   `resolvePostgresControl` does reject `statementTimeoutMs <= lockTimeoutMs`
   (`packages/compiler/src/postgres-session.ts:30`, throwing at `:33`), but it is
   compiler code and the runtime never imports it — `grep -rn "postgres-session"
packages/runtime/src` returns nothing, as this record establishes elsewhere.
   **Nothing would stop a runtime pair from violating the ordering.** What makes
   it necessary is the mechanism rather than the check: a lock wait happens
   inside statement execution, so an inverted pair returns `57014` naming
   slowness where `55P03` would have named contention, which the attribution
   table above measures directly.

   **What the observation can and cannot settle.** It settles
   `statement_timeout`, which bounds work, and the corpus contains that work. It
   does not settle `lock_timeout`, because a lock wait is bounded by whoever
   holds the row rather than by the waiter — the probe under "A second finding"
   measured a **5,706 ms** wait against a holder that held for six seconds.
   Observation can only put a floor under the lock bound, at least the 17.064 ms
   of legitimate waiting seen here; the ceiling is a policy choice about how long
   a Mutation may block. 100 ms says roughly six times the worst legitimate wait
   observed, and nothing longer.

   **What would overturn the pair.** A cold cache, a larger fixture, or a managed
   target moving the served tail above 200 ms; or same-row Mutation contention in
   production routinely exceeding 100 ms, which would mean the lock bound is
   cutting legitimate work rather than a stuck holder. Both are measurable by
   re-running this capture under those conditions, and neither is measurable from
   the corpus in hand — warm, local, and inflated about fifty percent by the
   logging that produced it.

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
(`packages/compiler/src/postgres-session.ts:65`) both await the in-flight query
in a `try` with the listener removed in `finally` — spelled `return await query`
in the runtime and `return await executing` in the compiler.

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

**The reciprocal was not checked, and it does leak.** With the third argument
`false` the setting is session-scoped, and Bun does not reset session state when
a reservation ends: on a `max: 1` pool, `set_config('statement_timeout','30000ms',false)`
followed by `release()` and a fresh `reserve()` returned the **same backend pid**
still reading `30s`. Whoever reserves next inherits it. That is why item 1 of the
decision specifies `true`, and it is a constraint on any future proposal to set
the GUC once per connection: the framework does not own the pool, so it cannot
know who reserves next. `configurePostgresTimeouts` uses `false` legitimately —
it wants the value for a whole apply session — and is safe today only because
both call sites construct their own pool with `new SQL(...)`
(`packages/compiler/src/schema/postgres/apply.ts:238`–`:241`,
`packages/compiler/src/seed/postgres/apply.ts:216`–`:219`) rather than accepting
a caller's. **Nothing enforces that**, and pointing it at a host-supplied pool
would leave the host's connections carrying compiler timeouts.

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
(`packages/runtime/src/durable/rows.ts:138`–`:139`), whose third argument `true`
means transaction-local. Every durable kernel transaction runs it
(`markDurableKernelTransaction`, `:141`).

So the shape is: **transaction-scoped `set_config`, on the pattern the durable
kernel already proves.** No new dependency, no pool ownership, no connection
hook.

**And it costs no round trip at all, because the statement to carry it already
runs.** `set_config` composes in one `SELECT`, which the compiler's own helper
already relies on — `configurePostgresTimeouts` sets `lock_timeout` and
`statement_timeout` in a single statement
(`packages/compiler/src/postgres-session.ts:39`–`:46`). The marker can do the
same. Five call sites run it today, covering every path this gate is about:
`packages/runtime/src/durable/acceptance.ts:45`,
`packages/runtime/src/durable/postgres-kernel.ts:175`,
`packages/runtime/src/durable/postgres-maintenance.ts:136`,
`packages/runtime/src/durable/postgres-effects.ts:77`, and the Mutation
transaction at `packages/runtime/src/mutation/postgres.ts:281`.

**Corrected under adversarial review: the Mutation site does not belong in that
list.** The three durable call sites are the first statement inside their
transaction wrapper, immediately after the `query` helper is defined, so they run
on every durable transaction. The Mutation call at `:281` sits inside
`for (const dispatch of reactions.pending)` (`:270`). A Mutation that dispatches
no Reaction never runs it, and one that dispatches N runs it N times.

**And conditionality is the weaker of two reasons, which the first version of
this correction missed.** Even when a Reaction is dispatched, `:281` runs _after_
`operation.binding.execute(...)` at `packages/runtime/src/mutation/postgres.ts:256`
— the whole business body, including the `qp_locked` `… LIMIT 1 FOR UPDATE`
issued from `packages/runtime/src/mutation/collection.ts:242`. A GUC folded onto
`:281` would bound the reaction inserts, the receipt update and `COMMIT`, and
never the one statement this gate exists for. **The fold is positionally useless
on the Mutation path, not merely sometimes absent.**

**So the fold is free on the three durable paths and unavailable on the Mutation
path**, which is the highest-volume write path and the one carrying the lock. The
timeout there is one added statement after `BEGIN`
(`packages/runtime/src/mutation/postgres.ts:181`) — mandatory rather than a
fallback, and it must precede `:256` to bound anything that matters.

**The fourth call site is not a transaction wrapper.**
`packages/runtime/src/durable/acceptance.ts:45` is the first statement of
`acceptDurableDispatch`, which inherits whichever transaction calls it; on the
Mutation path that call is at `postgres.ts:301`, inside the same dispatch loop,
so it re-runs the marker moments after `:281`. It carries no transaction of its
own to fold into.

Measured on PostgreSQL 17, 400 `BEGIN`/marker/`COMMIT` cycles after 50 warm-up
rounds, comparing the shipped one-value marker against a three-value form
carrying both timeouts:

| marker statement                                          | per transaction |
| --------------------------------------------------------- | --------------- |
| `set_config('questpie.durable_kernel',…)` alone (shipped) | 0.313 ms        |
| the same plus `statement_timeout` and `lock_timeout`      | 0.340 ms        |

**The statement count does not change**, so the 0.027 ms is server-side work and
a wider result row, not a round trip. That matters more than the number: this
record's cost analysis for the wrap is explicitly round-trip-bound — "against a
managed PostgreSQL at 1–5 ms round trip, the same wrap costs 3–15 ms" — and a
fold that adds no statement does not grow with network latency. On a managed
target the wrap's cost scales and this one does not.

Enforcement and scope were checked in the same transaction: after the
three-value marker, `current_setting` read `questpie.durable_kernel = on`,
`statement_timeout = 150ms`, `lock_timeout = 50ms`; `SELECT pg_sleep(2)` inside
that transaction failed `57014`; and after it committed, the same pooled
connection read `statement_timeout = 0`. The guard value survives the fold, which
is the one thing that could have made this unsafe.

**The write check named here has since been run, and the fold passes it.** The
earlier probe confirmed only that the guard _setting_ was present, not that a
guarded write still passes its trigger. Built with the shipped
`guard_durable_kernel_write` function copied verbatim out of
`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts` and the same
`FOR EACH STATEMENT` trigger the catalog installs, then ran INSERT, UPDATE and
DELETE inside one transaction:

| marker                                    | result                                                               |
| ----------------------------------------- | -------------------------------------------------------------------- |
| none — negative control                   | `42501` questpie durable state is written only by the durable kernel |
| shipped one-value marker                  | all three writes succeed                                             |
| three-value marker carrying both timeouts | all three writes succeed                                             |

The negative control matters more than the two passes: it proves the trigger was
live for all three trials rather than absent. So the fold is safe for writes as
well as reads, on the statement-level guard the durable tables actually use.

**A note on where this ran.** The guard function is schema-qualified in the
shipped DDL, so unlike the other probes in this record it could not use a
throwaway schema name and recreated `questpie_internal` in the shared test
container, dropping what was there. That is recoverable rather than harmless —
`tests/integration/postgres/helpers/beta05-runtime.ts:41` drops the same schema
at setup, so any integration run rebuilds it — but a throwaway _database_ would
have been the right isolation and is what a repeat of this should use.

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
| `audit`        | `packages/runtime/src/durable/postgres-maintenance.ts:537` |

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

**So the decision at that point was these three parts.** The record has since
added a fourth, on why the number itself cannot be one number; "What this record
decides, in four parts" at the top is the current position and this list is kept
as the state when the wrap was reversed.

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

**"Cost grows with the table" is measured, and it overstates.** BETA-09 measured
this exact query before the Studio descope and the measurement outlived it:
`WHERE application_name = $1 AND state = 'failed' ORDER BY available_at, run_id`
plans as `Index Scan using durable_runs_claim_idx`, returns 64 rows, and runs in
**0.13 ms against 207,000 runs**
(`docs/v4/implementation/beta09/studio-purpose.md` "The index claim is
verified, not assumed", `:110`–`:114` today). The index is
`(application_name, state, available_at, run_id)`, so its leftmost prefix serves
the predicate and the trailing columns serve the `ORDER BY` — a bounded page
stops early rather than scanning.

This is the same predicate-versus-result distinction the `audit` correction
draws elsewhere in this record, applied in the opposite direction. The worklist's
predicate is not a point lookup, but its result is bounded by the page, so its
cost tracks the page and the matching state set, not the table. **What would
still restore item 3 is narrower than "the worklist ships": it is the worklist
shipping _unbounded_**, with no page limit, so the read returns every failed run.
The deployment-target half of the condition is unaffected and stands as written.

That measurement sits in a record ADR-0024 removed from the release, which is
why this gate had not cited it; `studio-purpose.md` now carries a marker saying
which of its findings outlived the descope.

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
(`postgres-effects.ts:193`), and `audit` (`postgres-maintenance.ts:537`) are all
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

**Corrected: `audit` does not belong in that four, and the record set already
said so.** "Structurally bounded" conflates two things. All four predicates are
point lookups — none scans the table, and that part stands. But the _result_ size
differs per read: `inspect` returns exactly one row (`const [row]`,
`postgres-kernel.ts:653`); `events` is capped at 1,024 by
`durable_event_sequence_bounded CHECK (sequence BETWEEN 1 AND 1024)`
(`internal-protocol-v4-sql.ts:149`); effects `read` returns one row per declared
effect name, keyed by `PRIMARY KEY (application_name, run_id, effect_name)`
(`:178`), so it is bounded by the compiled program. `audit` has no such bound.
`record()` writes a row for rejected commands as well as applied ones, no CHECK
limits the count, and no sweeper deletes them — which
`durable-evidence-gaps/FINDING.md` §6 established independently while this
paragraph was claiming the opposite.

**Measured, with the database held still.** A scratch
`durable_maintenance_commands` carrying 50,000 rows of unrelated runs throughout,
varying only how many commands one run has accumulated, PostgreSQL 17, third run
of each to discard the cold read:

| commands on one run | `audit(runId)` |
| ------------------- | -------------- |
| 1                   | 0.052 ms       |
| 100                 | 0.150 ms       |
| 1,000               | 1.420 ms       |
| 10,000              | 19.679 ms      |
| 100,000             | 98.058 ms      |

Roughly linear in the run's own row count while the table around it does not
change. **So "does not grow with the database" is true of `audit` and beside the
point**: its latency grows with caller behaviour, and the caller who grows it is
the one issuing repeated rejected commands against a single run — which is a
retry loop or an attacker, not an operator. Three of the five are bounded. The
fourth is the one this gate would most want a timeout on, and the first
measurement I took of it was a cold-cache artifact reading 8.9 ms at a single
row, which is recorded here because it is the number a single unrepeated run
would have published.

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

**Half of that sentence is wrong, measured.** One session held a row
`FOR UPDATE` for three seconds while another attempted the same lock, on
PostgreSQL 17:

| waiter's settings                                          | waited   | outcome                                              |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------- |
| none                                                       | 2,706 ms | acquired the lock after the holder finished          |
| `lock_timeout=150ms`                                       | 152 ms   | `55P03` canceling statement due to lock timeout      |
| `statement_timeout=150ms` only                             | 152 ms   | `57014` canceling statement due to statement timeout |
| `lock_timeout=150ms`, `statement_timeout=2000ms`           | 152 ms   | `55P03` lock timeout                                 |
| inverted: `lock_timeout=2000ms`, `statement_timeout=150ms` | 152 ms   | `57014` statement timeout                            |

A lock wait happens _inside_ statement execution, so `statement_timeout` bounds
it too. A statement timeout alone does not leave "a slower unbounded wait" — it
ends the wait at the statement bound. **Either GUC alone bounds the waiter.**
The second half of the sentence stands untouched: neither bounds the _holder_,
which ran its full three seconds in every trial.

**So the ordering rule is right for a reason this record did not give.**
`lockTimeoutMs < statementTimeoutMs` does not buy boundedness, which either
setting supplies. It buys **attribution**: with the lock bound lower the failure
arrives as `55P03`, naming contention; inverted, the identical wait arrives as
`57014`, naming only slowness. For the surface this section is about — a
maintenance command blocked behind another maintenance command — that is the
difference between an operator diagnosing contention and an operator retrying a
"slow" query against a run that is still locked. Keeping the rule, replacing its
justification.

**Evidence-plan item 5 is satisfied by the second row.** It asked for two
concurrent commands on one run with the loser failing on `lock_timeout` rather
than waiting; the loser fails at 152 ms with `55P03`. What remains unproven
there is the shipped shape rather than the mechanism: this used a scratch table
and `SET`, not `readRun` under `configurePostgresTimeouts`.

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

**Measured across three paths, and the first half of that sentence is wrong.**
Same capture method as evidence-plan item 1 — a `gateprobe` database with
`log_min_duration_statement = 0`, three real suites pointed at it:

| path                                             | n     | p50   | p95   | p99   | max     |
| ------------------------------------------------ | ----- | ----- | ----- | ----- | ------- |
| Mutation (`beta06-publish-mutation.test.ts`)     | 2,822 | 0.082 | 0.441 | 1.316 | 17.064  |
| Relational query (`beta04-policy-query.test.ts`) | 413   | 0.079 | 0.429 | 1.298 | 132.532 |
| Durable kernel (`beta08-durable-kernel.test.ts`) | 1,635 | 0.087 | 0.420 | 1.511 | 3.329   |

Milliseconds, `execute` durations only. **The bodies are the same path to path** —
p50 within 0.008 ms, p95 within 0.021 ms, p99 within 0.213 ms across three
different subsystems. What differs is the tail, and it differs by forty times.
So a single global timeout is wrong, but not for the stated reason: typical
durations do not vary by path, worst cases do.

**The Mutation tail is this record's own lock statement.** The 17.064 ms maximum
is `SELECT TRUE AS "qp_locked" FROM "collaboration"."channels" AS "qp_lock_row"
WHERE … LIMIT 1 FOR UPDATE` — the bare `FOR UPDATE` at
`packages/compiler/src/mutation/postgres.ts:138` that this gate identifies as its
lock risk, appearing unprompted as the slowest served statement on that path. It
is slow because it waits, which is the behaviour measured separately under "A
second finding: maintenance can block without bound". Two independent methods,
the same statement.

**The relational maximum is not a served read.** The 132.532 ms statement is an
`insert into collaboration.messages` — fixture seeding inside the suite, not a
Policy-filtered query. Its serving tail is therefore lower than its maximum
suggests, and a bound derived from that number would be derived from test setup:
the same DDL-in-the-tail trap recorded under item 1, in a second guise.

**Attributed per statement since, and the forty times was fixture setup.**
`log_statement = 'all'` is also `superuser` context, so setting it on the probe
database alongside the duration logging recovers the SQL for every execution.
Re-running the same three suites attributed all 4,870, reproducing the totals and
percentiles above exactly. Excluding suite fixture seeding, the slowest **served**
statement on each path is:

| path           | slowest served statement                                      | max    | p95    | n   |
| -------------- | ------------------------------------------------------------- | ------ | ------ | --- |
| Mutation       | `SELECT TRUE AS "qp_locked" … LIMIT 1 FOR UPDATE`             | 17.064 | 15.560 | 6   |
| Relational     | `WITH "qp_authorized" AS MATERIALIZED …` — the Policy query   | 3.177  | 2.902  | 3   |
| Durable kernel | `SELECT state, attempt_count AS "attemptCount" …` — `readRun` | 3.329  | 2.939  | 11  |

**So the spread is 1.05× between the relational and durable paths, and 5.37×
only because of the lock.** The earlier "forty times" in this section is the
relational path's 132.532 ms `insert into collaboration.messages`, which the
attribution shows is four fixture-seeding statements with a p95 of 112.728 —
setup, not service. Corrected here rather than above, because the aggregate
numbers stand and only their interpretation was wrong.

**The lock is not a single outlier.** Six executions of `qp_locked` with a p95 of
15.560 ms means the slow lock wait is the normal case for that statement under
this suite's contention, not a tail event. Every other served statement across
three subsystems sits at or under 3.4 ms.

**Which couples the two bounds in a way this record had not stated.** A lock
wait happens inside statement execution, so `statement_timeout` covers it, and
`resolvePostgresControl` requires `lockTimeoutMs < statementTimeoutMs`
(`packages/compiler/src/postgres-session.ts:30`). Sizing `lock_timeout` to
tolerate a legitimate wait therefore forces `statement_timeout` above it, on a
path whose actual work completes in 3.4 ms. The work bound is dragged up by the
wait bound; a single pair cannot be tight for both.

**The measured difference between paths is contention, not path.** The durable
kernel's `readRun` takes `FOR UPDATE` by default too
(`packages/runtime/src/durable/postgres-maintenance.ts:160`), so its 3.329 ms
maximum reflects an uncontended run rather than a lock-free path. Any per-path
number derived from these runs inherits that assumption, which argued for
deriving from a contended workload rather than whichever suite was to hand.

**Run against the contended workload, and the prediction in that paragraph was
wrong.** `tests/load/beta08-worker-contention.ts` — 64 runs, 8 workers, a
ten-connection pool — under the same capture, 7,225 paired statements:

| population                     | n     | p50   | p95   | max    |
| ------------------------------ | ----- | ----- | ----- | ------ |
| all serving statements         | 7,225 | 0.051 | 1.029 | 23.091 |
| `FOR UPDATE SKIP LOCKED` claim | 512   | 0.060 | 0.095 | 0.336  |
| plain `FOR UPDATE`             | 129   | 0.016 | 0.027 | 0.044  |
| `COMMIT`                       | 1,126 | 0.040 | 2.151 | 23.091 |

Thirteen statements exceed 5 ms, one exceeds 20 ms, none exceeds 100 ms.

**`SKIP LOCKED` never waited, measured where it could have failed.** 512
executions — matching the 512 admissions the scenario reports — with a maximum of
0.336 ms. This record's claim that "the durable claim path is unaffected because
it uses `FOR UPDATE SKIP LOCKED`, which never waits" is now measured under
eight-way contention rather than argued.

**And plain `FOR UPDATE` did not wait either**, 129 executions at a 0.044 ms
maximum, which is what the paragraph above predicted would show "the same shape
as the Mutation path". It did not. Eight workers contending for a _queue_ take
different rows; the Mutation `qp_locked` waits arise when several mutations key
the same row. **So the lock-wait problem is same-row contention, not
concurrency**, which narrows what the bound is protecting against more than
anything else measured here.

**The contended tail is `COMMIT`.** 1,126 executions, p95 2.151 ms, max
23.091 ms — WAL and fsync, not locks, and not a statement any timeout should be
sized to kill.

**Read the numbers with the logging cost in view.** The scenario passed its
budget under full statement logging at 517.798 ms against 2,000, versus a
330.045 ms reference observation, so logging inflated the run by roughly half
and these durations are upper bounds rather than clean measurements.

**Scope.** One run per suite, warm local container, small fixtures. One test in
the Mutation suite failed under the probe — "runs against the exact declared
supported PostgreSQL major" — and it was my invocation, not a mismatch. The test
reads `QUESTPIE_POSTGRES_MAJOR`, which is set only in CI
(`.github/workflows/ci.yml:83` from the matrix, `:128` hardcoded) and never by
`scripts/quality.ts`, so `bun test` leaves it undefined and
`expect(undefined).toMatch(/^(16|17|18)$/)` fails. Re-run with the variable set
as CI sets it, all five pass. The container is 17.10 and CI declares 17; nothing
mismatched.

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
  a decision, "commits before user code"
  (`docs/adr/0013-freeze-transactional-dispatch-and-reaction.md:32`) — and
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

**One surface is made worse rather than slower, and it is not in the list
above.** The four populations named there are legitimate queries that happen to
be slow. `audit(runId)` is different in kind: its cost tracks how many
maintenance commands one run has accumulated, including rejected ones, and the
run with a pathological command history is precisely the run an operator opens
the audit to investigate. A timeout there does not shed a slow query — it makes
the investigation tool fail on exactly the case it exists for, and returns
nothing rather than a partial answer.

**The margin belongs in that sentence, and was missing.** The measurement above
puts `audit(runId)` at 98.058 ms with 100,000 accumulated commands on one run, so
the candidate `statement_timeout` of 200 ms is not reached until roughly double
that. The mechanism is real and the exposure is an order of magnitude beyond
anything observed: the surface degrades if `audit` is bounded near 100 ms, or if
one run's command count passes about 200,000. Stated unconditionally it reads as
a present defect rather than a bound worth choosing carefully.

**A second surface, and this one compounds.** Live-query retention prunes inside
a transaction — `prune()` at
`packages/runtime/src/live-query/postgres-retention.ts:429`, wrapping
`input.sql.begin` at `:431` — with two deletes that carry no `LIMIT` and no
batching: every expired `retained_live_query_results` row (`:434`) and every
`change_ledger` fact below the consumers' `xid_horizon` (`:447`). Nothing in that
file batches; its only `limit` mentions are byte-size checks at `:136` and `:140`.
Because it is a transaction, **decision item 1's transaction-scoped GUC reaches
it**, so the candidate 200 ms bounds a delete whose size is however much has
accumulated since the last successful prune.

That is the difference from the four populations above. A bounded query that
fails is a request lost; a bounded _prune_ that fails leaves its own backlog in
place, so the next attempt is larger and fails sooner. The failure is not
swallowed either: `postgres-coordinator.ts:463` calls it inside a `finally`,
captures the error as `maintenanceFailure`, and rethrows at `:468`, so a prune
killed by the timeout also fails the maintenance cycle around it. **The mechanism
makes the work it kills grow**, which no timeout can resolve — the remedy is the
same shape as `audit`'s, a bound on rows, and it is equally absent.

That is a row bound the gate does not supply and cannot;
`durable-evidence-gaps/FINDING.md` §6 states it directly and says this record
"should not be read as covering it". Recorded here as well because a reader of
the gate alone would otherwise not learn that its mechanism has one surface it
degrades. The remedy is a `LIMIT` or a cursor on `audit`, owned there, not a
different timeout here.

This is why the gate cannot be justified by reasoning alone. It needs the
distribution.

## Measured evidence plan

1. **Establish the tail before changing anything.** Instrument the existing
   scenario and load suites to record per-path statement duration, and report
   p50, p95, p99, and max for the Mutation path, the relational query path, and
   the five durable reads. The BETA-08 contention scenario is the natural host:
   it already drives 64 runs against 8 workers.

   **Checked what "instrument the existing suites" would actually cost, because
   this item blocks 2 and 7 and has never been attempted.** It is a new kind of
   measurement, not an addition. **No percentile is computed anywhere in
   `tests/` or `scripts/`** — no p50, p95, p99, median or quantile. Both suites
   time a whole batch against a derived budget:
   `tests/performance/beta09-maintenance.test.ts:83`–`:94` wraps twenty
   `cancelRun` calls in one `performance.now()` span, and
   `tests/load/beta08-worker-contention.ts:60`–`:72` does the same for 64 runs.

   **The derivation rule item 2 wants to reuse does exist, verbatim.**
   `derivedBudget` in `tests/load/beta10-ten-instance.ts`,
   `beta10-soak-chaos.ts:19` and `beta07-recompute-fanout.ts:84` computes
   `ceil(referenceObservedMs × multiplier / roundUpQuantumMs) × roundUpQuantumMs`,
   which is this record's `ceil(observed × multiplier / quantum) × quantum`. The
   shipped baselines derive `postgresMaintenance20Ms = 400` from an observed
   71.591 ms at ×5 into 100 ms quanta, and `postgresContention64Ms = 2000` from
   330.045 ms at ×6 into 1000 ms quanta; both re-derive exactly.

   **So the numbers exist and cannot be used, for a reason this record already
   documented once.** 71.591 ms over twenty commands is 3.580 ms per `cancelRun`;
   330.045 ms over 64 runs is 5.157 ms per run. Those are means of a whole
   _command_ — a transaction, the kernel marker, a read, an update and an audit
   insert — while `statement_timeout` bounds one _statement_. Deriving a
   statement bound from a command mean is the identical unit error caught under
   "Both numbers an earlier revision proposed to ship were scope errors", where
   5,000 ms bounded a transaction and was proposed for a statement.

   Item 1 therefore cannot be shortcut from what is already measured. The two
   honest routes are instrumenting the runtime's own query path, which is
   production code this gate does not touch, or capturing server-side with
   `pg_stat_statements` — available as an extension in the test container and
   absent from `shared_preload_libraries`, so it needs a restart rather than a
   session setting.

   **A third route existed and it worked, so item 1 is now partly executed.**
   `log_min_duration_statement` is `superuser` context, which means it can be
   set per database and reloaded without a restart. A dedicated `gateprobe`
   database with `ALTER DATABASE gateprobe SET log_min_duration_statement = 0`
   captures every statement duration while leaving every other database silent,
   and the repository's suites already accept `PGHOST`/`PGPORT`/`PGUSER`/
   `PGDATABASE` (`tests/integration/postgres/helpers/beta05-runtime.ts:68`–`:71`),
   so a real suite can be pointed at it. Running
   `tests/integration/postgres/beta09-maintenance-compatibility.test.ts` there —
   six tests, all passing — logged 2,002 timed operations.

   | population                             | n     | p50   | p95   | p99    | max    |
   | -------------------------------------- | ----- | ----- | ----- | ------ | ------ |
   | `execute` — extended protocol, serving | 853   | 0.087 | 0.510 | 1.493  | 3.486  |
   | `statement` — simple protocol, setup   | 126   | 0.031 | 2.532 | 12.699 | 26.326 |
   | `bind` + `parse`                       | 1,023 | 0.055 | 0.575 | 1.261  | 2.186  |

   All in milliseconds. **Twenty serving executions exceed 1 ms and none exceeds
   5 ms.** The whole visible tail lives in the simple-query population, whose
   maximum is a `CREATE TABLE questpie_internal.change_ledger` at 26.326 ms —
   migration DDL, not a served read. A bound derived from a naive "observed
   maximum" would therefore be derived from a `CREATE TABLE`, which is the scope
   error this record already refuses elsewhere.

   **Applying item 2's rule to the serving maximum gives a candidate.**
   `ceil(3.486 × 5 / 100) × 100` is **100 ms**, on the same ×5 multiplier and
   100 ms quantum the shipped `postgresMaintenance20Ms` baseline uses. At a 10 ms
   quantum the same rule gives 20 ms, so the quantum is a real choice and not a
   formality.

   **What this is not.** One suite, one path, a warm local container and a small
   fixture — not the tail item 1 asks for across the Mutation path, the
   relational query path and the five durable reads. And the extended protocol
   logs the portal name rather than the SQL, so these 853 durations cannot be
   attributed per path from this capture; the per-shape breakdown is only
   available for the 126 simple statements. **Per-path attribution still needs
   `pg_stat_statements` or runtime instrumentation.** What is settled is the
   order of magnitude and the shape: the serving population is sub-millisecond at
   p95 and the tail belongs to migration, which was previously assumed either
   way.

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

   **Measured: that assertion as written would pass over an unbounded fleet.**
   A role default is applied at login, so it does not reach a connection that is
   already open. On PostgreSQL 17 an open connection read `statement_timeout`
   as `0` before `ALTER ROLE gucprobe SET statement_timeout='150ms'` and **still
   `0` after it**, while a connection opened afterwards read `150ms`. Pooled
   connections are long-lived by design, so a deployment that sets the baseline
   while the runtime is running keeps serving on unbounded connections until the
   pool cycles — and "connect as the application role and `SHOW`" opens a fresh
   connection, which is exactly the one case that passes.

   So the assertion proves the default is _configured_, not that the serving
   connections _carry_ it. It needs a second half that reads the value on a
   connection the application is already using — `SHOW statement_timeout` issued
   through the same pool as a real read, or `pg_settings` sampled per backend in
   `pg_stat_activity` — and a stated ordering requirement that the baseline is
   set before the fleet starts, not applied to a running one.

5. **Prove the lock bound.** Two concurrent maintenance commands on one run,
   with the loser asserted to fail on `lock_timeout` rather than wait.
6. **Prove the cancel layer independently of the timeout.** A statement aborted
   client-side must be shown to actually stop server-side — assert the backend
   is gone from `pg_stat_activity`, not merely that the client promise
   rejected. This is the assertion that distinguishes a real cancel from a
   client giving up, and no _test_ in the tree makes it. The behaviour itself is
   already measured in "Measured, not asserted" above — including the
   `pg_cancel_backend` control — so this item is asking for a regression test,
   not for a first measurement. An independent re-run on Bun 1.3.14 against
   PostgreSQL 17 reproduced it: four seconds after `query.cancel()` the backend
   was still `active`, and the client promise had still not settled.
7. **Report what the change would have killed.** Run the measured tail against
   the proposed bound and state how many observed statements would now fail.
   If that number is not zero, the bound is wrong or the query is.

   **Executed, over 4,870 serving executions across the three paths measured
   above.** Counts are executions exceeding the bound:

   | bound  | Mutation   | Relational | Durable kernel | all         |
   | ------ | ---------- | ---------- | -------------- | ----------- |
   | 5 ms   | 3 of 2,822 | 1 of 413   | 0 of 1,635     | 4 (0.082 %) |
   | 10 ms  | 2 of 2,822 | 1 of 413   | 0 of 1,635     | 3 (0.062 %) |
   | 20 ms  | 0          | 1 of 413   | 0              | 1 (0.021 %) |
   | 100 ms | 0          | 1 of 413   | 0              | 1 (0.021 %) |
   | 133 ms | 0          | 0          | 0              | **0**       |

   **The 100 ms candidate derived under item 2 kills exactly one statement, and
   item 7's own test resolves it.** That statement is the 132.532 ms
   `insert into collaboration.messages` — suite fixture seeding, not a served
   read. "The bound is wrong or the query is": here the query is wrong for the
   purpose, because it is setup. Excluding it, the slowest served statement is
   17.064 ms and any bound above that kills nothing.

   **Below 20 ms the casualties become specific, and they are this gate's own
   subject.** Of the three Mutation statements over 5 ms, **two are the same
   `SELECT TRUE AS "qp_locked" … LIMIT 1 FOR UPDATE`** — 17.064 ms and
   11.048 ms — and the 11.048 ms one is followed immediately by `ROLLBACK`, so
   that transaction was failing anyway. The third is a 6.197 ms
   `INSERT INTO questpie_internal.mutation_call_receipts`.

   **So the bound is not choosing how slow a query may be. It is choosing how
   long a Mutation may wait for a row lock.** On this path `statement_timeout`
   and `lock_timeout` bound the same statement, which is why the ordering rule
   recorded above matters more than it first appears: it decides whether the
   dominant tail case returns `55P03` naming contention or `57014` naming
   slowness. One observation is not a pattern, and the `ROLLBACK` case is one
   observation — but it is the one that suggests a tight bound may convert a
   slow failure into a fast failure rather than a success into a failure.

   **What would overturn the zero.** These are warm local runs against small
   fixtures. A cold cache, a large tenant's page, or a managed target with
   1–5 ms round trips moves the whole distribution, and the 0.021 % at 100 ms is
   a floor rather than an estimate.

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
