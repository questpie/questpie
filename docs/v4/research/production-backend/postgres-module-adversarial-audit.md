# PB-03 PostgreSQL module adversarial audit

- Status: adversarial implementation record; not product or public API authority
- Re-derived against: `feat/v4-beta-12` at `9cc76e2a`
- Scope: the private PostgreSQL module and its retained hostile proof
- Input authority: `DECISION-MAP.md` PB-03/PB-04 split, the selected module
  interface, and PB-02's required topology proof

## Outcome

PB-03's private deep-module proof is complete at `9a6f7b22`. The audit
found two executable Runtime ownership races at `2779cf12`; `48429c3c` closes
both. `3e2cfa24` then closes the migration cancellation, deadline, and timeout
control gap. `2428e8f7` bounds rotation and close, `e1bc6dde` closes the
separately reproduced reconnect-after-close race with an external zero-session
observation, and `14205c25` retains failures produced while the old generation
drains. `7b355e98` closes the decoder-mismatch half of the static-statement
negative, `b8da3909` closes the normalized listener failure boundary,
`c024d953` closes uncertain migration cleanup, and `f51be2b2` closes generic
durable-frontier convergence. `9a6f7b22` resolves the last two record blockers:
direct/session affinity is an operator-validated precondition because ordinary
credentials cannot infer it, and Runtime Build statement-tamper refusal belongs
to the first production seam crossing in PB-05 rather than this isolated module.

The findings below distinguish a module proof from downstream product
integration. PB-03 must prove the lifetimes and guarantees it owns. It must not
absorb all Change Ledger semantics or the production-wide Bun SQL migration,
which already have separate downstream questions.

## Confirmed and closed through `9a6f7b22`

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
(`tests/integration/postgres/beta12-postgres-module.test.ts:1408`-`:1445`).

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
(`tests/integration/postgres/beta12-postgres-module.test.ts:1558`-`:1600`). This
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
(`packages/runtime/src/postgres/index.ts:570`-`:725`). The retained PostgreSQL
case drives a 25 ms server statement timeout, active cancellation, absolute
deadline, and subsequent same-application recovery
(`tests/integration/postgres/beta12-postgres-module.test.ts:908`-`:981`).

This closes the migration control finding. It does not prove transaction-pool
refusal, which remains a separate finding below.

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
(`tests/integration/postgres/beta12-postgres-module.test.ts:1447`-`:1513`).

This closes the bounded rotation/close finding.

### Listener close owns an in-flight reconnect candidate

`e1bc6dde` makes the candidate owned as `establishingClient` before its first
await, rechecks closing state after connect, committed `LISTEN`, and
reconciliation, and clears or ends the candidate on every failure
(`packages/runtime/src/postgres/listener.ts:70`-`:82`, `:124`-`:178`). Close now
captures and ends both active and establishing clients before publishing
`closed` (`packages/runtime/src/postgres/listener.ts:200`-`:228`).

The retained PostgreSQL case forces disconnect, holds reconnect reconciliation,
closes on a 25 ms deadline, releases the late continuation, and proves the state
remains closed. Its final assertion queries `pg_stat_activity` through a separate
ordinary transaction and waits for zero `questpie-realtime-listener` sessions
(`tests/integration/postgres/beta12-postgres-module.test.ts:1161`-`:1221`).

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
(`tests/integration/postgres/beta12-postgres-module.test.ts:1515`-`:1556`).

This closes the drain-time facts finding without downgrading the selected safe
count contract (`postgres-module-interface-design.md:333`-`:335`).

### Decoder failures expose only the static statement identity

`7b355e98` executes a static statement whose decoder deliberately rejects the
returned row shape. The retained result is `invalidResult` with phase
`statement`, stable statement name, and `never` retry; serialized output omits
both the sensitive decoder detail and SQL text
(`tests/integration/postgres/beta12-postgres-module.test.ts:467`-`:483`).

This closes the module-owned static-statement decode negative. Runtime Build
integrity remains a prerequisite before a generated statement crosses this
seam. No production caller crossed it at the `9a6f7b22` decision point; the
subsequent PB-04 Change Ledger crossing is recorded below. Runtime Build
statement projection and its seam-level tamper refusal therefore belong to
PB-05 rather than row decoding or PB-03.

### Listener and reconciliation failures are normalized and redacted

`b8da3909` adds the selected `listen` and `reconcile` phases to the concrete
error contract (`packages/runtime/src/postgres/contract.ts:86`-`:119`) and moves
the shared SQLSTATE classification into one internal normalizer
(`packages/runtime/src/postgres/errors.ts:3`-`:77`). Listener configuration,
client construction, connection, committed `LISTEN`, and startup reconciliation
now cross that normalized boundary with their exact phase; an already-normalized
database failure is re-enveloped as reconciliation without copying unsafe driver
fields (`packages/runtime/src/postgres/listener.ts:47`-`:68`, `:124`-`:177`).

The retained hostile case drives a malformed credential-bearing URL, an
unreachable credential-bearing endpoint, a reconciliation callback containing a
sensitive value, and a nested normalized database failure. It asserts exact
configuration/connect/reconcile shapes and proves that serialized and string
forms omit credentials and callback detail
(`tests/integration/postgres/beta12-postgres-module.test.ts:1223`-`:1306`). This
closes the selected normalized and redacted listener boundary
(`postgres-module-interface-design.md:333`-`:342`, `:410`-`:414`).

### Uncertain migration cleanup refuses success and destroys the session

`c024d953` makes both ordinary and migration connection configuration validate
as PostgreSQL URLs before constructing driver state
(`packages/runtime/src/postgres/index.ts:43`-`:69`, `:538`-`:551`). The retained
non-database control proves a malformed credential-bearing migration URL becomes
the exact redacted `configuration/connect` failure
(`tests/integration/postgres/beta12-postgres-module.test.ts:369`-`:393`).

After application work, migration cleanup now treats a false advisory-unlock
result or an unlock error as `sessionNotAffine/shutdown`, ends the pinned client,
and refuses the otherwise successful output
(`packages/runtime/src/postgres/index.ts:721`-`:749`). The real PostgreSQL
hostile case terminates the pinned backend after user work, observes the typed
uncertain-cleanup failure, proves zero remaining `questpie-migration` sessions,
and then reacquires the same application lock through a fresh runner
(`tests/integration/postgres/beta12-postgres-module.test.ts:858`-`:904`). This
closes the selected destroy-on-uncertain-cleanup invariant
(`postgres-module-interface-design.md:328`-`:330`).

### Lost wake converges the generic durable frontier before periodic fallback

`f51be2b2` adds a real PostgreSQL monotonic-frontier witness without importing
Change Ledger product semantics. Startup reconciliation first reads frontier
zero. The writer then takes the same transaction advisory lock used by
reconciliation, terminates the dedicated listener while holding that lock, and
writes frontier seven in the same transaction. This ordering makes a reconnect
that races the writer wait for its commit before reading; no `NOTIFY` is emitted
anywhere in the hostile path
(`tests/integration/postgres/beta12-postgres-module.test.ts:1079`-`:1130`).

The reconnect must publish frontier seven and return the listener to healthy
within the test's one-second bound, while its configured periodic fallback is
ten seconds away
(`tests/integration/postgres/beta12-postgres-module.test.ts:1132`-`:1159`). This
closes PB-03's generic committed-`LISTEN`/reconnect/reconcile frontier invariant
and the module portion of the required lost-wake proof
(`postgres-connection-topology-primary-sources.md:268`-`:269`). It does **not**
prove the actual Change Ledger's loss, duplication, coalescing, crash, or
arbitrary-instance behavior; those remain PB-04.

## Resolved ownership decisions

### Direct/session affinity is an operator-validated precondition

The former PB-02 wording required the Runtime to reject a transaction-pool
listener and migration path before healthy admission. That is not implementable
generically from ordinary credentials and two PostgreSQL URLs: neither the
protocol nor those inputs expose an authoritative pooling-mode capability.
PgBouncer's official feature matrix, already grounded in the topology record,
declares `LISTEN` and session advisory locks unsupported in transaction mode
(`postgres-connection-topology-primary-sources.md:173`-`:180`).

The executed negative control demonstrates the false-positive risk. Against the
pinned transaction-mode lane at `9a6f7b22`, six separately committed migration
transactions all reported backend PID `453`, and the current migration runner
returned `"accepted"`; its PID, lock, and unlock probes are real
(`packages/runtime/src/postgres/index.ts:538`-`:749`) but happened to retain one
backend. The opposite retained control points the listener at the same pooler:
startup reconciliation completes, yet the later wake is absent
(`tests/integration/postgres/beta12-postgres-module.test.ts:1640`-`:1667`). A
sticky PID or accepted migration is therefore not capability proof.

PB-02 now requires the operator to validate that `directConnectionUrl` is direct
or session-affine before deployment health is accepted. The Runtime retains no
implicit fallback to `connectionUrl`, and the controlled pooled-listener
negative remains as evidence that the URLs are not interchangeable. This
decision would be overturned by an authenticated generic capability handshake
available with ordinary application credentials, or by a primary provider
guarantee that transaction pooling preserves both required session features;
provider admin access or probabilistic PID reuse is insufficient.

### Runtime Build statement tamper refusal belongs to PB-05

BETA-05 already owns generic Runtime artifact integrity and readiness. Runtime
startup decodes artifacts, verifies every inventory file, validates executable
bindings, and only then invokes readiness
(`packages/runtime/src/application/index.ts:157`-`:181`); file inventory and
digests refuse mismatches (`packages/runtime/src/application/artifact-files.ts:10`-`:36`),
and the retained forged-build control rejects at application creation
(`tests/integration/postgres/beta05-runtime-client.test.ts:32`-`:59`). That
boundary is prerequisite, not proof that a `PostgresStatement` currently crosses
the new module seam.

No production caller crossed that seam at the `9a6f7b22` decision point. The
next commit, `9cc76e2a`, adds only PB-04's narrow Change Ledger static statements
and `PostgresDatabase` transaction path
(`packages/runtime/src/live-query/postgres.ts:166`-`:328`,
`packages/runtime/src/live-query/postgres-durable-invalidation.ts:47`-`:126`),
with retained atomic rollback and fanout controls
(`tests/integration/postgres/beta07-postgres-durable-invalidation.test.ts:202`-`:334`,
`:339`-`:432`). The generated application still imports and constructs Bun
`SQL` (`packages/compiler/src/runtime/application.ts:196`, `:272`-`:299`).
PB-05/Bun-removal owns the production Runtime Build statement projection, its
seam-level tamper refusal before checkout or SQL, and the remaining caller
migration. Neither PB-03 nor the narrow PB-04 crossing claims that hostile proof
exists.

## PB-03 and PB-04 ownership

PB-03 owns generic PostgreSQL listener correctness: committed `LISTEN`, lost
wake, reconnect, and durable-frontier reconciliation before healthy admission.
The monotonic-table witness now proves state catch-up before the periodic
interval rather than merely recording the string `"reconnect"`
(`tests/integration/postgres/beta12-postgres-module.test.ts:1079`-`:1159`). This
closes the module-level portion of PB-02's lost-wake case
(`postgres-connection-topology-primary-sources.md:245`-`:246`).

PB-04 owns actual Change Ledger semantics and integration: loss, duplication,
coalescing, process crash, arbitrary-instance routing, and periodic fallback.
That is the explicit next question in the decision map
(`DECISION-MAP.md:151`-`:171`). `9cc76e2a` migrates the narrow reconciliation
and invalidation statement set behind an explicit `PostgresDatabase` input, but
a generic PB-03 frontier proof must not claim the wider PB-04 behavior or
production projection accepted.

Production-wide Bun SQL removal is another downstream question. The decision
map says PB-03 selects an internal prototype without authorizing production
driver migration (`DECISION-MAP.md:143`-`:149`) and assigns compiler, generated
application, Query, Mutation, Live Query, Durable, scripts, and tests to the Bun
SQL removal pass (`DECISION-MAP.md:173`-`:190`). The interface record now
distinguishes PB-03's prototype deletion test from PB-05's production-wide
realization. The narrow executable rule is:

- PB-03 closes the PostgreSQL lifetimes and hostile guarantees behind its
  selected internal seam;
- PB-04 proves real immediate-wake integration;
- the Bun SQL removal pass realizes the production-wide deletion test without
  semantic drift.

## Tracer order after PB-03

1. PB-04 migrates the real Change Ledger static statements and proves immediate
   wake without claiming production-wide Bun removal.
2. PB-05 migrates the remaining production callers, proves Runtime Build
   statement tamper refusal at the first real seam crossing, and realizes the
   production-wide deletion test.
3. Deployment validation enforces the operator-declared direct/session-affine
   precondition; the Runtime retains no connection-URL fallback.

PB-03 is complete narrowly because its module-owned hostile cases pass against
PostgreSQL 16, 17, and 18, with the focused PgBouncer lane where topology
matters. This does not accept PB-04 Change Ledger integration, PB-05 caller
migration, or a production deployment that has not validated its direct
endpoint.
