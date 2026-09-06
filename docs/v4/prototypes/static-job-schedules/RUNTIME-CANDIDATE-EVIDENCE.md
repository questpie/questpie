# Static schedule Runtime candidate

This isolated candidate starts at `97910dac9`. ADR-0043 remains Proposed.
Nothing in this record accepts the ADR, changes public documentation, or grants
release authority.

## Owner and bindings

`packages/runtime/src/durable/schedule/index.ts` owns activation and bounded
reconciliation through the existing `PostgresTransactionRunner`. Construction
verifies and snapshots the schedule artifact. Boot does not write an activation.
The compiler domain remains responsible for authored values and generated
artifact inventory; the Runtime independently verifies exact members, canonical
calendar and JSON bytes, program/set digests, and application/build/Job pins.

The immutable catalog stores only canonical `{ application, schedules }` bytes.
Compiler and executable pins are deliberately outside those stored desired-set
bytes. Application, Job identity, and scheduled minute determine a tick UUID.
The existing Job acceptance owner retains its ordinary identity and receipt;
the schedule tick has a PostgreSQL foreign key to its real Durable Run.

The private `StaticScheduleAcceptance` callback receives the supplied transaction,
verified schedule, tick identity, scheduled minute, observed PostgreSQL instant,
and cancellation signal. Generated integration must resolve ordinary Context
and call `createJobAcceptance` with
`createPostgresJobAcceptanceTransaction` over that supplied transaction. Calling
the direct Job facade would incorrectly open a separate transaction.

Activation and reconciliation acquire the same application head row lock, then
read `clock_timestamp()` once. Exact activation replay checks immutable request
material before revision comparison and returns its historical receipt with
the current head. New requests compare decimal bigint revisions, install exact
catalog bytes, transfer only immediately unchanged frontiers, and record their
new revision atomically. Reconciliation validates the locked active catalog,
selects at most one latest UTC tick per schedule, and commits the tick, ordinary
Job acceptance, and frontier together.

## Candidate bounds

- At most 64 schedules and 262144 canonical artifact bytes.
- At most 64 calendar evaluations per reconciliation transaction.
- Calendar evaluation examines at most one 146097-day Gregorian cycle, independent
  of outage minutes; the calendar candidate owns its detailed correctness tests.
- Each activation/reconciliation has a 10000 ms cancellation deadline, composed
  with caller cancellation and the existing PostgreSQL statement/lock controls.
- Context and Job codecs and the ordinary acceptance payload/command caps remain
  the existing owners. No second acceptance or worker kernel was added.

## PostgreSQL and deterministic checks

`bun test tests/integration/postgres/static-schedule-runtime.test.ts` passes on
PostgreSQL 17 with 42 assertions. The test creates a UUID-owned database, sets
and verifies its database name and server major, closes the Runtime and SQL
owners, and drops only that database. Connection credentials enter through
process environment only. No existing container, preview, or schema is reset.

The test uses ten competing schedule owners over one 12-connection Runtime
PostgreSQL pool. Their acceptance callback enters the actual ordinary
`createApplicationRuntime` Context and existing Job acceptance module using
compiler-generated acceptance statement artifacts. It proves one run/tick,
first-activation exclusion, immutable response-loss replay, ABA stale requests,
empty removal and re-addition, unchanged-frontier transfer, clock regression,
Context denial, rollback after run creation, cancellation, both removal lock
orders, activation rollback, and bigint revision overflow. PostgreSQL has the
actual v9 schedule tables and full ordinary Durable Run/acceptance tables.

`bun test tests/unit/static-schedule-runtime.test.ts` passes 2 tests and 14
assertions. It started red before the artifact/owner implementation and now
checks frozen verification, malformed revision rejection before database work,
unknown fields, digest tampering, and build/Job cross-pins.

Protocol v9 installs schedule tables and Mutation checkpoint history including
receipt-result digest, through an explicitly acknowledged non-rolling v8
cutover or a fresh bootstrap. The PostgreSQL test rejects unacknowledged v8
cutover and verifies the complete exact v9 catalog. The catalog delta was
generated from an isolated PostgreSQL 17 database by
`tests/support/static-schedule-catalog-candidate.ts`; the previous v8 schema and
checksum remain immutable. Runtime readiness expects v9 and the candidate CLI
has `--allow-non-rolling-protocol-v9` for migration.

The focused compiler, Runtime, and questpie typechecks, targeted lint and format,
`bun run architecture:check`, and `git diff --check` pass. Workspace resolution
for compiler, Runtime, and questpie was checked and points inside this isolated
worktree. The public package was built locally to supply its declaration and
runtime imports; root `node_modules` is not a canonical-worktree symlink.

## Remaining integration boundary

This test exercises real Context and real ordinary acceptance, but manually
composes the Job descriptor and acceptance callback. The main integrated
candidate owns fully generated application composition, schedule activation
command, real worker/restart/checkpoint tracers, and protocol-dependent
regression gates. The compiler candidate separately tests actual generated
artifacts through this verifier. Neither focused result substitutes for those
integrated gates or a formal acceptance PASS.
