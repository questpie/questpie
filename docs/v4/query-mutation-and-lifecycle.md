# Query, Mutation, Collection Operations, and lifecycle contract

> ADR-0026 supersedes forward Workflow references. Checkpointed orchestration
> is a closed Job projection, not another Resource or factory.

- Status: Accepted
- Projection: verified by independent factual, prose, and example audits
- Date: 2026-08-13
- Scope: semantic Query, transactional Mutation, Collection Operation Sets,
  exact generated contracts, call identity, errors, cancellation, and explicit
  lifecycle ownership
- Authority: ADR-0011, ADR-0030, ADR-0031, and foundational P3 proof head
  `a09bf55f0e22f65e059cda9f3eda914520dd4f9d`
- Lifecycle delta evidence: `prototypes/collection-lifecycle-boundary/acceptance-manifest.json`
  and `prototypes/collection-lifecycle-boundary/REVIEW-CODEX-EXCEPTION-THIRD-REPLACEMENT-PASS.md`

## Boundary

This contract accepts P3 only. It does not implement a production compiler or
Runtime. It reserves typed transaction-owned dispatch intent but does not
accept P4 Live Query/Change Ledger or P5 durable Reaction delivery, leasing,
retry, or retention.

The foundational proof at `d03358b7` fixes Schema, Data Contract, structural
Query, cursor, binding, and dependency bytes. ADR-0009/P1 head `713485a6` fixes
the Current App Contract, inline handler, Package isolation, and no-registry
rules. ADR-0010/P2 head `5fbd9058` fixes Context, relational Policy, SQL scope,
nondisclosure, and lock-recheck semantics. P3 consumes their canonical digests
without reinterpretation.

## Named semantic Operations

An application imports generated, application-specialized factories from its
Current App Contract:

```ts
import { defineMutation, defineQuery } from "#questpie/app";
import { codec, operation, policy } from "questpie";
```

Each local exported Definition owns its Resource Identity, input, output,
declared errors, Policy, exposure, limits, Origin, Executable Slot, and inline
handler. The compiler can infer a closed supported output. Use `output` when the
contract must remain independent of inference or is recursive. A pin validates
the handler return and supplies its runtime codec; it never casts a value.

Query Context contains exact Policy-aware read methods and
`ctx.data.run(plan, input)`. It contains no write, dispatch, raw SQL, database,
transaction, Policy-bypass, external-Action, or ordinary System capability.
Every Query owns one bounded consistent read snapshot. The accepted PostgreSQL
choice for a multi-statement semantic Query is `REPEATABLE READ READ ONLY`.

Mutation Context adds exact Policy-aware writes, `ctx.now`,
`ctx.callId`, `ctx.transactionId`, and typed `ctx.dispatch`. One Mutation owns
exactly one PostgreSQL transaction. Every generated read and write, complete
candidate check, PostgreSQL Constraint, audit write, result receipt, and
dispatch intent joins it.

## Collection Operation Set

`defineCollectionOperations(collection, body)` is closed authoring shorthand:

```ts
export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	network: true,

	list: { data: channelMessagePage },
	get: { select: { id: true, title: true, body: true, createdAt: true } },
	create: {
		input: ["channelId", "title", "body"],
		normalize: ({ input }) => ({
			title: operation.text.trim(input.title),
		}),
		values: ({ principal, tenant, operationTime }) => ({
			companyId: mutation.overwrite(tenant.id),
			authorId: mutation.overwrite(principal.id),
			createdAt: mutation.overwrite(operationTime),
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: {
			id: true,
			channelId: true,
			authorId: true,
			title: true,
			body: true,
			createdAt: true,
			updatedAt: true,
		},
	},
	update: {
		input: ["title", "body"],
		normalize: ({ input }) => ({
			title: operation.text.trimIfPresent(input.title),
		}),
		values: ({ operationTime }) => ({
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, title: true, body: true, updatedAt: true },
	},
	delete: { select: { id: true } },
});
```

A generated write is still a named Mutation. If the target Collection can
raise a lifecycle issue, its `create` or `update` member declares payloadless
`errors` and the same explicit Operation-level `issueMappings` shape as an
authored Mutation. The compiler rejects an unmapped reachable issue; it never
borrows another Operation's error map or gives transport meaning to the
Collection issue.

This retained Collection Operation Set block is temporary compatibility
authoring. Its `operationTime` spelling remains only until that adapter is
migrated; named Mutation and lifecycle Context use `ctx.now`.

The compiler lowers each selected member before Manifest emission:

| Member   | Ordinary Resource          | Consistency owner     |
| -------- | -------------------------- | --------------------- |
| `list`   | Query `messages.list`      | read snapshot         |
| `get`    | Query `messages.get`       | read snapshot         |
| `create` | Mutation `messages.create` | one write transaction |
| `update` | Mutation `messages.update` | one write transaction |
| `delete` | Mutation `messages.delete` | one write transaction |

Each child has its own Resource Identity, Owner, member Origin, codecs, Policy,
limits, observation path, Executable Slot, and exact generated alias. Runtime
sees only ordinary statically bound Resources. There is no runtime CRUD
dispatcher or separate Studio backend.

## Field provenance and trusted values

ADR-0030 adds Field provenance to the existing generated Collection
create/update kernel:

| Field declaration               | Caller create input | Caller update patch | Trusted `values` |
| ------------------------------- | ------------------- | ------------------- | ---------------- |
| default                         | allowed             | allowed             | allowed          |
| `immutable: true`               | allowed             | forbidden           | create only      |
| `server: true`                  | forbidden           | forbidden           | allowed          |
| `server: true, immutable: true` | forbidden           | forbidden           | create only      |

`collection.createInput()` and `collection.updateInput()` derive exact Codec
objects from this matrix. Object-map `.pick({ field: true })` and
`.omit({ field: true })` preserve the selected Field codecs and reject unknown
Fields. A derived helper intentionally evolves when a new Field belongs to its
provenance surface; a named Operation pins a smaller key set with `pick` or
`omit`. The selected Fields' own scalar, bounds, nullability, and nested Codec
semantics continue to follow the Collection and intentionally evolve the
Operation contract.

Named Mutations compose the same kernel through typed `ctx.data`. Caller values
use `input` or `patch`; Mutation-owned assignments use the distinct exact
`values` object. The lanes cannot overlap. Trusted values bypass only caller
Field authority. Scalar normalization runs independently on both lanes, and the
complete merged candidate still passes validation, candidate Policy, and
PostgreSQL Constraints. A values-only update is work; an update with both lanes
empty rejects. Required Fields absent after input, values, defaults, and
nullable SQL `NULL` construction fail before the write.

The internal create/update kernel exists without public exposure. Neither a
Collection nor an input helper publishes an Operation, and this extension does
not add an automatic get/list/delete surface.

## Collection lifecycle programs and issues

A Collection may declare payloadless issues and exactly four lifecycle phases.
The callbacks use ordinary TypeScript syntax, but the compiler lowers supported
syntax into one canonical Lifecycle Program; Runtime never calls authored
lifecycle JavaScript. `normalize` and `validate` are effect-free and receive no
generated effect capability. `check` adds bounded Policy-aware reads.
`afterWrite` adds sequential bounded kernel reads/writes plus Job acceptance and
remains pre-commit. No phase can reach an ambient global, import, Service,
Action, Request, Route, raw SQL, or raw transaction.

`validate` and `check` throw generated Collection Issues. Issues carry no public
code, status, message, or payload. Each named Mutation structurally maps all
transitively reachable issues to its own payloadless declared Operation errors.
The first issue raised in program order dooms the transaction and wins. Mapping
runs after rollback in the shared Operation engine; an absent or forged mapping
becomes sanitized `INTERNAL`. Missing and Policy-invisible rows remain
indistinguishable, and PostgreSQL failures never become Collection Issues.

## Fixed write lifecycle

The accepted order is:

1. decode exact Operation input;
2. enforce Operation admission;
3. open the Mutation-owned transaction and freeze `now`;
4. decode exact Collection caller `input` or `patch` and trusted `values`;
5. reject unknown Collection keys and lane overlap;
6. apply existing/current row scope and lock;
7. authorize only canonical caller-supplied Field paths;
8. normalize supplied caller and trusted Field scalars separately, then run the
   authored `normalize` program over each lane without changing its paths;
9. construct create defaults and nullable SQL `NULL`, or start update from the
   locked current row without reapplying create defaults;
10. overlay normalized trusted `values`;
11. reject a missing required candidate Field;
12. validate every Field in the complete candidate against its framework Codec;
13. run authored `validate`;
14. enforce candidate Policy;
15. run authored Policy-aware `check`;
16. enforce PostgreSQL Constraints, materialize database-owned `onUpdate`
    values, and return the written row;
17. run pre-commit `afterWrite`, including bounded nested kernel work and Job
    acceptance in authored order;
18. select the result and apply output Field authority;
19. validate and materialize the output codec;
20. write the result receipt and commit once;
21. encode the result.

This candidate validation is framework Field and Codec validation, not an
authored lifecycle callback. Policy decides caller Field authority before
normalization can change a supplied path. A named Mutation may derive trusted values from its input,
Policy-aware transaction reads and locking reads, `ctx.now`,
`ctx.callId`, and ordinary TypeScript expressions over those values. Runtime
does not inspect arbitrary Mutation-handler TypeScript provenance. `createdAt`
remains an ordinary Field. An `updatedAt` Field may instead declare
`onUpdate: "now"`; then PostgreSQL owns it and neither caller nor trusted lane
may supply it.

Use an inline named Mutation when work spans Collections or owns a public
application error. Reusable row-local invariants belong to `validate`;
database-backed invariants belong to `check`; bounded transactional audit and
Job acceptance may belong to `afterWrite`. External effects belong to an Action
or accepted Job attempt, never `afterWrite`. There is no `afterRead`, priority
registry, or general hook catalogue.

## Errors, cancellation, and stable call identity

Runtime codecs reject malformed values and unknown public input keys before
SQL. Missing and Policy-invisible targets share one nondisclosing result.
PostgreSQL detail, stack traces, and protected existence never cross the public
boundary. Declared application errors retain exact literal codes and payloads;
unknown thrown values become one sanitized internal error.

The Operation Context carries an immutable deadline and cancellation signal.
Cancellation before commit aborts the transaction. Cancellation after commit
cannot undo state and returns `COMMITTED_RESULT_UNAVAILABLE` with the stable
call and transaction identity. Response loss after commit has the same recovery
boundary.

Mutation identity is scoped by application, Tenant, Operation, Principal, and
`callId`. It binds the canonical input digest. The transaction stores a receipt
with the exact result bytes and transaction facts. An exact retry returns those
bytes and does not apply business, audit, or dispatch-intent writes twice. A
reused call identity with different input fails. The Runtime may mint a call ID
when a direct caller does not supply one; a retrying caller must preserve it.

ADR-0023 fixes the public identity text shared by direct and wire entry. It is
not UUID-only: it contains 1–256 valid Unicode scalar values, is already NFC,
contains no U+0000, and occupies at most 1,024 UTF-8 bytes. Runtime rejects an
invalid identity instead of normalizing it. A generated UUID is only the
default when the caller omits the value.

Direct and wire entry use distinct adapters over the same engine. Direct calls
preserve runtime values such as `Date`. Wire calls encode and decode through the
compiled codec. Both paths produce equivalent typed results, declared errors,
nondisclosure, and transaction outcomes.

For `COMMITTED_RESULT_UNAVAILABLE`, both paths expose literal code,
`retryable: true`, and frozen `{ callId, transactionId }`. Wire v2 uses HTTP
`500`, preserves `callId` at frame level, and carries canonical PostgreSQL
`xid8` text as `error.transactionId`. Retryability authorizes exact same-call
recovery; it never enables transport-owned automatic Mutation retry.

## Accepted proof

The foundational P3 proof head
`a09bf55f0e22f65e059cda9f3eda914520dd4f9d` passed one final fresh focused
Opus-medium acceptance review. ADR-0031 adds the manifest-bound lifecycle and
issue-mapping delta reviewed at
`ca7d18e3fce4b55bd0e0ce36aa212a48dcec7af1`; the committed human-authorized
GPT-5.6-sol high replacement record reports `PASS` with no blockers. The
foundational P3 proof includes:

- a real four-Collection `REPEATABLE READ READ ONLY` snapshot across a
  concurrent committed update;
- one PostgreSQL transaction ID shared by Message, Channel, Message Event,
  pending dispatch intent, and result receipt;
- sequential and concurrent duplicate delivery, changed-input reuse,
  discarded-response replay, pre-commit cancellation, and post-commit
  ambiguity/recovery;
- all five Operation Set members differentially executed against independently
  authored ordinary Resource contracts and handlers, with contract and handler
  drift negative controls;
- exact inferred, explicit, and recursive pinned output types and negative
  capability tests;
- a materially different Archive/Record/ResearchPermit domain with a composite
  key and no `id` assumption;
- 16 ordinary B-tree indexes, no expression or partial index, zero RLS-enabled
  tables, and zero PostgreSQL policies.

Canonical P3 digests:

| Artifact                 | Digest                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| Operation projection     | `ffd37a828648e97b96950d71421df04aff62f83788f3e2bd957f53c17bdb0d0c` |
| Collection Operation Set | `19f402f1e07cb7f344d96a3c04e36754f9dd272a478eed5e090152745a897d20` |
| Normalizer program       | `b2250e821ecd809b3611a5a6a7cb7d459aa503148953228927dcf82b5df28732` |
| Server value program     | `5e8fa4647641084ba9ae07ee377d4d4c8c9934c7e398b5d675fee806dacc54e2` |
| Transaction projection   | `c05d22df81ebb0f617f33333ed82e2b6cd5943b17ce624b6c520ca4c21af2bef` |
| Lifecycle projection     | `ef164581c598f75458e8154c42e1af38296b56e20a3466dee1562c458674dabb` |
| Error projection         | `7c35862ad4edfa7e932b7f4bf93d83c18e736bcc31e334a66e84b246bd3da48d` |
| Result envelope          | `46548a2459b5d93f43f720d0f7db3ae4762c85d5873ee01809b86d7d19c92552` |
| Operation explanation    | `65f8749dfce818b3bec4ac312daa09aad1478415035c25c333465a949a81cc76` |

TypeScript 5.9.2 measured 3,187 types, 4,946 instantiations, 24,116 KiB,
0.52 seconds cold and warm, 0.271 ms completion p95, 0.313 ms hover p95,
and 12,922 bytes of generated application and client declarations.

The PostgreSQL 17.10 concurrent duplicate waited 919 ms for the winning
receipt and returned byte-identical output. These are proof-host observations,
not production performance promises.

## Deferred seams

- P4: observed actual reads, Change Ledger, commit-safe reconciliation,
  replacement dependency sets, watch resume/reset, backpressure, and realtime
  delivery.
- P5: dispatch acceptance, Reaction run-as, durable runs and attempts, leases,
  fencing, retry, cancellation, retention, and external-effect ambiguity.
- P6: production Runtime/Fetch, generated wire framing, Runtime lifecycle,
  deployment compatibility, Execution Envelope, and Studio.
- Later: native SQL, savepoints, nested Mutations, aggregates, backward
  pagination, typed JSON-interior querying, non-B-tree indexes, broad RLS,
  complete Route/Action/Auth/File/Search/Job/Workflow surfaces.

If an Operation SQL workload needs an expression, partial predicate, operator
class, native statement, or non-B-tree access method, work stops at that named
later seam. It cannot expand the foundational Index authoring contract through
P3.
