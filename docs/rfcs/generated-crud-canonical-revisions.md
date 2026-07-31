# Generated CRUD canonical revisions — implementation packet

Status: ratified from PR #196 at `2f1ea602` and current repository source.

## Decision

QUESTPIE exposes three independent clocks:

- `revision` is the framework-owned canonical live-row revision. Opt-in
  optimistic concurrency requires `expectedRevision` on every mutation of an
  existing collection row or global. Create initializes `revision` to `1`.
- `versionNumber` is the stable per-owner history snapshot sequence.
  `sourceRevision` records the canonical revision captured by a snapshot.
- CRDT commit sequences, field cursors, canonical-field revisions, epochs,
  state vectors, and durable anchors retain their existing meanings and never
  substitute for `revision`.

The unreleased `optimisticLock: { field, required: true }` contract and
`expectedVersion` inputs are removed. The final opt-in is
`optimisticConcurrency: true`; applications never declare or mutate
`revision`.

## Source findings

- Collection locking currently targets an application field and increments it
  in several CRUD branches. Globals have no corresponding contract.
- `createVersionRecord` allocates the next per-owner history sequence with
  `MAX(versionNumber) + 1`. Retention keeps the newest sequence, so cleanup
  does not reset it, but this allocation remains history-only and must never
  drive the canonical revision.
- Revert restores version-table field values and collection-only logic skips
  the configured lock field. Workflow transition writes history without a
  canonical row mutation.
- `findVersions` authorizes a nullable/non-owner row and can query a caller
  supplied owner id, allowing history access to diverge from owner access.
- CRDT projection correctly locks the owner row in the projection transaction,
  validates the exact cut and canonical hashes, then directly updates owner
  columns and appends realtime. That write bypasses revision/history policy.

## Deep-module seam

Introduce one small internal canonical-row primitive shared by generated CRUD
and CRDT projection:

```ts
mutateCanonicalRow({
	transaction,
	table,
	where,
	lockedRow,
	values,
	optimisticConcurrency,
	expectedRevision,
	mode,
});
```

Generated CRUD owns the larger mutation orchestration: it locks and validates
all affected owner rows before mutation hooks, applies main, localized, and
relation writes in one transaction, and snapshots only the committed result.
The primitive performs a guarded owner-table mutation and advances `revision`
exactly once. Revert, workflow, Globals, and CRDT use it directly where their
owner-table mutation would otherwise duplicate or bypass that rule. Ordinary
collection update/delete paths use the same precondition helper and transaction
ordering because their localized/relation and cascade work spans more than the
single-row primitive.

CRDT uses an internal adapter at this seam after its existing exact-cut,
binding, hash, authorization, and suspension checks. A projection aggregate cut
passes all projected owner fields as one internal-mode mutation; its
receipt/cursors and realtime append remain in the same transaction and occur
only after canonical validation succeeds. The projection owner port now
contains a transaction-scoped `prepareAcknowledgement` seam for consumer
validation and derived-relation writes. This PR deliberately does not expose an
application builder callback, transform projected values, or add
product-specific logic; canonicalization must also reconcile CRDT
`canonicalHash` and owner `projectedCanonicalHash` across manifest transitions,
so that typed public registration is the follow-up described below.

## Mutation semantics

| Operation                             | Canonical revision                      | History                                      |
| ------------------------------------- | --------------------------------------- | -------------------------------------------- |
| create                                | initialize to `1`                       | optional snapshot at `sourceRevision: 1`     |
| update, localized-only, relation-only | `+1` once                               | ordinary policy snapshot                     |
| soft delete / restore                 | `+1` once                               | ordinary policy snapshot                     |
| hard delete                           | expected revision required; row removed | optional final delete snapshot               |
| purge                                 | expected revision required; row removed | owner history and locale satellites removed  |
| revert                                | restore old content, `+1` once          | new snapshot with the new `sourceRevision`   |
| workflow transition                   | `+1` once                               | stage snapshot with the new `sourceRevision` |
| CRDT aggregate projection cut         | `+1` once if canonical values change    | explicit/checkpoint policy                   |

Empty/no-op CRDT cuts do not advance the owner revision. Failed or stale
mutations roll back canonical data, relations/localization, history, hooks run
as facts, CRDT receipts/cursors, realtime, and after-commit effects. Bulk
mutations require exact unique per-id revision coverage and share one
transaction.

## Verification order

1. Collection and global schema/type tests for generated `revision` and
   `expectedRevision`.
2. Concurrent CRUD, bulk atomicity, effects, localization/relations,
   delete/restore/purge/revert, workflow, retention, and history authorization.
3. REST/OpenAPI/client/TanStack/Admin propagation and HTTP conflict/ETag
   behavior.
4. CRDT aggregate-cut increment, metadata/projection serialization, direct
   CRDT-field rejection, and rejected-projection rollback.
5. Narrow package gates, adversarial review, then root format/lint/typecheck/
   test/build with baseline failures recorded verbatim.

## Compatibility and migration

The PR contract is unreleased, so no compatibility alias is retained.
Generated database schemas add canonical `revision` columns and history
`sourceRevision`. Existing applications must generate and review a migration
before deployment; production `push` is not supported.

## Follow-up: consumer projection acknowledgement registration

The internal atomic seam is complete and tested, but a public consumer hook is
deferred to avoid coupling this framework change to an unreleased application
callback shape. The follow-up must:

1. add a typed module/builder registration for one acknowledgement handler per
   collaborative owner;
2. expose the complete aggregate cut, owner identity, schema/epoch/commit
   metadata, and transaction-bound application context;
3. let the handler write derived relations with that same transaction and
   define how a canonicalized value is incorporated into CRDT state without
   conflating `canonicalHash` with the owner `projectedCanonicalHash`;
4. reject field-set expansion/removal and treat throws as retryable projection
   failures without acknowledging cursors, receipts, revision, or realtime;
5. define handler-version and replay behavior before it becomes public; and
6. prove authorization, retry, crash recovery, duplicate delivery, and derived
   relation atomicity without adding Autopilot-specific behavior.
