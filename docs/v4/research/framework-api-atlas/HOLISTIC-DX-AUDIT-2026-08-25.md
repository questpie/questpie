# Whole-framework DX audit

- Status: read-only research; not acceptance authority
- Date: 2026-08-25
- Parent: [Collection DX and durable-work redesign](./COLLECTION-DX-AND-DURABLE-WORK-REDESIGN.md)
- Evidence: current v4 source and representative Autopilot 3.28.6 application

## Verdict

The redesign has the right product direction but is not yet an implementable
contract. The framework should converge on this mental model:

```text
Collection       stored domain state and unavoidable invariants
Structural Query reusable static read plan
Query            application read use-case
Mutation         atomic application write use-case
Action           one external effect with explicit ambiguity
Route            raw HTTP and protocol escape hatch
Job              durable background use-case independent of trigger
```

CRUD endpoint, Reaction, Event, Queue, Scheduler, and Workflow should not remain
parallel framework concepts without a separately proven application job.

## Import and naming direction

Application-specialized executable factories come only from `#questpie/app`:

```ts
import {
	defineQuery,
	defineMutation,
	defineAction,
	defineRoute,
	defineJob,
} from "#questpie/app";
```

Stable structural primitives come from `questpie`. `#questpie/client` remains
browser-safe generated output. `#questpie/package` must eventually expose the
same executable family specialized to a sealed Package Contract; today most
Package factories are effectively `never`, which blocks useful integration
Packages.

Recommended terminology repairs:

- Operation `network: true` -> `expose: "client"`;
- Operation `policy` -> `admission`;
- Job `dispatch()` -> `accept()`;
- authored Context = immutable resolved facts;
- generated `ctx` = capability-scoped Execution view;
- Service = runtime dependency with explicit lifetime/effect class;
- rename Service effect class `read` because it actually means
  transaction-safe/no-external-effect.

These spellings are recommendations, not yet accepted syntax.

## Fatal contract repairs

1. Generated Query `ctx.data` declarations and Runtime projection disagree.
2. Multiple Query reads currently open multiple transactions instead of one
   bounded consistent snapshot.
3. Named Query lacks a coherent authored admission and immutable Execution fact
   projection.
4. Current internal writes do not cover Autopilot lock, compare-and-set,
   count, bounded bulk, and multi-Collection atomic commands.
5. Collection lifecycle has no closed executable typing/evaluator seam.
6. Package executable authoring does not match the Accepted Package model.
7. Dirty Job acceptance can leave a Job ready with no Job-capable worker.
8. Mutation Job projection allows one implicit dispatch slot without explicit
   idempotency or delay semantics.
9. Route literal path encoding is not closed: compiler literals and WHATWG URL
   serialized `pathname` can disagree for Unicode, spaces, and percent escapes.
10. Authored Collection `update`, `delete`, and `list` members receive types and
    identities but are silently omitted by PostgreSQL lowering.
11. A Job-only application emits a durable artifact with a null compatibility
    digest and fails Runtime artifact decoding.
12. Public stored codecs do not yet project complete bigint, numeric, date, and
    JSON parity through generated Operation contracts.

## Query and output DX

One Collection-originated grammar should own `select`, `findOne`, `findMany`,
filters, total ordering, pagination, and Relation traversal. The same static AST
must work inline and as a reused TypeScript value.

Current breadth is insufficient for the intended real application:

- only narrow scalar comparisons;
- one-hop to-one selection;
- Relation `exists/notExists` not realized end to end;
- no bounded to-many loading;
- no complete nested where grammar;
- cursor ceremony even for some singular reads;
- no closed reusable selection shape in current authoring;
- input codec duplication between Structural Query and semantic Query.

Output inference is safe only where the compiler can materialize a runtime
codec:

- pass-through closed Structural Query: infer input and output;
- compiler-known CRUD/write plan with static `select`: output may be inferred;
- arbitrary handler, transform, recursion, or public stability boundary:
  explicit `output` remains required.

TypeScript return inference alone is not a wire/runtime codec.

## Collection lifecycle and commands

Keep one fixed lifecycle and reject a general priority hook registry. Local
normalization and validation may live with Collection only if the evaluator can
enforce their claimed execution class. Cross-Collection locks, branches,
audits, and exceptional business commands belong in named Mutations using
bounded static transaction primitives.

Minimum additional internal command vocabulary required by representative
Autopilot behavior includes:

```ts
ctx.data.tasks.lock({ key: { id } });
ctx.data.tasks.update({
	key: { id },
	expected: { version },
	values,
	select,
});
ctx.data.taskEvents.createMany({ values, limit: 100 });
```

This is not permission for raw SQL or a runtime-dynamic ORM. The compiler still
owns bounded plans, Policy, locks, statement identity, lifecycle, and receipts.

## Capability matrix

Before more surface breadth, one generated matrix must define and parity-test
the exact interface for Query, Mutation, Action, Route, Job, Package code, and
direct callers:

- immutable Principal, Tenant, Authority, values, deadline, and signal;
- read/write Collection plans;
- nested Operations;
- transaction-safe versus external Services;
- Job acceptance and checkpoint references;
- raw Request/Response only for Route;
- no raw database, ambient System, or generic worker controls.

Current declarations project inconsistent subsets. Accepted semantics and
Runtime values must match exactly.

## Route and Auth DX

Provider-agnostic application credential resolution remains correct. Header,
cookie, URL, worker location, and payload are inputs, never Policy authority.

Route matching needs one canonical encoded-path contract, invalid-percent
hostiles, exact trailing-slash behavior, and compile-time overlap diagnostics.
Raw Route must enter application behavior through an explicit Execution before
using Query, Mutation, Action, or Job capabilities.

Of representative Autopilot routes, many are semantic reads/writes that should
become Queries or Mutations; true security transports, streaming, and custom
protocols remain Routes.

## Package and PostgreSQL extension seams

Do not build one universal scalar/provider/index plugin. These capabilities
have different invariants:

- stored scalar: codec, canonical bytes, PostgreSQL type, migration,
  fingerprint, and wire contract;
- PostGIS: geometry/geography, SRID/dimension, spatial operators, and
  GiST/SP-GiST;
- pgvector: dimension, metric, exact/approximate search, HNSW/IVFFlat, recall;
- full-text: document projection, configuration, ranking, headline, GIN, and
  an authorized result universe.

Sequence:

1. make public codec parity match already supported stored built-ins;
2. prove one activated-Package stored-type contract and required PostgreSQL
   extension;
3. add PostGIS, full-text, and pgvector through capability-specific structural
   operators and index projections;
4. never give a Package raw SQL callbacks, ambient merge, or a new public
   Resource Kind.

## Autopilot evidence

The read-only audit counted approximately:

- 61 Collection files and 5,612 lines;
- 16 Collection files using about 39 lifecycle callbacks;
- 15 Collection files with explicit Field fences;
- 87 custom Route files and 6,283 lines;
- a manually sampled route classification dominated by read projections and
  exceptional commands, with a small security/protocol set that should remain
  Route.

About 79 of 87 Route files live on the wrong semantic surface. A conservative
first migration can plausibly remove 500-700 handwritten transport-boilerplate
lines; 800-1,200 is a realistic target after Query/Mutation/client convergence.
Most remaining code expresses real joins, locks, authorization, receipts, and
domain behavior and must not be counted as framework ceremony.

The exact 35/44/8 split previously discussed was a sample-based classification,
not a mechanically proven count. Realtime/Channel migration is also a distinct
gap and cannot be inferred from the Route or Query migration.

## Dependency-ordered slices

```text
S0  Repair Job-only artifact decoding and close the blocked review gate
 |
S1  Complete ordinary Job: accept identity + delay + worker outcomes/recovery
 |
S2  Build one substantial reference application on the current interfaces
 |   Record every workaround and missing capability as framework evidence
 |
S3  Capability matrix + declaration/runtime parity
 |   Query admission + one Query snapshot + built-in codec parity
 |
S4  Superseding authoring proofs
 |   Collection provenance/lifecycle
 |   Query/Mutation admission/exposure
 |   Job trigger/run-as completion
 |
 +---------+----------------+----------------+----------------+
 |         |                |                |
S5A CRUD   S5B Query grammar S5C Route paths S5D Package contract
 |         |                |                |
 +---------+----------------+----------------+----------------+
 |
S6  Re-run the reference app as the concentrated whole-framework DX gate
 |
S7  Replace collaboration Reaction with executed Job, then remove Reaction
 |
S8  Cron + multiple triggers + checkpoints
 |
S9  Built-in codecs -> custom stored type proof -> specialized extensions
 |
S10 Port Autopilot to v4; let Autopilot own autonomous workflow orchestration
```

S5 branches may proceed in parallel after S4. Collection triggers remain later
than S7 because they depend on exact lifecycle/change-fact semantics. Extension
work must not enlarge the basic CRUD/Query superseding ADR.

QUESTPIE should be friendly to automation through deterministic artifacts,
diagnostics, generated contracts, and stable verification commands. It should
not absorb Autopilot's workflow engine, swarm orchestration, session state, or
review policy into the framework's public mental model.
