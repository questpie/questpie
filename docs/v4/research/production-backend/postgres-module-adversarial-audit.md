# PB-03 PostgreSQL module adversarial audit

- Status: adversarial implementation record; not product or public API authority
- Re-derived against: `feat/v4-beta-12` at `14205c25`
- Scope: the private PostgreSQL module and its retained hostile proof
- Input authority: `DECISION-MAP.md` PB-03/PB-04 split, the selected module
  interface, and PB-02's required topology proof

## Outcome

PB-03 has a credible deep-module foundation, but it is not complete. The audit
found two executable Runtime ownership races at `2779cf12`; `48429c3c` closes
both. `3e2cfa24` then closes the migration cancellation, deadline, and timeout
control gap. `2428e8f7` bounds rotation and close, `e1bc6dde` closes the
separately reproduced reconnect-after-close race with an external zero-session
observation, and `14205c25` retains failures produced while the old generation
drains. The remaining highest-risk gap is the normalized listener failure
boundary. The pooler negative and durable-frontier proof are also weaker than
the accepted proof request.

The findings below distinguish a module proof from downstream product
integration. PB-03 must prove the lifetimes and guarantees it owns. It must not
absorb all Change Ledger semantics or the production-wide Bun SQL migration,
which already have separate downstream questions.

## Confirmed and closed through `14205c25`

### Runtime resurrection during close

At `2779cf12`, a rotation held inside `verify` could resume after `close`, swap
the candidate generation, and set the Runtime back to `ready`. A read-only
executable reproducer observed:

```text
after-close closed
after-rotation ready
```

The repair now tracks the rotation, rejects a continuation after state leaves
`rotating`, and makes close await the owned operation
(`packages/runtime/src/postgres/runtime.ts:190`-`:255`, `:276`-`:290`). The
retained hostile case holds verification, starts close, releases verification,
and proves the Runtime remains closed at generation 1
(`tests/integration/postgres/beta12-postgres-module.test.ts:1089`-`:1126`).

### Concurrent listener ownership leak

At `2779cf12`, two simultaneous `runtime.listen(input)` calls both resolved.
An external `pg_stat_activity` observation against PostgreSQL 17 measured two
`questpie-realtime-listener` sessions. Closing both returned handles left one
session, and closing the Runtime still left that session:

```text
after-two-listens 2
after-two-closes 1
after-runtime-close 1
```

The audit process and leaked session were then terminated. The repair reserves
listener ownership before the first await, rejects a second startup, closes a
candidate that loses the state race, and makes Runtime close await startup
(`packages/runtime/src/postgres/runtime.ts:148`-`:188`, `:276`-`:290`). The
retained case holds startup reconciliation, proves the second admission fails,
then proves close drains the first startup and leaves the listener disabled
(`tests/integration/postgres/beta12-postgres-module.test.ts:1239`-`:1281`). This
now enforces the selected one-listener invariant
(`postgres-module-interface-design.md:320`-`:324`).

### Migration control now covers active work

`PostgresControl` exposes `signal`, `deadlineAt`, `statementTimeoutMs`, and
`lockTimeoutMs`, and the migration runner accepts that control
(`packages/runtime/src/postgres/contract.ts:53`-`:58`, `:173`-`:180`).
`3e2cfa24` composes caller cancellation with an absolute deadline in one owned
signal (`packages/runtime/src/postgres/control.ts:3`-`:31`). The migration
runner now bounds connect, advisory-lock acquisition, active statements, and
the application callback; narrows statement and lock timeouts; and removes the
abort listener before unlock and session teardown
(`packages/runtime/src/postgres/index.ts:622`-`:782`). The retained PostgreSQL
case drives a 25 ms server statement timeout, active cancellation, absolute
deadline, and subsequent same-application recovery
(`tests/integration/postgres/beta12-postgres-module.test.ts:756`-`:829`).

This closes the migration control finding. It does not prove transaction-pool
refusal or every uncertain-unlock path, which remain separate findings below.

### Rotation and close are bounded by their deadline

`2428e8f7` adds one rejecting deadline race for rotation work and one bounded
settlement race for close (`packages/runtime/src/postgres/runtime.ts:56`-`:96`).
Candidate verification and listener startup now expire before generation swap,
while cleanup retains the same absolute deadline
(`packages/runtime/src/postgres/runtime.ts:190`-`:255`). Close waits only until
its deadline for rotation or listener startup, then closes both the candidate
and current generation (`packages/runtime/src/postgres/runtime.ts:276`-`:290`).

The retained PostgreSQL case holds verification across both paths. Rotation
expires as `connectTimeout` without switching generation; close completes at its
own deadline, remains closed, and the late rotation rejects as closed
(`tests/integration/postgres/beta12-postgres-module.test.ts:1128`-`:1194`).

This closes the bounded rotation/close finding.

### Listener close owns an in-flight reconnect candidate

`e1bc6dde` makes the candidate owned as `establishingClient` before its first
await, rechecks closing state after connect, committed `LISTEN`, and
reconciliation, and clears or ends the candidate on every failure
(`packages/runtime/src/postgres/listener.ts:55`-`:67`, `:109`-`:150`). Close now
captures and ends both active and establishing clients before publishing
`closed` (`packages/runtime/src/postgres/listener.ts:172`-`:200`).

The retained PostgreSQL case forces disconnect, holds reconnect reconciliation,
closes on a 25 ms deadline, releases the late continuation, and proves the state
remains closed. Its final assertion queries `pg_stat_activity` through a separate
ordinary transaction and waits for zero `questpie-realtime-listener` sessions
(`tests/integration/postgres/beta12-postgres-module.test.ts:927`-`:987`).

This closes the reconnect-after-close finding with the external observation the
original audit required.

### Drain-time failures remain in cumulative Runtime facts

`14205c25` switches new admission, drains the previous listener and database,
and only then snapshots the old counters into the retired accumulator
(`packages/runtime/src/postgres/runtime.ts:236`-`:247`). Runtime facts continue
to add that final retired snapshot to the current generation counters
(`packages/runtime/src/postgres/runtime.ts:257`-`:274`).

The retained PostgreSQL case holds an old-generation transaction across the
generation switch, forces cancellation at the old drain deadline, and proves
the terminal failure is `closed` at shutdown while cumulative facts retain one
cancellation and one rotation
(`tests/integration/postgres/beta12-postgres-module.test.ts:1196`-`:1237`).

This closes the drain-time facts finding without downgrading the selected safe
count contract (`postgres-module-interface-design.md:333`-`:335`).

## Open findings, in priority order

### 1. Listener and reconciliation failures bypass normalization

The concrete error type has no `listen` or `reconcile` phase
(`packages/runtime/src/postgres/contract.ts:86`-`:116`). Listener startup
propagates raw driver or reconciliation errors
(`packages/runtime/src/postgres/listener.ts:129`-`:163`). Migration connect is
now normalized inside its owned control and cleanup scope
(`packages/runtime/src/postgres/index.ts:622`-`:638`), but that repair does not
close the listener boundary. The listener behavior remains weaker than the
selected normalized and redacted failure boundary
(`postgres-module-interface-design.md:333`-`:342`, `:410`-`:414`).

Minimal hostile proof: use an unreachable and a malformed secret-bearing direct
endpoint, then a reconciliation callback with a sensitive value. Assert the
serialized boundary contains only a normalized class, phase, safe identity,
SQLSTATE, and retry disposition, never URL, credential, SQL, parameters,
PostgreSQL detail, or the sensitive callback value.

This is overturned if these errors are proven never to cross any diagnostic,
wire, log, or operation boundary and the selected normalization claim is
narrowed accordingly.

### 2. Uncertain migration unlock cleanup is not yet proved

The selected migration invariant requires backend identity checks around every
transaction and unlock, with session destruction on uncertain cleanup
(`postgres-module-interface-design.md:328`-`:330`). The runner checks identity
around transactions, but unlock currently ignores both a false result and an
error before ending the session (`packages/runtime/src/postgres/index.ts:775`-`:782`).
Ending the session should release a surviving session advisory lock, but the
proof does not distinguish confirmed unlock from cleanup made safe only by
connection destruction.

Minimal hostile proof: terminate or sever the pinned session at the unlock
boundary, assert the run reports the normalized uncertainty rather than
success, observe that no application advisory lock or migration session
remains, then acquire the same application lock from a fresh runner.

This is overturned by a retained hostile case that drives unlock failure and
proves session destruction plus lock release externally. A happy-path recovery
after callback failure does not drive the uncertain cleanup branch.

### 3. The transaction-pool negative proves failure after healthy, not refusal

PB-02 requires listener and migration paths pointed at transaction pooling to
fail before either is reported healthy
(`postgres-connection-topology-primary-sources.md:243`-`:244`). The current
negative deliberately accepts a pooled listener, records successful startup
reconciliation, and proves only that a later wake is absent
(`tests/integration/postgres/beta12-postgres-module.test.ts:1321`-`:1350`). No
migration transaction-pool negative exists in that witness.

Minimal hostile proof: a capability-negative listener and migration lane must
reject before returning their handles or invoking user work, and it must remain
negative when PgBouncer happens to reuse a sticky backend. A single repeated PID
is not sufficient because transaction pooling may assign the same server
connection by coincidence.

This requirement is overturned only if PB-02 changes the boundary from runtime
capability refusal to an operator-validated deployment precondition. Merely
documenting two URLs does not satisfy the current executable requirement.

### 4. Decoder mismatch and tampered-plan refusal are still unproved

PB-03 explicitly requires decoder mismatch coverage
(`postgres-module-interface-design.md:410`-`:414`), and the static-statement
invariant requires Runtime Build digest/inventory verification before execution,
including a tampered-plan refusal (`postgres-module-interface-design.md:299`-`:305`).
The current PostgreSQL witness proves successful decoding and safe serialization,
not these two negative boundaries.

Minimal hostile proof: return a deliberately incompatible row shape and require
`invalidResult` with only the stable statement name; separately tamper with one
verified Runtime Build statement and prove refusal occurs before checkout or
SQL.

The decoder case is overturned by an existing retained case that actually
drives the decoder failure path. A similarly named assertion or a type-only
test is not enough.

## PB-03 and PB-04 ownership

PB-03 owns generic PostgreSQL listener correctness: committed `LISTEN`, lost
wake, reconnect, and durable-frontier reconciliation before healthy admission.
The missing proof can use a minimal monotonic table and the module's
`reconcile({ database })` callback. It must demonstrate state catch-up before
the periodic interval, not merely record the string `"reconnect"`. This is the
module-level portion of PB-02's lost-wake case
(`postgres-connection-topology-primary-sources.md:245`-`:246`).

PB-04 owns actual Change Ledger semantics and integration: loss, duplication,
coalescing, process crash, arbitrary-instance routing, and periodic fallback.
That is the explicit next question in the decision map
(`DECISION-MAP.md:151`-`:171`). A generic PB-03 frontier proof must not claim
that the real Change Ledger caller has been migrated or accepted.

Production-wide Bun SQL removal is another downstream question. The decision
map says PB-03 selects an internal prototype without authorizing production
driver migration (`DECISION-MAP.md:143`-`:149`) and assigns compiler, generated
application, Query, Mutation, Live Query, Durable, scripts, and tests to the Bun
SQL removal pass (`DECISION-MAP.md:173`-`:190`). The module record currently
says both that caller migration remains open in PB-03 and that its deletion test
fails while duplicate caller responsibilities remain
(`postgres-module-interface-design.md:498`-`:515`). Until that record conflict
is resolved, the narrow executable rule is:

- PB-03 closes the PostgreSQL lifetimes and hostile guarantees behind its
  selected internal seam;
- PB-04 proves real immediate-wake integration;
- the Bun SQL removal pass realizes the production-wide deletion test without
  semantic drift.

## Recommended tracer order

1. Close the normalized/redacted listener failure boundary, including decoder
   mismatch.
2. Drive uncertain migration unlock cleanup and prove external lock release.
3. Replace the current pooled-listener observation with the required listener
   and migration pre-healthy negative, or explicitly amend PB-02's ownership.
4. Prove generic durable-frontier convergence after a lost wake before the
   periodic poll.
5. Hand the proven module to PB-04 and the Bun SQL removal pass; do not claim
   actual Change Ledger or production caller completion inside PB-03.

PB-03 can be called complete when these module-owned hostile cases pass against
PostgreSQL 16, 17, and 18, with the focused PgBouncer lane where capability
topology matters. A green happy-path matrix or a grep count does not replace a
test that breaks each guarantee and asserts the failure.
