# BETA-06 implementation context

- Status: implementation decision record for issue #293
- Base: `740f2e0049a64f5a541f33ab8da44cf8e114041b`
- Authority: ADR-0010, ADR-0011, ADR-0013, ADR-0016, ADR-0021,
  `docs/v4/query-mutation-and-lifecycle.md`, and
  `docs/v4/transactional-dispatch-and-reaction.md`

## Bounded outcome

BETA-06 adds one network-exposed `message.publish` Mutation to the existing
collaboration Runtime. The Mutation normalizes caller text, assigns its key,
author, audit, and timestamp values from transaction-stable facts, rechecks the
current Membership after any row-lock wait, and atomically records:

- the Message;
- its transactional audit row;
- one bounded committed Message change fact;
- one immutable pending Reaction intent; and
- the exact Operation result receipt.

An exact duplicate call returns the stored result and does not execute any of
those writes again. Reusing the scoped call identity with different canonical
input fails. Cancellation before commit rolls everything back. Cancellation or
response loss after commit never claims rollback; replay with the same call
identity recovers the committed result.

This slice does not implement Change Ledger reconciliation or triggers. BETA-07
owns them. It does not create a Durable Run, attempt, lease, worker, retry, or
Reaction handler. BETA-08 owns those. The change fact and pending intent here
are only transaction-joined acceptance records needed by those later slices.

## Public seam

The only new authored Operation is the already accepted generated factory:

```ts
export const publishMessage = defineMutation({
	name: "message.publish",
	network: true,
	input: codec.object({
		channelId: codec.uuid(),
		body: codec.text(),
	}),
	output: codec.object({
		id: codec.uuid(),
		channelId: codec.uuid(),
		body: codec.text(),
		createdAt: codec.timestamp(),
	}),
	policy: policy.authenticated(),
	errors: {
		idempotencyConflict: operation.error({
			code: "IDEMPOTENCY_CONFLICT",
			status: 409,
			payload: codec.object({ callId: codec.uuid() }),
		}),
	},
	handler: async ({ input, ctx }) => {
		// Exact generated reads, writes, and dispatch only.
	},
});
```

Generated direct and client calls use
`mutations["message.publish"](input, { callId?, signal?, deadline? })`. The
Runtime may mint a UUID call ID only when the caller omits it; a retrying caller
preserves it. Direct, Fetch, and generated-client calls enter the same Operation
engine.

The Mutation Context adds exact Policy-aware reads and writes,
`operationTime`, `callId`, `transactionId`, and the one typed dispatch member.
It contains no raw SQL or transaction handle, Policy bypass, System elevation,
external-effect Service, Action, Queue, generic dispatch bag, or lifecycle
hook.

The inline handler remains opaque executable code. The compiler does not infer
semantics by slicing its JavaScript AST, and BETA-06 adds no new declarative
property to `defineMutation`. Compiler-owned Mutation, value, and transaction
artifacts describe the statically available generated Collection operations,
Policy programs, dispatch slots, limits, fixed lifecycle, and executable
binding. Transaction-bound generated Context methods execute those closed
programs.

## Transaction and receipt algorithm

The PostgreSQL owner uses one pinned `READ COMMITTED` transaction. It is not a
generic transaction/provider abstraction and it is not an automatic handler
retry loop.

1. Decode exact input and compute its canonical digest before SQL.
2. Resolve Context and Operation admission.
3. Insert an `executing` receipt keyed by application, Tenant, Operation,
   Principal, and call ID with `ON CONFLICT DO NOTHING RETURNING`.
4. A conflict loser waits on the unique index. Its next statement sees the
   committed receipt, rejects a different input digest, or returns the exact
   stored result bytes.
5. The owner freezes `operationTime` and transaction identity, locks the target
   row, then performs current-row, Membership-evidence, supplied-Field, complete
   candidate, and candidate-Policy checks in fresh statements after the lock.
6. Business, audit, change-fact, pending-intent, and final result-receipt writes
   commit once.

An `executing` receipt is never durably stranded because its insertion and
finalization share the business transaction. A winner rollback releases the
unique-index waiter, which can then become the owner.

The fixed phase order remains decode, admission, consistency boundary, row
scope and lock, supplied-Field authority, pure normalization, schema defaults,
server values, complete candidate validation, candidate Policy, PostgreSQL
Constraints, selection, output authority, output validation, commit, and
encoding.

## Internal PostgreSQL ownership

Operation receipts, bounded change facts, and pending intents are framework
truth under `questpie_internal`, not application-authored Collections or an
outbox. The existing checksum-pinned internal protocol cannot be silently
mutated. BETA-06 must add a deterministic, advisory-lock-protected protocol
upgrade and verify the exact catalog, ownership, privileges, constraints, and
B-tree indexes. Fresh bootstrap and v1 upgrade must converge to identical
bytes and catalog shape.

The application still evolves through an ordinary committed migration for its
transactional audit Collection. Previously accepted migrations and Seeds stay
byte-identical; any new Seed is immutable and dependency-ordered.

## Limits and failures

- maximum input and result: 1,048,576 bytes;
- maximum pending Reaction payload: 262,144 bytes;
- maximum business rows written by this Mutation: 100;
- maximum transaction duration: 5,000 ms;
- one root transaction, no savepoints, no nested Mutation;
- no automatic retry around handler code or Services.

Malformed input fails before SQL. Missing and Policy-invisible targets remain
nondisclosing. Candidate denial and PostgreSQL Constraint conflicts expose no
raw database detail. `IDEMPOTENCY_CONFLICT` classifies the same scoped call or
dispatch identity with different canonical input. A post-commit lost result is
`COMMITTED_RESULT_UNAVAILABLE` and carries only the stable call and transaction
identity required for recovery.

The generated Mutation Service projection contains only the transitive `read`
Service subgraph. An external-effect Service is absent at type level and is
also rejected defensively when Runtime bindings are verified.

## First tracer and evidence

The first RED is `tests/integration/beta06-publish-mutation.test.ts`. It authors
the real fixture Mutation and crosses compilation, generated direct/client
contracts, the shared Operation engine, and PostgreSQL. It proves sequential
and concurrent duplicate delivery plus discarded-response replay produce one
Message, audit, change fact, pending intent, and result receipt with one shared
transaction identity and byte-identical result.

Focused evidence then adds:

- generated Mutation Context/client type negatives;
- exact Mutation/value/transaction, Origin, executable, wire, and explanation
  artifacts;
- forbidden sparse Field, candidate denial, constraint conflict, same-key
  different-digest, and unsafe-Service hostiles;
- a lock waiter whose Membership is revoked before its post-lock recheck;
- pre-commit cancellation and post-commit ambiguity/recovery;
- PostgreSQL 16, 17, and 18 atomicity/concurrency evidence; and
- an honest local Mutation microbenchmark plus selected-PR PostgreSQL 17
  measurement and tagged stable-runner release budget.

## Explicit absences

No generic lifecycle hooks, transaction callbacks, application outbox, raw SQL
authoring, provider matrix, automatic transaction retry, Action, generic Job,
Change Ledger reconciliation, Reaction execution, worker, lease, Queue client,
non-B-tree Index, or RLS claim enters BETA-06.
