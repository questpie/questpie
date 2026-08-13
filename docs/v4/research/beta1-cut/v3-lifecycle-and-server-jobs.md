# V3 lifecycle and server jobs for the beta.1 cut

- Status: research evidence; no v4 acceptance authority
- Question: which v3 Collection write, lifecycle, transaction, and server jobs
  are necessary for a minimal `4.0.0-beta.1`, and which belong to a later
  operation-lifecycle chapter?
- Evidence baseline: local v3 worktree
  `/home/drepkovsky/code/questpie` at commit
  `9873f08eacd0565fb6b462a5196e90bfcc0295fb`, package version `3.27.1`
- Scope rule: v3 behavior is evidence about user jobs and failure cases. Its
  builders, callback names, Drizzle exposure, ambient context, generated shape,
  and HTTP routes do not define v4.

## Result

The smallest credible beta write vertical is not “CRUD plus hooks.” It is one
safe server execution path from the generated client to a Collection write:
decode and validate input, enforce Policy, derive framework-owned write facts,
perform the canonical write in one owned PostgreSQL transaction, map expected
database failures, and return a typed committed result. The same Collection
types must drive direct server calls and the generated client.

V3 contains strong evidence for this core: transactional nested Collection
writes, rollback of transaction-joined ledgers, claim-checked conditional
writes, consistent client/server row types, and explicit failure envelopes.
Those are jobs worth preserving.

V3 also demonstrates why the full hook lifecycle should not be pulled into the
beta mechanically. Ordinary create and update transformations can run before
the write transaction is opened; hook context exposes a very broad service and
database surface; nested transactions silently reuse the parent rather than
creating savepoints; output hooks can reject a response after the write has
committed; and in-memory after-commit callbacks are lossy and cannot affect the
committed result. Those are boundaries to redesign or defer, not compatibility
requirements.

## What v3 actually does

### Collection operation surface

V3 server CRUD exposes `find`, `findOne`, `count`, `create`, by-id update and
delete, bulk update and delete, per-record update batches, restore, purge,
locking, versioning, and workflow operations. Its own type comments already
identify an API seam: server `update` and `delete` historically mean bulk by
predicate while the generated client uses the same names for by-id operations;
the v3 types deprecate those aliases for v4
(`packages/questpie/src/server/collection/crud/types.ts:1561-1673`).

The Fetch adapter resolves request context and then delegates directly to the
same Collection CRUD object used by local server code. For example, create calls
`crud.create`, and update calls `crud.updateById`, preserving the resolved
context (`packages/questpie/src/server/adapters/routes/collections.ts:105-150`,
`:193-255`). This is evidence for one semantic server path across local and
network entry points, not evidence for preserving the REST route layout.

### Create pipeline

The v3 create path performs these observable jobs:

1. establish ambient request context;
2. run `beforeOperation`;
3. enforce row-level create access;
4. run `beforeValidate`;
5. separate nested relation commands and normalize JSONB input;
6. enforce Field write access and parse the generated insert schema;
7. run Field input hooks and Collection `beforeChange`;
8. open or join a transaction, write the row, localized values, nested
   relations, and version data;
9. re-read the canonical row and run `afterChange` inside the transaction;
10. after commit, run Field output and Collection `afterRead` transformations,
    then filter output Fields.

The actual ordering and transaction boundary are visible in
`packages/questpie/src/server/collection/crud/crud-generator.ts:1684-1830`,
`:1858-1888`, `:1941-2023`. The crucial finding is that access, parsing, Field
input hooks, and `beforeChange` normally happen before the create path opens its
transaction at line 1829. V3 documentation presents a simpler lifecycle, but
the source boundary is the authoritative evidence.

### Update pipeline

The update path pre-reads candidate rows, checks access, transforms and parses
the shared patch, then opens the write transaction. Inside it, v3 locks and
rechecks candidates, writes only winners, refreshes the saved rows without
output hooks, records versions, and runs each `afterChange` chain sequentially.
Only after commit does it run Field output hooks, `afterRead`, and Field output
filtering (`packages/questpie/src/server/collection/crud/crud-generator.ts:
2171-2465`, `:2470-2581`, `:2613-2758`).

The in-transaction refresh explicitly skips output hooks because nested CRUD
from an output transform previously serialized parallel work onto one Bun SQL
transaction connection and could deadlock it
(`packages/questpie/src/server/collection/crud/crud-generator.ts:2623-2640`).
This is direct evidence that output shaping and transaction-owned mutation work
need distinct phases.

For non-optimistic collections, the pre-read and `beforeChange` occur outside
the write transaction. V3 added a write-time claim step to close the predicate
TOCTOU window: candidate rows are locked in deterministic id order and the
original predicate is re-evaluated under the transaction
(`packages/questpie/src/server/collection/crud/crud-generator.ts:2029-2090`,
`:2482-2513`). Tests demonstrate that a stolen candidate is not written, does
not run `afterChange`, and does not get a version snapshot
(`packages/questpie/test/collection/conditional-update-race.test.ts:94-169`),
and that a bulk operation reports only its winning rows (`:171-225`).

This closes the conditional-write race, but it does not make an arbitrary
pre-transaction transformation a transactionally consistent calculation over
the original row. That remaining distinction matters to the v4 operation
contract.

### Delete pipeline

V3 delete enforces access and `beforeDelete`, then performs soft or hard delete,
version capture, and fatal `afterDelete` work. `afterDelete` failure rolls back
the deletion (`packages/questpie/src/server/collection/crud/crud-generator.ts:
2772-2857`, `:2910-2988`). For legacy non-optimistic collections the code
deliberately preserves an “intent hook” before the write-time claim, because
taking the row lock before those hooks exposed deadlocks
(`packages/questpie/src/server/collection/crud/crud-generator.ts:2835-2853`).

The rollback behavior is real: tests cover rollback of soft and hard deletes,
nested writes, channel entries, and realtime entries when transaction-bound
effects fail (`packages/questpie/test/collection/transaction-bound-hooks.test.ts:
342-379`, `:418-443`, `:666-776`). Physical purge has a separate, substantially
larger irreversible lifecycle with revalidation against hook mutation
(`packages/questpie/src/server/collection/crud/crud-generator.ts:3015-3237`).
That is useful later evidence, but it is not required merely to prove a normal
Collection write in beta.1.

### Validation and transformations

V3 generates insert and partial-update schemas from Collection columns, then
overlays Field-owned schemas and refinements. Field definitions are the
validation source where present; database-column schemas remain for system and
legacy fields (`packages/questpie/src/server/collection/builder/
validation-helpers.ts:140-205`, `:209-269`). The CRUD path converts parse errors
before the database write (`packages/questpie/src/server/collection/crud/
crud-generator.ts:1777-1800`, `:2396-2422`).

Field input hooks can validate and successively transform a value on create or
update; output hooks hydrate stored values and may transform them after read
(`packages/questpie/src/server/fields/runtime.ts:89-185`). Collection hooks add
raw-input normalization, post-validation transformation, transaction-bound
reaction, and output transformation. Tests verify ordered transformation and
abortion from `beforeChange`
(`packages/questpie/test/collection/collection-hooks.test.ts:206-243`,
`:329-356`).

The jobs are separable:

- decoding, Field validation, Collection-wide validation, defaults, and a
  canonical write value are necessary to make a beta write safe;
- arbitrary user transformation phases, output rewriting, global hook chains,
  bulk metadata, purge hooks, workflow hooks, and external reactions are a
  broader operation-lifecycle product.

V3 ordering also exposes a decision that cannot remain accidental: create
checks Field write access before schema parsing, while update parses before
Field write access (`apps/docs/content/docs/schema/validation.mdx:139-159`). A
v4 hostile case must pin which error is observable when input is both malformed
and unauthorized.

### Timestamps

V3 synthesizes `createdAt` and `updatedAt` columns by Collection option, both
with database `defaultNow()` (`packages/questpie/src/server/collection/builder/
collection.ts:506-521`). Every update injects a new `updatedAt` in the CRUD
implementation (`packages/questpie/src/server/collection/crud/
crud-generator.ts:2562-2581`). It also offers Field helpers that implement
automatic update time as a `beforeChange` Field hook
(`packages/questpie/src/server/modules/core/fields/datetime.ts:84-113`).

V3's millisecond-precision timestamp tests capture a valid interoperability job:
returned JS instants must equal stored values and remain safe in equality and
keyset comparisons (`packages/questpie/test/collection/system-timestamps.test.ts:
1-72`, `:99-148`). The accepted v4 foundation has already rejected hidden
system Fields: `createdAt` and `updatedAt` are explicit ordinary timestamp
Fields; a default may initialize them, and automatic `updatedAt` belongs to the
later Mutation design. V3 is therefore evidence for precision and mutation-time
semantics, not for restoring `.options({ timestamps: true })`.

## Transaction and effect evidence

### Ownership and nesting

`withTransaction` uses `AsyncLocalStorage`. A top-level call opens one database
transaction; every nested call reuses the exact parent transaction and queues
callbacks on the outermost context. It does not create a savepoint
(`packages/questpie/src/server/collection/crud/shared/transaction.ts:315-355`).
Tests pin callback discard on rollback, registration ordering, parent reuse, and
shared transaction identity
(`packages/questpie/test/collection/on-after-commit-hooks.test.ts:23-162`).

This proves the job “nested Collection writes join the operation transaction.”
It does not prove nested transaction semantics. In v3 a caught inner failure
has no independently rolled-back savepoint, because there was no inner
transaction. V4 must either prohibit that interpretation or specify savepoints;
it must not call parent reuse a nested transaction without qualification.

V3's cross-Collection HTTP transaction runs an ordered allowlisted list of
create, update, and delete operations inside one server transaction. It
preserves Principal context per operation, limits the batch to 100, and reports
the failing index while rolling back all rows and realtime entries
(`packages/questpie/src/server/adapters/routes/transaction.ts:1-50`,
`:107-220`, `:280-362`). Integration tests prove one transaction id across
three Collections, rollback on validation or Policy failure, per-operation
authorization, ordered visibility, generated-client reachability, and rejection
of unknown verbs or Collection keys
(`packages/questpie/test/integration/cross-collection-transaction.test.ts:
98-186`, `:188-318`).

That is strong evidence for an eventual multi-write server command, but beta.1
does not need to copy the generic public transaction endpoint to prove one
Collection Mutation. Its lock-order and partial-language choices belong to the
operation contract.

### Transaction-joined work

V3 `afterChange` and `afterDelete` can perform nested Collection writes and
append channel, realtime, and queue-dispatch rows through the ambient
transaction. A thrown hook rolls those rows back with the owner write. Both
mock-backed and PostgreSQL tests pin this behavior
(`packages/questpie/test/collection/transaction-bound-hooks.test.ts:342-443`,
`packages/questpie/test/collection/transaction-bound-hooks-postgres.test.ts:
42-179`). Queue tests further show why durable dispatch differs from a plain
callback: a business rollback creates no dispatch, while a committed pending
dispatch survives a failed post-commit publication and can be drained later
(`packages/questpie/test/integration/queue-transactional-dispatch.test.ts:
143-198`).

The beta seam should therefore avoid making “run arbitrary external code after
write” the only extension point. A later Reaction or durable-work design needs
the committed change and transaction identity even if beta.1 ships no queue.

### External work after commit

`onAfterCommit` queues callbacks until the outermost commit. Callbacks run
sequentially, but their errors are logged and swallowed because the business
transaction is already committed. Outside a managed transaction the callback
runs immediately and fire-and-forget
(`packages/questpie/src/server/collection/crud/shared/transaction.ts:197-270`,
`:342-354`). The v3 product documentation explicitly classifies this mechanism
as in-memory, at-most-once, unrecoverable after a process crash, and unsuitable
for work that must succeed (`apps/docs/content/docs/schema/hooks/
side-effects.mdx:65-92`).

`afterRead` is another post-commit hazard. It can transform the returned value,
but if it throws after create or update, the caller sees failure while the row
remains committed (`apps/docs/content/docs/schema/hooks.mdx:121-125`,
`:161-185`). Beta error semantics must not imply rollback merely because
response shaping failed.

## Generated server and client boundary

V3 codegen derives the server Collection API map and handler context from the
discovered `AppCollections`; the same generated file emits a flat `AppConfig`
for `createClient<AppConfig>()`
(`packages/questpie/src/cli/codegen/template.ts:821-881`, `:916-1015`,
`:1423-1446`). The client maps each generated Collection key to schema-derived
row, relation, input, and operation types
(`packages/questpie/src/client/index.ts:420-470`, `:746-755`). Its runtime proxy
serializes those calls onto Fetch routes
(`packages/questpie/src/client/index.ts:1490-1599`, `:1870-1891`).

The valuable job is parity: a Collection has one application-derived row and
input vocabulary on server and client, and phantom Collection names fail type
checking. The v3 mechanism still couples the client type to imported TypeScript
definitions and preserves server-only historical vocabulary underneath. The v4
compiler research must decide how the accepted App/Data/Query artifacts generate
that surface; v3's `AppConfig` type and proxy implementation are not a protocol.

## Candidate beta.1 jobs to preserve

These are research conclusions for the beta cut, not accepted v4 API:

| Job | Why it is beta-critical | V3 evidence |
| --- | --- | --- |
| One semantic path for direct server and generated-client calls | Network and local callers must not get different validation, Policy, or write semantics. | Fetch delegates to the same CRUD object; `collections.ts:105-150`, `:193-255`. |
| Runtime input decoding and Field/Collection validation before SQL | A generated type alone cannot protect an untyped network payload. | Generated schemas and CRUD parsing; `validation-helpers.ts:140-269`, `crud-generator.ts:1777-1800`. |
| Policy and Field-write enforcement on every entry point | Client generation is not authorization. | Cross-Collection transaction retains request Principal and checks every operation; `transaction.ts:17-25`, `:337-352`; integration test `:151-186`. |
| Canonical create and by-primary-key update at minimum | A beta that can only read does not meet the resolved application-author journey. | Common CRUD and client surfaces; `crud/types.ts:1561-1629`, `client/index.ts:543-602`. |
| An explicit answer for delete | Either ship canonical delete with the same guarantees or explicitly exclude it; accidental raw deletion is not acceptable. | V3 has a rollback-safe delete path, but soft delete/purge add independent breadth. |
| One operation-owned PostgreSQL transaction | Row, relation writes, framework bookkeeping, and transaction-joined effects must commit or roll back together. | `transaction.ts:315-355`; transaction-bound hook tests `:342-443`. |
| Nested Collection writes join the owner transaction | Server business logic commonly writes more than one Collection. | PostgreSQL nested-write proof; `transaction-bound-hooks-postgres.test.ts:99-179`. |
| Database constraints remain authoritative and map to declared errors | Races cannot be made safe by preflight validation alone. | CRUD catches and maps database violations after the transactional write; `crud-generator.ts:2000-2007`, `:2729-2733`. |
| A concurrency story for update | At minimum, a by-key update must not silently write a vanished/stale target; richer conditional/bulk semantics may wait. | Claim recheck and optional revision conflicts; `crud-generator.ts:2029-2090`, `:2482-2536`. |
| Framework-owned `updatedAt` behavior, if beta promises it, occurs inside Mutation | The stored post-image and transaction must agree; it cannot be a schema side effect. | V3 injects the value at SQL update time; `crud-generator.ts:2562-2581`. |
| Committed typed result and machine-readable error parity | Generated clients need to distinguish forbidden, validation, conflict, not-found, and internal failures. | Client error shape `client/index.ts:177-229`; transaction failure preservation `transaction.ts:223-277`. |
| Bounded payload and execution limits | A network caller must not hold an unbounded transaction or return an unbounded result. | Cross-Collection batch cap and rationale; `transaction.ts:107-150`. The exact v4 bounds remain undecided. |
| Stable change/transaction identity seam | Later Live Query, durable Reaction, and Studio must attach to committed facts without redesigning Mutation. | V3 records one txid across rows and outbox; `cross-collection-transaction.test.ts:98-128`. |

## V3 mechanics to reject as v4 defaults

- Do not preserve the complete hook-name catalogue as the beta write contract.
  It entangles input normalization, authorization-adjacent logic, arbitrary
  mutation, transactional reactions, output projection, purge, workflows, and
  global interception.
- Do not expose the ORM/database handle and every service to every lifecycle
  phase by default. V3 hook context is assembled from the full app services plus
  `db`, caller facts, bulk metadata, and `onAfterCommit`
  (`packages/questpie/src/server/collection/crud/shared/hooks.ts:48-113`).
- Do not describe work before `withTransaction` as transaction-owned. Normal v3
  create and update transformations are evidence of this mismatch.
- Do not call ambient parent reuse “nested transactions.” It offers no inner
  commit or rollback boundary and no savepoint.
- Do not make lossy `onAfterCommit` the durable Reaction contract. Errors are
  swallowed, crashes lose callbacks, and calls outside a transaction change to
  immediate fire-and-forget behavior.
- Do not let a post-commit output transform produce an error indistinguishable
  from a rolled-back Mutation.
- Do not restore hidden `id`, `createdAt`, or `updatedAt` synthesis. The accepted
  v4 Collection foundation already makes these ordinary explicit Fields and the
  primary key a named constraint.
- Do not preserve `update`/`delete` vocabulary that means different things on
  server and client.
- Do not inherit v3's unbounded generic callback recursion. V3 needs an explicit
  hook-recursion guard before entering the create context
  (`packages/questpie/src/server/collection/crud/crud-generator.ts:1700-1719`),
  which is evidence that re-entrant lifecycle calls require an owned rule.

## Defer candidates for the later operation lifecycle

Deferring these does not mean ignoring their future seam:

- named user transformations before validation and before write;
- Collection-wide and application-wide lifecycle callback composition;
- output rewriting and virtual/computed response Fields;
- transaction-bound Reactions over committed-change facts;
- durable dispatch, Queue, Jobs, external Actions, retries, idempotency, and
  after-commit delivery;
- bulk update/delete and their winner metadata;
- a public cross-Collection transaction language;
- explicit locks, savepoints, isolation selection, automatic transaction
  retries, and deadlock retry policy;
- soft delete, restore, irreversible purge, versions, workflow transitions,
  uploads, localization, and CRDT lifecycle;
- Live Query capture and Studio transaction/change views.

If the beta server internally emits a canonical committed-change fact, that is
an implementation seam for later proof, not permission to publish all of these
products in beta.1.

## Questions the next contract must close

### Preserve

1. Which exact direct server and generated-client operations prove the beta
   journey: create and by-key update only, or delete as well?
2. What runtime codec validates the accepted Field/value grammar, and which
   error wins when input is both unauthorized and malformed?
3. Does each network write map to exactly one Mutation-owned PostgreSQL
   transaction, and do direct server writes use the identical owner?
4. What is the minimum stale/missing-row contract for by-key update without
   pulling bulk conditional writes or optimistic concurrency into the beta?
5. Which transaction and committed-change identities are generated now so
   later Reactions and Live Query can attach without changing Collection bytes?
6. Which bounds apply to input bytes, operation duration, rows written, nested
   calls, result size, and transaction depth?

### Reject explicitly

1. Are user callbacks forbidden before a beta Mutation opens its owned
   transaction, or are transformation phases absent from beta entirely?
2. Is “nested transaction” reserved for an actual savepoint boundary, with
   ordinary nested Collection calls described only as joining the owner?
3. How does the error envelope distinguish pre-commit failure, database
   rollback, post-commit response failure, and an unavailable optional
   extension?
4. Which server-only capabilities are deliberately absent from generated
   network clients, rather than merely omitted by implementation accident?

### Defer without losing the seam

1. What minimal internal fact can a later Reaction consume: attempted input,
   canonical preimage/post-image, changed Field paths, transaction identity, or
   some smaller set? No public Reaction API should be inferred yet.
2. Does beta reserve a durable dispatch write in every Mutation, or merely
   preserve an artifact/runtime boundary where one can be added? The v3 queue
   evidence proves the value of durable dispatch but not that beta must ship it.
3. Will automatic `updatedAt` be a built-in Mutation rule, a declared
   transformation, or an application-owned assignment? The foundation fixed
   only that it is not hidden schema behavior.
4. Are external calls forbidden from retryable transaction scopes later, and
   what retry classes can PostgreSQL surface? V3 has no general automatic retry
   contract to preserve.
5. Is a multi-write named Mutation the eventual replacement for the generic v3
   `/transaction` route? This belongs to the operation chapter, not the beta
   transport implementation.

## Suggested hostile proof inventory

Before beta acceptance, the selected minimal operations should be tested across
direct server execution and the generated Fetch client with identical outcomes:

- malformed input never reaches SQL;
- denied create/update writes nothing;
- an unknown Collection, Field, or operation fails closed;
- a database constraint failure rolls back every joined write;
- a nested Collection write joins the same transaction and rolls back with it;
- a missing or concurrently vanished update target cannot report success;
- an `updatedAt` value, if framework-managed, changes only on a committed
  Mutation;
- returned timestamp values round-trip exactly through the wire codec;
- a process-visible failure before commit returns no committed row;
- no post-commit optional work can make the client believe the Mutation rolled
  back;
- direct and client inputs, results, and declared errors remain type- and
  byte-compatible with the compiled contract;
- restart after a committed write preserves the row without requiring any
  in-memory callback to complete.

This inventory deliberately stops before hook syntax, Reaction delivery,
durable Jobs, Live Query, or Studio. It identifies the seams those later
contracts need without making them part of the first usable server beta.
