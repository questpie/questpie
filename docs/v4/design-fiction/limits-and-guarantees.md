---
title: Know the limits and guarantees
description: Predict failures, retries, realtime recovery, durable delivery, and deployment compatibility before production.
status: design-fiction
implementation-status: unimplemented
accepted-contracts:
  - foundational Field, Collection, Constraint, Relation, and structural Query contract
  - reviewable transactional schema and Seed artifact protocol
  - static composition, identity, ownership, and generated App Contract direction
  - standalone Runtime and Studio product boundaries
candidate-contracts:
  - application-specialized executable Definition factories from #questpie/app
  - Policy, Query, Mutation, Action, Route, Live Query, Reaction, and Job APIs
  - generated operation wire protocol and immutable Context-scoped client
  - Runtime Build, lifecycle, compatibility, and Execution Envelope
proof-blocked-contracts:
  - exact Policy attachment, SQL lowering, RLS subset, and nondisclosure proof
  - Mutation call identity, duplicate delivery, automatic retry, and response loss
  - commit-safe Change Ledger frontier, resume protocol, and realtime budgets
  - durable leases, fencing, idempotency, cancellation, response ambiguity, and deployment evolution
  - exact Runtime, wire, health, limit, error, and compatibility artifacts
  - complete TypeScript, editor, generated-size, compiler, runtime, and PostgreSQL conformance budgets
  - fresh focused Opus-medium acceptance review for each promoted contract
---

> ADR-0026 supersedes Workflow as a separate product/factory. Equivalent
> checkpoint, timer, signal, and evolution guarantees belong to Job.

# Know the limits and guarantees

QUESTPIE makes ownership visible so you can predict what happens when input is
invalid, Policy denies a row, a transaction conflicts, a response disappears,
a process stops, or a deployment changes code.

The practical rule is:

- a Query owns one read result;
- a Mutation owns one PostgreSQL transaction;
- an Action owns one external effect invocation;
- a Route owns one raw HTTP exchange;
- a Live Query repeatedly executes the same Query under fresh authority; and
- a Reaction or Job owns durable at-least-once work after acceptance.

Those boundaries prevent convenient syntax from silently changing transaction,
authorization, retry, or failure behavior.

This is the final design-fiction chapter. The foundational data contract,
schema lifecycle, and executable Definition compiler mechanics are accepted.
Context, Policy, Operation execution, realtime, durable work, and connected
Runtime guarantees remain candidates until their focused proofs pass.

## Read the status before the promise

| Contract                                                            | Current status                                   | What you can rely on                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Field, Collection, Constraint, Relation, and structural Query       | accepted and proven                              | canonical authored grammar, generated data shape, deterministic query bytes, and the fixed limits below                          |
| migration and Seed artifacts                                        | accepted                                         | reviewed linear history, transactional receipts, checksum verification, and safe retry after a lost apply response               |
| static composition                                                  | accepted                                         | explicit Resource identity, one Owner, Origin for explanation, no runtime merge, and one generated App Contract                  |
| Principal, Authority, Policy, and semantic Operation kinds          | product direction fixed; exact API proof-blocked | one authorization model and distinct Query, Mutation, Action, and Route ownership                                                |
| generated executable Definition factories and Runtime Build pairing | accepted and proven                              | exact stock-editor `ctx`, current-build freshness, slicing, output rounds, Package isolation, static binding, and budgets        |
| Live Query and Change Ledger                                        | candidate                                        | intended observed-read recomputation and reset semantics; commit-safe frontier and bounds remain proof-blocked                   |
| Transactional Dispatch, Reaction, and Job                           | candidate                                        | intended atomic acceptance and at-least-once attempt model; lease, idempotency, response-loss, and deployment proofs remain open |
| Runtime Build, wire protocol, health, drain, and Studio events      | candidate                                        | intended standalone lifecycle and one operational truth; exact artifacts, limits, and compatibility matrix remain open           |

An accepted foundation does not make a later candidate transitively accepted.
For example, a structural data plan has fixed bytes and types, but the network
Query that executes it still needs the Operation and Runtime proofs.

## Know the fixed data limits

The accepted foundational contract has these hard rules:

- Every regular Collection has exactly one named
  `constraint.primaryKey({ fields: [...] })`. `id` is an ordinary Field.
- A Field path is a non-empty segment array. A dotted string is one key and is
  never split into path segments.
- `shape.inline` groups ordinary column Fields. Its leaves keep independent
  Field identity, Constraints, Policy seams, and structural Query behavior.
- `field.object` and `field.array` store bounded typed `value.*` codecs in one
  JSONB Field. Their interior values are not Fields or Relation targets.
- `field.json` stores tagged open JSON. SQL `NULL` and top-level JSON `null`
  remain distinct.
- An entity with identity, Relations, independent Policy, pagination,
  unbounded cardinality, or its own lifecycle is an explicit Collection.
  QUESTPIE never creates a hidden mini-Collection.
- Foundational text comparison uses `questpie.binary`, lowered to PostgreSQL
  collation `C`. Locale-sensitive ordering needs a later explicit contract.
- A structural Query has an exact selection, closed filter, explicit total
  order, forward cursor page, one-hop Relations, and declared dependencies.
- One structural Query page returns at most 100 rows. Offset and backward
  pagination are not part of the foundational contract.
- A bounded scalar-list parameter validates its authored member bound before
  deduplication, rejects `null`, canonicalizes values as a sorted set, and
  accepts the empty set. `in([])` is false and `notIn([])` is true.
- `createdAt` and `updatedAt` are ordinary timestamp Fields. A default can
  initialize either value. Only a later Mutation contract can automatically
  advance `updatedAt`.

Structural Query v1 does not provide JSON-interior predicates, whole-JSON
equality, projected `toMany`, aggregates, offset pages, backward pages,
locale-sensitive ordering, or native statements. Use an explicit normalized
Collection or wait for the focused contract instead of depending on an
undocumented lowering.

## Expect exact generated types, not ambient magic

Executable Definitions need the concrete application type at the handler site.
The leading candidate makes that source visible:

```ts title="src/features/message-summary.ts"
import { defineMutation, defineQuery } from "#questpie/app";
import { operation, policy } from "questpie";

export const messageSummary = defineQuery({
	name: "messages.summary",
	input: operation.object({ id: operation.uuid() }),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.id },
			select: { id: true, body: true },
		}),
	network: true,
});

export const renameMessage = defineMutation({
	name: "messages.rename",
	input: operation.object({
		id: operation.uuid(),
		body: operation.text({ maximumLength: 20_000 }),
	}),
	policy: policy.authenticated(),
	handler: ({ input, ctx }) =>
		ctx.data.messages.update({
			key: { id: input.id },
			patch: {
				body: input.body,
				updatedAt: ctx.operationTime,
			},
			select: { id: true, body: true, updatedAt: true },
		}),
	network: true,
});
```

`defineQuery` and `defineMutation` come from the generated application because
their callbacks need its exact Collection and Operation maps. Structural
builders such as `operation` and `policy` remain framework imports. An unknown
Collection, Field, operation name, input member, or mode-specific method fails
in stock TypeScript instead of widening to `string` or `any`.

This contract requires an initial `bunx questpie sync`. Before the first
successful sync, `#questpie/app` is deliberately missing and the compiler must
print that recovery command. QUESTPIE must not generate an empty or `any`-typed
stub to hide the problem. During development, `questpie dev` keeps the
generated module current with atomic replacement.

Raw `tsc` can read the last generated module but cannot prove that arbitrary
source, Package, lockfile, and compiler inputs are fresh. `questpie check` and
`questpie build` must construct and verify the current application contract.
CI must use one of those commands as its application type authority.

The P1 proof covers the Current App Contract, first sync, stale-output
rejection, executable source slicing, local output rounds, Package isolation,
Operation Set expansion, Runtime Build pairing, language-service behavior, and
compiler budgets. It does not define the later runtime semantics of the six
Definition kinds.

## Choose the Operation by its failure boundary

| Operation | Owns                                                             | Can use                                                                                                               | Does not promise                                                                                        |
| --------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Query     | one read-only application computation in one PostgreSQL snapshot | Policy-enforced reads, structural data plans, supported read-only Services, nested Queries                            | writes, external effects, or watchability for unsupported reads                                         |
| Mutation  | one PostgreSQL transaction and atomic durable-dispatch boundary  | Policy-enforced reads and writes, operation time, transactional dispatch                                              | provider I/O safety, nested transaction ownership, or automatic retry before the idempotency proof      |
| Action    | one external or nondeterministic effect invocation               | declared input/output/errors, cancellation signal, named nested Operations allowed by its mode                        | database transaction atomicity, `ctx.data`, automatic retry, or rollback of an accepted provider effect |
| Route     | one raw Fetch protocol exchange                                  | exact `Request`/`Response`, verification, streaming, cancellation, and explicit transition into application Execution | fabricated client Context, application data bypass, or implicit System Authority                        |

Query, Mutation, Action, and Route are not four spellings for the same handler.
They tell TypeScript, the compiler, Runtime, Studio, and an agent which resources
may be used and which recovery behavior is honest.

Every root Operation has a bounded input, output, duration, rows, bytes, and
concurrency contract. A watched Query additionally needs dependency,
subscription, checkpoint, buffer, and fanout bounds. A durable handler needs
payload, attempt, retry, lease, heartbeat, result, and retention bounds. Exact
numbers other than the accepted structural page maximum are not fixed yet.
Production readiness requires those numbers to be compiled, observable, and
tested; undocumented infinity is not a default.

## Predict errors without learning protected facts

The generated client receives a closed success and error union. Runtime codecs
validate every untyped boundary. Unknown thrown values become one sanitized
internal failure rather than a serialized SQL error, stack trace, or provider
object.

| Situation                                            | Observable result                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| malformed or unknown input                           | typed validation failure before SQL or handler execution                 |
| anonymous Principal where authentication is required | declared unauthenticated result                                          |
| Principal cannot invoke an Operation                 | declared forbidden result without protected Resource detail              |
| keyed row is absent or Policy-invisible              | the same `null` or not-found result                                      |
| list contains forbidden rows                         | only visible rows; counts and pages use the visible universe             |
| caller supplies a denied Field path                  | forbidden input with only the safe canonical segment-array path          |
| candidate row fails Policy                           | no persisted change and no protected evidence value                      |
| referenced row is absent or invisible                | one nondisclosing reference failure                                      |
| unique, foreign-key, or check Constraint fails       | closed framework or explicitly mapped application error                  |
| output cannot match its compiled codec               | sanitized internal failure; invalid bytes are not sent                   |
| Resource is server-only or wire-incompatible         | nondisclosing unavailable or typed client-version result                 |
| Runtime is draining or over a declared budget        | stable retryable or resource-limit result with no internal topology leak |

Policy compilation, attachment, or SQL lowering must fail closed. It cannot
fall back to handler post-filtering, a broader row set, or default allow.
Compiler-derived PostgreSQL RLS may later defend the proven row subset, but it
is not a second Policy language. Without a verified RLS projection, the product
claim is Policy-enforced framework SQL. Direct SQL through an unrestricted
database role is outside that guarantee.

Health endpoints expose only coarse lifecycle state and safe reason classes.
Detailed Origins, Policy branches, transactions, attempts, and recovery
commands require authenticated CLI or Studio access. Studio redacts before a
value reaches its browser; hiding a rendered cell is not redaction.

## Know when a transaction has ended

A Query executes its supported reads in one read snapshot. A Mutation executes
all generated reads, writes, Constraints, Policy checks, and dispatch inserts in
one root transaction.

```text
Mutation input and admission
  -> begin transaction
  -> Policy-enforced reads and writes
  -> resulting-row validation and Constraints
  -> durable dispatch intent
  -> validate output
  -> commit once
  -> encode and deliver the response
```

An error before commit rolls back the business rows and dispatch intent. An
ordinary nested helper does not create a savepoint. Calling a named Mutation
from another Mutation does not silently merge both Resource identities into an
ambient transaction; reuse an ordinary function that accepts the current
Mutation `ctx` when one root transaction should own the work.

Cancellation before commit rolls the Mutation back. Cancellation after commit
cannot erase committed state. The Runtime records the committed transaction and
call identity even when the caller never receives the response.

The schema and Seed artifact protocols already make their lost-success-response
case safe: retrying the exact checksum returns the existing receipt. The same
claim is not yet accepted for application Mutations. Automatic Mutation retry
must remain disabled until the proof fixes call identity, scoped idempotency,
same-key/different-payload conflict, serialization retry, duplicate network
delivery, and response-lost-after-commit behavior.

When external work follows a Mutation, invoke an Action after the database
transaction commits. An Action can also be called as a root Operation. If a
provider accepts the request and the response is lost, the Runtime cannot
deduce whether the effect happened. The caller must supply or derive a stable
provider idempotency key, compensate explicitly, or preserve an `ambiguous`
outcome. QUESTPIE never labels arbitrary external code exactly once.

## Expect realtime convergence, not row events

`watch` runs the same Query as an ordinary call. The Runtime observes every
supported read that actually executes, including Policy, Tenant, Relation,
pagination, and Context-resolution evidence. A successful recomputation
replaces the old dependency set; a failed or cancelled run keeps the last good
set.

The client receives complete authorized Query results and control deliveries,
not Change Ledger rows or ad hoc patches. Each recomputation creates a fresh
Execution, resolves current Context, and reruns current Policy. A membership
revocation can therefore remove data or end the watch instead of leaving a
historic `allow` decision attached to the socket.

The intended recovery path is:

```text
PostgreSQL commit
  -> durable Change Ledger fact in the business transaction
  -> optional lossy wake hint
  -> server reconciliation
  -> dependency overlap
  -> fresh authorized Query snapshot
  -> complete result or reset
```

`LISTEN`/`NOTIFY` is a wake mechanism, not the log. Wakes may be duplicate,
coalesced, delayed, or lost. Startup and reconnect establish the listener,
then reconcile durable PostgreSQL state. Trigger capture can cover framework
Mutations, ordinary SQL, cascades, `COPY`, and normal external writers only
when the generated trigger/grant surface is installed and unchanged. A role
that can disable triggers or write outside the instrumented schema is outside
the realtime guarantee.

Resume tokens are opaque, authenticated, versioned, and scoped to the Query,
input, authority partition, code, and retained checkpoint generation. The
server either resumes from compatible retained state or emits `reset` and a
fresh authorized result. Clients must replace local state on reset.

A trigger-time `bigserial`, timestamp, or transaction ID is not a commit-safe
cursor. Concurrent transactions can allocate an earlier value and commit after
a later one. QUESTPIE cannot document a monotonic checkpoint until a
visibility-safe reconciler, serialized commit order, or WAL-based approach
passes concurrency and crash tests. The client token therefore never exposes
or promises one of those database values.

The first contract lets independent watched Queries converge independently. It
does not promise one atomic client-visible transition across four Query
results. Combine data that must share one snapshot into one Query result.

A Query that uses undeclared raw SQL, time, randomness, environment values,
Search, Files, or an external request may still run once, but it is not
watchable until that source has explicit observation semantics. Slow clients
are reset or disconnected before server memory grows without bound.

## Expect durable work at least once

A successful `ctx.dispatch.target(input)` means typed durable intent was
accepted into the current Mutation transaction. It does not mean the Reaction
or Job has run. Rollback removes the intent; commit makes it recoverable even
if the process stops before a wake.

The intended durable identity model separates lifetimes:

| Identity      | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `dispatchId`  | one immutable acceptance fact                                                |
| `runId`       | one logical run, stable across retries and lease recovery                    |
| `attemptId`   | one physical handler attempt                                                 |
| `leaseToken`  | one opaque fencing value for the current worker claim                        |
| `effectKey`   | one logical external effect, stable across attempts                          |
| `causationId` | the Operation, dispatch, schedule tick, or Workflow fact that caused the run |

Workers claim ready work in a short PostgreSQL transaction, persist a new
attempt and fenced lease, and commit before user code starts. They do not hold
a row lock, pooled connection, or transaction open during the handler. Every
heartbeat, retry, success, cancellation, and terminal transition must match the
current attempt and lease token. A stale worker cannot complete a newer
attempt.

Every attempt creates a fresh Execution from its declared run-as recipe. It
resolves current Context and reruns current Policy. It does not deserialize a
cookie, bearer token, Request, database handle, old resolved `ctx`, historic
allow decision, or Service instance. Worker location never grants System
Authority.

Physical handler execution is at least once. Acceptance deduplication can
provide at most one logical run for one scoped idempotency identity, but it
cannot make arbitrary code exactly once. A retry uses the same `runId` and
effect key. Same key plus different canonical input is a conflict, not an alias
for the old run.

Retry is bounded Definition-owned attempt policy. Retry exhaustion creates one
inspectable terminal failure. Cancellation is a durable cooperative request;
it prevents future work and aborts the current signal when observed, but it
cannot recall a provider effect already accepted. `retry` preserves the
logical run and effect identity. `replay` creates a new run and must say so.

A Reaction follows committed state. A Job is an explicit durable command. An
Action owns an external effect. Queue is Runtime admission and lease machinery,
not an application Definition. A later Workflow must reuse this spine and add
named durable steps, timers, signals, history bounds, and code-evolution rules;
it cannot replay arbitrary latest TypeScript and call that durable.

## Deploy by the contract that changed

The normal lifecycle is explicit:

```bash
bunx questpie build --out dist/questpie

DATABASE_URL="$DATABASE_URL" \
	bunx questpie migration apply --bundle dist/questpie

DATABASE_URL="$DATABASE_URL" \
	bunx questpie start --bundle dist/questpie --port 4000
```

Build does not mutate PostgreSQL. Start does not plan, create, or apply a
migration. Runtime readiness requires matched artifacts, the expected migration
head and Schema Fingerprint, supported PostgreSQL features, and reconciled
internal state. A corrupt bundle, checksum mismatch, unknown migration, Drift,
or incompatible internal protocol blocks startup.

Compatibility has several owners:

| Changed fact                                            | Compatibility decision                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| source Origin only                                      | diagnostics change; semantic and wire contracts can remain equal         |
| schema projection or migration head                     | explicit reviewed migration and Drift verification before readiness      |
| Query or Mutation input/output/error codec              | generated client compatibility or typed `clientOutdated` failure         |
| handler, Policy, Context resolver, or observation logic | new Runtime Build; recompute or reset affected watches                   |
| Change Ledger or resume protocol                        | internal upgrade plus checkpoint compatibility or reset                  |
| Reaction or Job with pending runs                       | retain compatible executable behavior or block deployment                |
| Workflow with live history                              | follow an explicit pin, patch, or proven evolution rule, otherwise block |
| internal Runtime protocol                               | registered transactional upgrade; never silently reinterpret old rows    |

The first honest schema-changing deployment drains incompatible work, applies
the reviewed migration, verifies the target fingerprint, starts the new bundle,
reconciles ledger and dispatch state, then becomes ready. This can include
downtime. Zero-downtime rollout requires proven old/new read and write
compatibility; an apparently additive SQL diff is not enough.

The default standalone process owns Fetch, Routes, realtime, schedules, and
durable workers. A later split `api` and `worker` deployment must pass the same
cross-process wake, reconciliation, lease, readiness, and shutdown failures
before it receives the same guarantee. The low-level generated `createApp()`
surface owns `fetch`, `execution`, idempotent `close`, and the compiler-owned
`routes` direct projection; it is not a promise of lifecycle parity across a
host-adapter matrix.

Local PostgreSQL and each named managed provider profile must pass conformance
for transactions, locks, collation, triggers, `LISTEN`, migration locks,
reconciliation, and worker claims. A transaction pooler that cannot preserve a
dedicated listener session does not silently receive the realtime guarantee.

## Know what is unsupported

| Unsupported behavior                                                                       | Use this owned alternative                                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| runtime Module or plugin-object merge                                                      | direct exported Definitions and explicit accepted Augmentations                                                       |
| installation that silently activates a Package                                             | explicit activation and reviewed Package inventory in `questpie.json`                                                 |
| public compiler plugin or new user-defined Resource Kind                                   | ordinary source Definitions or an external generator that writes them before compile                                  |
| public ORM types, raw database handle, or broad SQL escape in generated `ctx`              | typed Collection reads/writes and structural data plans; use a separately designed bounded escape hatch when required |
| ambient application type registry or repeated whole-app generic                            | generated application-specialized factories and contracts from `#questpie/app`                                        |
| per-Operation Collection capability map                                                    | the exact mode-specific generated `ctx`                                                                               |
| hidden Admin CRUD engine                                                                   | Collection Operation Set lowered to ordinary Query and Mutation Resources after its proof                             |
| generic `before*` or `after*` hook bag                                                     | closed normalization/server values, a named Mutation, durable Reaction, or external Action according to ownership     |
| automatic `updatedAt` magic                                                                | assign `ctx.operationTime` in the owning Mutation or proven Collection Operation Set values program                   |
| host or database provider matrix                                                           | standalone Runtime, low-level Fetch seam, and concrete PostgreSQL provider conformance profiles                       |
| raw SQL console or Policy-bypassing Studio                                                 | generated authorized Operations and narrow audited maintenance commands                                               |
| row-change subscription channel                                                            | watch the complete authorized Query result                                                                            |
| exact-once arbitrary worker or provider code                                               | at-least-once attempts plus stable idempotent effect identity or explicit ambiguity/compensation                      |
| implicit System access from script, Route, worker, or missing Request                      | explicit trusted authority construction outside ordinary application input                                            |
| automatic online migration or rollback                                                     | reviewed forward migration and an explicit compatibility/deployment plan                                              |
| complete Workflow, Auth, Files, Search, OpenAPI, MCP, or managed Cloud in the first tracer | preserve their named seams and add each through its own focused vertical proof                                        |

QUESTPIE is not a general web framework, database-neutral engine, Supabase
replacement, CMS Admin, Operator App builder, or managed control plane. An
application-specific back office is an ordinary frontend using the generated
client. PostgreSQL stays visible and portable within each tested profile.

## Keep the compiler inside its budgets

Exact types are a product guarantee only when the editor and compiler remain
usable. Public declarations cannot expose ORM types, ambient registries,
recursive whole-application authored generics, `any`, unknown operation names,
or fallback `string` discriminants.

The accepted isolated foundational proof currently measures 5,770 TypeScript
instantiations. Its hard proof ceiling is 25,000. That measurement is a floor
for regression comparison, not a claim about a complete application.

The executable-application proof uses provisional research gates:

| Measurement                                                                                                                                       | Candidate ceiling                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| connected fixture with six Collections, Context, relational Policies, Queries, Mutations, one Collection Operation Set, one Reaction, and one Job | 125,000 TypeScript instantiations with pinned TypeScript 5.9.2      |
| complete compiler check on the proof host                                                                                                         | 1.5 seconds total and 96 MiB memory                                 |
| warm isolated hover or completion request                                                                                                         | p95 at most 100 ms over 100 requests                                |
| generated public `app.ts` plus `client.ts` declarations                                                                                           | 256 KiB uncompressed                                                |
| private binding metadata                                                                                                                          | 4 KiB per executable Resource, excluding bundle and source maps     |
| four-times Resource scaling                                                                                                                       | no more than five-times instantiations and public declaration bytes |

The proof must report actual Types, Instantiations, memory, check time, hover
latency, declaration bytes, binding bytes, raw and compressed bundle bytes, and
the incremental cost of each executable Resource kind. These ceilings are not
accepted production limits yet. They become authority only with the focused
compiler contract and acceptance review.

Runtime limits need the same treatment. Duration, rows, read bytes, write
bytes, dependency count, active subscriptions, buffered delivery bytes,
retained checkpoints, Change Ledger lag, fanout, per-Principal concurrency,
durable payload size, attempts, lease duration, history, and retention must
have explicit defaults, overrides, diagnostics, and hostile tests before a
production claim.

## Production checklist

Do not call a deployment production-ready until all of these statements are
true for its supported profile:

1. `questpie check` and `questpie build` pass from a clean checkout with the
   recorded Bun, TypeScript, lockfile, Package inventory, and Build Input.
2. The generated declarations, compiler time, editor latency, memory, and
   artifact sizes pass the accepted budgets rather than only the provisional
   numbers on this page.
3. Every schema change is a reviewed Committed Migration; apply receipts,
   checksums, target Schema Fingerprint, Drift, and lost-response retry pass.
4. Policy, nondisclosure, SQL pushdown, Context, direct/client/Studio parity,
   and any claimed RLS projection pass their hostile fixtures.
5. Query, Mutation, Action, and Route inputs, outputs, declared errors,
   cancellation, deadlines, resource limits, response loss, and shutdown
   behavior pass through both direct and network entry.
6. Realtime passes concurrent commits, lost and duplicate wakes, restart,
   reconnect, reset, revocation, raw SQL/cascade capture, deployment change,
   slow clients, retention, and commit-safe frontier tests.
7. Durable work passes rollback, post-commit crash, two-worker claim, stale
   lease, retry, provider response loss, idempotency conflict, cancellation,
   membership revocation, dead-letter, and pending-run deployment tests.
8. Startup, readiness, drain, forced shutdown, same-bundle restart, migration
   deployment, and any split Runtime roles pass under failure injection.
9. The exact local and managed PostgreSQL profiles pass conformance, including
   role restrictions that protect trigger, Policy, and internal state.
10. Studio and CLI explain the same artifact, Policy, transaction, realtime,
    and durable identities without exposing credentials, evidence rows, raw
    errors, or sampled telemetry as durable truth.
11. Every promoted contract has its executable goldens, TypeScript and runtime
    measurements, documentation checks, and fresh focused Opus-medium `PASS`.

Until then, this guide remains the specification of the framework we intend to
prove. It is deliberately precise enough that an implementation cannot replace
a missing guarantee with hidden magic.
