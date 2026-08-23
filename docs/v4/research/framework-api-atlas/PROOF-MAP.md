# QUESTPIE v4 contract proof map

> **Historical/frozen proof ledger.** This map preserves accepted proof records;
> it no longer sequences current delivery. `docs/v4/DELIVERY-FLOW.md` is the
> current delivery-process authority under ADR-0027.

> Current projection: ADR-0026 supersedes the separate Workflow Resource and
> factory accepted by historical P18/P21 evidence. The durable semantics remain
> current as Job checkpoints; reviewed proof records below are historical bytes.

- Status: execution plan; no acceptance or implementation authority
- Purpose: turn the ideal-framework design fiction into six bounded contracts
  that can be proven, reviewed, accepted, and only then implemented
- Authority: `SPEC.md`, Accepted ADRs, and accepted v4 workbench contracts
- Companion decision map: [`DECISION-MAP.md`](./DECISION-MAP.md)

The framework atlas is broad enough to expose the finished product. Acceptance
must remain narrow enough that one failed invariant does not contaminate every
other decision. The work therefore closes six proof chapters in dependency
order:

```text
P1 executable Definition compiler contract
  -> P2 trusted Context and relational Policy
    -> P3 Query, Mutation, Collection Operations, and lifecycle
      ├-> P4 Live Query and Change Ledger
      └-> P5 Transactional Dispatch and Reaction
        -> P6 Runtime, client, Execution Envelope, and Studio
```

P4 and P5 may be developed in parallel after P3. They converge again in P6.
These are executable compiler and PostgreSQL contract proofs, not production
Runtime implementation. A proof may accept only the surface named in its
chapter; later syntax remains design fiction.

P1 through P6 are accepted. P4 and P5 diverged from the same accepted P3 head.
P6 converges them through `a3fba116e9719c1859842ddea75c5312d6dc7e80`
and is accepted at `94c237c9aa910a60a332b1ef97473f34fe89d65b`
after local and managed PostgreSQL gates, replacement focused review, and the
separate connected-tracer review all passed. The post-P6 implementation-gate
closure is accepted at `a164e33e752ab54d48fcf903371938ecff3dc082` after
its repaired clean evidence head `79d7816d` received a fresh focused
Opus-medium `PASS`.

## Shared fixture

Use one collaboration application with Companies, Spaces, Channels,
Memberships, Messages, Message Events, and a materially different second
fixture that catches accidental assumptions about tenancy, `id`, and CRUD.
The connected fixture must exercise:

- a composite primary key and an ordinary single-Field primary key;
- a four-hop relational authorization path;
- one structural data plan and one semantic multi-Collection Query;
- one full Collection Operation Set;
- one multi-Collection Mutation with explicit server values;
- one watched Query and a conditional branch that changes observed reads;
- one transactionally dispatched Reaction and one external-effect identity;
- direct, generated-client, restart, and minimal-Studio observation.

The accepted data and structural Query proof at `d03358b7` remains an input.
No chapter may reinterpret its Schema, Data Contract, Query Template, cursor,
binding, or dependency bytes.

## P1 — executable Definition compiler contract

Status: accepted by ADR-0009 after proof head
`713485a64bcc4795d960d576fea51da56bc4dcdd` and one fresh focused
Opus-medium `PASS`. P1 accepts compiler mechanics only. P2 is also accepted by
ADR-0010, P3 by ADR-0011, P4 by ADR-0012, P5 by ADR-0013, and P6 by ADR-0014.

### Accepted surface

- application-specialized `defineQuery`, `defineMutation`, `defineAction`,
  `defineRoute`, `defineReaction`, and `defineJob` factories from the current
  virtual `#questpie/app` contract;
- one direct exported Definition with an inline handler, and the same contract
  with an ordinary imported handler;
- a closed Collection Operation Set that expands before Manifest emission into
  ordinary Query and Mutation Resources;
- a statically paired Runtime Build with no runtime discovery;
- explicit Context singleton identity and Policy default-attachment collision
  rules as compiler ownership facts only.

ADR-0009 records the narrow ADR-0007 amendment for the six generated factory
values. Current-virtual factory isolation passed, so the source-owned
`bindDefinitions<AppContract>()` fallback was not adopted.

### Accepted artifacts

- exact generated application and client declarations;
- normalized executable Resource projections and codec projections;
- Collection Operation Set expansion, child Owner, and member Origin records;
- versioned Runtime Build, executable-slot identity, graph, and bundle digest;
- structured diagnostics and `questpie explain --json` goldens;
- application-local and Package-local exact-context fixtures.

### Passing evidence

1. First sync constructs current virtual factories with no generated directory
   and no empty, broad, `any`, or `unknown` placeholder.
2. `questpie check` and build ignore deliberately stale disk declarations;
   raw `tsc` is typing evidence, never freshness authority.
3. The structural evaluator substitutes only the six allowlisted pure factory
   values and never evaluates generated Runtime code or handler-only imports.
4. Inline and imported handlers preserve lexical dependencies and bind exactly
   once without a second handler export, filename convention, or registry.
5. A body-only change changes Runtime Build bytes but not Schema, Data,
   structural Query, operation-codec, or generated public type bytes.
6. An inferred return-shape change changes the output codec, generated
   declarations, and Runtime Build. An equal explicit output pin preserves
   codec bytes.
7. Acyclic same-build Operation outputs resolve deterministically. A recursive
   output strongly connected component requires an explicit output pin and can
   never fall back to compile N-1, `any`, or `unknown`.
8. Every Operation Set child has an ordinary identity, Owner, Origin, Package
   Inventory entry, collision behavior, and exact generated alias. No CRUD
   dispatcher survives normalization.
9. Zero, one, and two Context roots and zero, one, and two default Collection
   Policies have deterministic identity/collision diagnostics.
10. Missing, duplicate, stale, wrong-kind, and cross-build executable bindings
    make the loader refuse startup.
11. A fixed Package emits nameable declarations against `#questpie/package`,
    activates into a wider host, and cannot see host-only Resources.
12. Reversed discovery order and relocated checkout preserve semantic bytes.

### Budgets

- connected fixture: at most 125,000 TypeScript instantiations;
- compiler typecheck: at most 1.5 seconds and 96 MiB on the recorded proof host;
- warm language-service hover/completion p95: at most 100 ms;
- public generated application plus client declarations: at most 256 KiB;
- private binding metadata: at most 4 KiB per executable Resource;
- a 4× fixture: no more than 5× type or declaration growth.

P1 accepts compiler mechanics only. It does not accept Query, Mutation,
Context, Policy, realtime, or durable Runtime semantics.

## P2 — trusted Context and relational Policy

Status: accepted by ADR-0010 after proof head
`5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` and one fresh focused
Opus-medium `PASS`. P3 is also accepted by ADR-0011, P4 by ADR-0012, and P5 is
next.

The later sibling `P2R1/BETA04Authority` revision was reviewed at
`f8e12ead9f667ecc2c6e5478a3071b7f23e67099` and recorded at
`2ae1981740102ede7a5fc1e567b9645bd9d6fbe6` after the initial
`10d5712ab816ef5576ec041da216d95c6921ac0d` review was validly `BLOCKED` for
non-portable authoring-object provenance. The replacement review passed after
the exact projection became byte-pinned and reproducible from a bundle
containing only the reviewed head and its ancestors. P2R1 adds only the
Policy-protected `DataCursorV2`, `PolicyCursorScopeV1`, fatal
`QP-POLICY-001`/`QP-POLICY-002` promotion, and dependency-derived BETA-04
readiness. Original P2 head `5fbd9058`, its acceptance packet and canonical
digests, `PolicyProgramV1` bytes, and `DataCursorV1` bytes remain unchanged.
The accepted foundation proof's `query-grammar-goldens.mjs` encodes v1 cursor
bytes through its RFC 8785 plus LF `bytes()` function, so the revision's v1
wording is a restatement rather than an encoding change.

### Candidate surface this chapter may accept

- `defineContext({ input, resolve })` with transport-neutral input;
- immutable `client.withContext(input)` and direct `app.execution(...)`
  semantics, without freezing their wire format;
- bounded read-only `bootstrap.get(Collection, ...)` during root resolution;
- `definePolicy(collection, body)` and bounded typed
  `policy.exists(collection, predicate)`;
- Principal, Tenant, Authority, admission, row, caller-input, selected-output,
  current-row, and candidate-row semantics;
- optional compiler-derived RLS only for a separately proven normalized subset.

### Required artifacts

- canonical Context input/resolved projection and runtime codecs;
- bootstrap plan, limits, dependencies, and failure projection;
- canonical Policy program, evidence graph, Field-path decisions, attachment,
  SQL lowering, and optional derived-RLS status;
- generated immutable Context and Policy-aware data types;
- SQL, decision, nondisclosure, and `explain` goldens.

### Passing evidence

1. Context resolves once per root Execution, fails before Policy or handler,
   propagates immutably, coalesces concurrent reads, and disposes scoped
   Services.
2. Bootstrap is read-only, explicit, bounded, deadline/cancellation-aware, and
   exposes no raw DB, all-Collections, Queue, Services, or System bag.
3. Browser, direct, Route transition, realtime recompute, and durable attempt
   inputs all construct the same immutable application Execution deliberately.
4. A Company -> Space -> Channel -> Membership -> Message Policy compiles with
   exact fields at every nested predicate and no recursive whole-app type.
5. Evidence reads return only a boolean and do not recursively apply target
   disclosure Policy; returned Relations do apply both source and target
   disclosure authority.
6. SQL row scope applies before pagination, counts, cursor sentinels, locking,
   and disclosure. Runtime post-filter fallback is forbidden.
7. Admission, current row, sparse caller input, candidate row, and selected
   output phases have one fixed fail-closed order and segment-array paths.
8. Missing and Policy-invisible keyed rows are indistinguishable. Constraint,
   validation, cursor, and error precedence do not create an existence oracle.
9. Lock waits recheck current mutable evidence and candidate authority inside
   the Mutation transaction.
10. Membership and role changes participate in observed dependencies; Context
    convenience values never replace current relational evidence.
11. Direct, network, nested, recompute, worker, and Studio paths make the same
    Policy decision from the same Execution facts.
12. If RLS is emitted, non-bypass roles, transaction-local settings,
    `USING`/`WITH CHECK`, pooling, cross-table races, and constraint leakage pass.
    Otherwise the artifacts make no RLS claim.

Later seams: concrete Auth Packages, broad RLS projection, maintenance/System
APIs, recursive graphs, advanced joins, and typed JSON interior Policy.

### Accepted outcome

- one transport-neutral Context Definition, immutable once-per-root resolution,
  bounded read-only bootstrap, nested propagation, and scoped Service cleanup;
- exact generated Context, direct-root, client-scope, and Collection-bound
  Policy types with no registry, recursive App generic, ORM type, or `any`;
- one normalized Policy AST for artifacts and SQL lowering across page, count,
  key, cursor sentinel, lock/recheck, candidate, and output paths;
- boolean-only relational evidence distinct from target disclosure Policy;
- fail-closed admission, row, sparse input, selected output, current, and
  candidate semantics with nondisclosing errors;
- mutable evidence dependencies, real lock-wait revocation, explicit System
  boundary, second-domain falsification, and direct/network/nested/recompute/
  worker/Studio parity;
- ordinary B-tree-only PostgreSQL evidence and an explicit
  `derivedRls: notEmitted` result with no RLS claim.

The proof commits are `52c482c61b10e28b22192672c083e318ea448b06`,
`e517fe5eb8360e76f7a021a7b04263d887721931`,
`b78ffa7356e1c310625c2476adda6cfd2ca3c697`,
`75bfd5a815bf88915327e30a1c021f72fd50c1b3`,
`b614215f8ed8de7da481eccd6d26bb28559cde64`, and
`5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa`. Canonical digests and exact
TypeScript/editor/PostgreSQL measurements are recorded in
[`../../prototypes/context-policy/ACCEPTANCE.md`](../../prototypes/context-policy/ACCEPTANCE.md)
on that proof branch and projected into
[`../../context-and-policy.md`](../../context-and-policy.md).

P2 does not accept production Runtime code, Query snapshot or Mutation
transaction mechanics, create-candidate SQL, broad RLS, Auth Packages, durable
run-as persistence, or connected Fetch/Studio protocol. Those stay with P3–P6
or a named later contract.

## P3 — Query, Mutation, Collection Operations, and lifecycle

Status: accepted by ADR-0011 after proof head
`a09bf55f0e22f65e059cda9f3eda914520dd4f9d` and one final fresh focused
Opus-medium `PASS`. P4 is accepted by ADR-0012, P5 by ADR-0013, and P6 by
ADR-0014. The accepted P2
Context, Policy program, SQL-scope, nondisclosure, lock-recheck, dependency,
and parity contracts remain fixed inputs.

### Candidate surface this chapter may accept

- `operation.*`, `defineQuery`, and `defineMutation`;
- generated mode-specific `ctx.data.*` and `ctx.data.run(plan, input)`;
- `defineCollectionOperations(collection, {...})` with explicit
  `list/get/create/update/delete` members;
- closed pure caller-input normalization and closed server `values` operands;
- exact declared errors, inferred output where materializable, optional output
  pins, `ctx.operationTime`, cancellation, deadlines, and `network: true`;
- the explicit no-general-hooks replacement decision.

### Required artifacts

- Query and Mutation projections with input/output/error codecs, limits,
  exposure, Policy references, mode, and static binding;
- ordinary child projections for every Collection Operation Set member;
- generated direct and client contracts;
- transaction/call identities, commit receipts, and lifecycle-order goldens;
- normalized pure normalizer and server-value programs.

### Passing evidence

1. The four-Collection Query runs inside one bounded consistent read snapshot.
2. The multi-Collection Mutation owns exactly one PostgreSQL transaction; every
   generated read, write, validation, and dispatch seam joins it.
3. Collection `list/get/create/update/delete` use the same engine, Policy,
   codecs, errors, transaction, and observation path as ordinary Resources.
4. Decode, admission, row scope/lock, caller Field authority, normalization,
   defaults, server values, full candidate validation, candidate Policy,
   PostgreSQL Constraints, selection, output authority, commit, and encoding
   have one documented order.
5. `createdAt` and `updatedAt` remain ordinary Fields. `updatedAt` changes only
   through an explicit Mutation-owned assignment.
6. Query contexts cannot write. No generated context exposes raw SQL, DB,
   transaction, Policy bypass, or normal-call System elevation.
7. Unsupported inferred outputs fail at their Origin. An output pin validates
   and encodes; it cannot cast an unsafe JavaScript value.
8. Cancellation before commit rolls back. Cancellation or response loss after
   commit reports ambiguity without claiming rollback.
9. Duplicate Mutation delivery and response loss after commit use one stable
   call identity and do not apply the business change twice.
10. Direct and wire harnesses produce the same exact results, declared errors,
    nondisclosure, and transaction outcomes.
11. Pure Field normalization, named Mutation, transactional audit write,
    durable Reaction intent, and external Action each have one explicit owner.
    No general `before*` or `after*` callback catalogue exists.

P3 reserves typed `ctx.dispatch` but does not accept its durable semantics;
ADR-0013 accepts those for Reaction. Later seams include native SQL, savepoints, nested Mutations,
aggregates, backward pagination, and typed JSON interior querying.

### Accepted outcome

- exact application-specialized `defineQuery` and `defineMutation`, supported
  inferred output, explicit and recursive pins, declared errors, and generated
  mode-specific Context/client types;
- one bounded `REPEATABLE READ READ ONLY` semantic Query snapshot and one
  Mutation-owned PostgreSQL transaction joined by business, audit,
  dispatch-intent, and Operation Result Receipt writes;
- one closed Collection Operation Set lowered to ordinary
  `list/get/create/update/delete` Resources and differentially executed against
  independent ordinary Resource contracts and handlers through the same
  Policy, codec, boundary, and observation engine;
- fixed caller-Field-authority-before-normalization lifecycle, closed pure
  normalization and server values, explicit ordinary timestamps, named
  cross-Collection Mutation, transactional audit, typed pending dispatch
  intent, and no general hook catalogue;
- stable call identity with input-digest binding, exact sequential/concurrent
  replay, changed-input conflict, lost-response recovery, and explicit
  pre-commit rollback versus post-commit ambiguity;
- distinct direct and wire adapters with exact result/error/nondisclosure/
  transaction parity and runtime-codec restoration of `Date` values;
- connected collaboration and distinct Archive/Record/ResearchPermit fixtures,
  B-tree-only PostgreSQL evidence, zero RLS objects, and no RLS claim.

The proof commits are `7e4592d053b1b91a8f2f36ae6754b8f37405fe19`,
`26c2addd8b616f9c5dce9be9b7b1fa19a67f4998`,
`7ae546762f7955aac64ef464731bed2fee9a2d99`,
`261b5d04a62e040a105930f90df3ea7d8334ca1d`,
`91970a260028eab1bf8a42e8171fea78a2709c42`,
`54a9c6dedff676b7c6673d5e4d5e31517241f546`,
`25960cffe22ca16ca939ac8ef1c24892174333ac`,
`4b02e4adc26f5d106e33bec78611d86a544ad41e`,
`583f9ea122b21df0471ff4c4497b4d3dc4f2e03b`,
`edde57eb4c329d99712700eb29622e518638e51e`,
`a52575fc525719de1dd62fe1207ed819bda48c6b`, and
`a09bf55f0e22f65e059cda9f3eda914520dd4f9d`. Exact digests and measurements
are recorded in
`docs/v4/prototypes/query-mutation/ACCEPTANCE.md` on that proof branch and
projected into `docs/v4/query-mutation-and-lifecycle.md`.

P3 does not by itself accept observed Live Query dependencies, Change Ledger
capture, durable Reaction acceptance/delivery, worker attempts, leases,
fencing, retry, production Runtime/Fetch, or Studio protocol. P4 accepts the
Live Query/Change Ledger seam; P5–P6 own the rest.

## P4 — Live Query and Change Ledger

Status: accepted by ADR-0012 after proof head
`05fc96f3d07c70beaf7f654d79d6cfb46f427f92` and a replacement fresh focused
Opus-medium `PASS` after repair of hostile acceptance findings. Exact P3 head
`a09bf55f0e22f65e059cda9f3eda914520dd4f9d` remains the fixed parent.

### Accepted surface

- `.watch(input, callback, options)` on the same generated Query method;
- complete-result `initial`, `update`, and `reset` delivery;
- opaque client-managed resume token;
- compiler-derived watchability plus Runtime-observed actual reads.

### Accepted artifacts

- Query watchability and dependency-plan projections;
- Change Ledger schema/fact contract and capture program;
- commit-safe reconciliation frontier and retained-resume state;
- deployment and authority partition bindings inside the opaque resume
  projection;
- enforced limit and capture-boundary projections.

### Passing evidence

1. Branch-specific actual reads replace the previous dependency set instead of
   accumulating a historical union.
2. Empty ranges, Relation misses, Policy evidence, Context bootstrap, page
   boundary, and the `first + 1` cursor sentinel invalidate correctly.
3. Failed recomputation preserves the last successful dependency plan.
4. Every recomputation creates a fresh Execution and reevaluates Context and
   current Policy, so revocation takes effect.
5. Concurrent out-of-order commits, rollback, crash, restart, retention, and
   sequence wrap prove a commit-safe frontier. Trigger-time sequence,
   timestamp, or XID alone is not acceptable evidence.
6. Lost or duplicate LISTEN/NOTIFY wakes are harmless because reconciliation
   reads durable PostgreSQL state.
7. Reconnect either resumes safely or returns a typed reset with a fresh
   snapshot. The client never interprets token bytes.
8. Raw SQL, cascades, external writers, partitioning, truncation, merge, and
   upsert cases match the declared capture boundary or fail as unsupported.
9. Dependencies, subscriptions, result bytes, lag, fanout, buffering, retained
   tokens, and slow clients have explicit enforced limits.

### Accepted outcome

- the exact P3 one-shot Query signature plus `.watch`, complete initial/update/
  reset results, and no public resume-token input;
- successful observed-plan replacement, failed-plan retention, fresh-root
  reauthorization, and nondisclosing membership revocation;
- bounded transaction-owned trigger facts and a persisted exclusive `xid8`
  visibility horizon that survives opposite commit order and sequence wrap;
- hint-neutral durable reconciliation, consumer-aware retention, authenticated
  resume bindings, expiry/eviction reset, 2,050-subscription fanout, and slow
  consumer enforcement;
- supported raw DML, cascades, managed external writes, `COPY`, `ON CONFLICT`,
  `MERGE`, and `TRUNCATE`; explicit partition failure and trigger-fingerprint
  drift detection;
- connected collaboration and distinct Archive/Record/ResearchPermit fixtures,
  13 B-tree indexes, zero RLS objects, and no RLS claim.

The proof commits are `269c3f0e97aa49382017f1b4e9a694c09fac7078`,
`258fe9b83f05177dbaef8105d410015006998963`,
`cfaa9f569ae5d43b35b919224d0dc5c3f4d593df`,
`52053195c56c2f0380ec4737b065a8e83e0cf461`,
`d41def56e92ed35d896dd680dd7d58674181bd6d`,
`7bccbd2e435896d868b9605624ac6adf519834cd`,
`b131515068447b08768bbd70a39061156159542b`,
`f2ba1c633682b43be524d5bd92cd035c7cdb79cc`,
`e55f6d98e6b49a2dd6aaf8e307d6d405d4c7af86`,
`c1a0c75130ce5476fab45e9dd51614764d2d5431`,
`1bbb41b8682005d18f4ebc27ac9cf3cb31f2ac28`, and
`05fc96f3d07c70beaf7f654d79d6cfb46f427f92`. Exact digests and measurements
are recorded in `docs/v4/prototypes/live-query-ledger/ACCEPTANCE.md` on that
proof branch and projected into
[`../../live-query-and-change-ledger.md`](../../live-query-and-change-ledger.md).

Later seams: atomic multi-Query publication, persistent offline resume,
Channels/event streams, frontend-library-specific helpers, partitioned reactive
Collections, raw/native SQL reads, non-B-tree Indexes, and broad RLS.

## P5 — Transactional Dispatch and Reaction

Status: accepted by ADR-0013 after proof head
`3f8618613bde1bdd7e13863970eb1c140e201c6f` and a replacement fresh focused
Opus-medium `PASS`. The public projection passed independent factual,
prose/IA, and executable-example audits. Exact P3 head
`a09bf55f0e22f65e059cda9f3eda914520dd4f9d` is the branch parent. Accepted P4
head `05fc96f3d07c70beaf7f654d79d6cfb46f427f92` remains the fixed unmerged
sibling Change Ledger contract.

### Accepted surface

- Mutation `ctx.dispatch.target(input)`;
- `defineReaction`, caller run-as, bounded retry, and
  `run.effect("literal")`;
- stable dispatch, run, attempt, lease, effect, cancellation, and terminal
  receipt identities.

`defineJob` did not enter P5. It remains the next thin durable vertical because
direct, delayed, scheduled, status, result, cancellation, failover, service
run-as, and retention behavior did not run as one matrix.

### Required artifacts

- durable Resource and dispatch projections with payload/result codecs;
- canonical identity and retry/backoff programs;
- PostgreSQL state-transition schema and fencing protocol;
- durable Execution Events and Studio-safe receipts;
- pending-build compatibility and executable-retention metadata.

### Passing evidence

1. Business rows, Change Ledger facts, and dispatch intent commit atomically.
2. A crash after commit and before wake loses neither refresh nor Reaction.
3. Worker claim transactions are short and end before handler code runs.
4. Concurrent workers, lease expiry, heartbeat loss, stale completion, and
   fencing races have one winner.
5. Duplicate acceptance with the same identity returns one logical run;
   changed input conflicts.
6. Every attempt constructs fresh caller or service run-as Context and applies
   current Policy. Worker location or missing credentials never imply System.
7. Retry/backoff, cooperative cancellation, terminal failure, dead-letter
   inspection, and retention are bounded and observable.
8. One stable external-effect identity survives attempts. Provider response
   loss yields an explicit ambiguous outcome, not a blind exactly-once claim.
9. A deployment cannot discard executable code still required by pending runs;
   incompatible readiness and drain behavior is explicit.

Later seams: full Job scheduling if not accepted here, Workflow history,
signals, versioning, compensation, and provider-specific Actions.

### Accepted outcome

- one transaction commits Message, Message Event, P4-compatible Change Ledger
  fact, dispatch/run state, audit, and Mutation result receipt; rollback leaves
  none and missing wake loses no ready run;
- concurrent duplicate acceptance returns one byte-identical receipt and run,
  while changed canonical input conflicts;
- exact inline Reaction input/result/error types preserve P3's unchanged
  `Promise<void>` Mutation dispatch surface;
- every attempt gets one fresh caller Execution and current Policy decision;
  revocation fails terminally and a worker never gains System Authority;
- short `SKIP LOCKED` claims, concurrent workers, lease reclaim, heartbeat,
  timeout, stale completion/retry fencing, cancellation, and dead letters pass;
- stable effect identity recovers an idempotent provider receipt and records an
  explicit ambiguous outcome when the provider contract cannot know;
- exact executable bytes/digest stay pinned for nonterminal work; readiness,
  drain, safe events, retention, all declared limits, and hostile roles pass;
- collaboration and Archive/Record/ResearchPermit fixtures pass with 27 B-tree
  indexes, no expression/partial indexes, zero RLS objects, and no RLS claim.

Proof commits are `abb7bd9d1f5d12b3f6f2a604deacf1a67a6ee7de`,
`776e576559ae27caaba2e55367204e3c2b62c2ab`,
`17ab37789e43b26748828a145e5abc32fda8cf88`,
`82508ab42d39bff9c27d91f761f6697a1550f50a`,
`570c7f3ecce1ea9509f2974c05a47655cf6fc64e`,
`8f43dfd38c4bb1b73138d0e4cb7a42feeb917291`,
`9af51ca8febb0d11d4a61c970945986ff6dc40b2`,
`cda1f74895117ee7fb8d191b36be46cc6dc0118d`,
`a0b4191313405ff3ee6141da1660a4c680231293`,
`a66a22230e4a3d35eb3a39cd598878492db9d0fa`,
`f44ba55cac5ec8c7eaf2f748502bd66451a76b8d`,
`dd4a09ca13e7f9fc4de3103aafd20999d27dbce6`,
`4eff26d9fbe86352819cb7d260eb895cbd27db61`,
`c3a2e6656c548c335eb38b59db193fe30a0a71a9`,
`cc59669736ecf31383ee9da268a40de07016760f`,
`5556210d1002728abc13698c749cf72ee09baef8`, and
`3f8618613bde1bdd7e13863970eb1c140e201c6f`. The earlier `dd4a09ca` acceptance
was superseded when projection review exposed error-codec drift from fixed P3;
the final five commits repair, remeasure, rereview, and accept the exact P3
grammar. Exact digests and measurements
are projected in
[`../../transactional-dispatch-and-reaction.md`](../../transactional-dispatch-and-reaction.md).

## P6 — Runtime, client, Execution Envelope, and minimal Studio

Status: accepted by ADR-0014 at proof head
`94c237c9aa910a60a332b1ef97473f34fe89d65b`. Exact accepted P4 head
`05fc96f3d07c70beaf7f654d79d6cfb46f427f92` and P5 head
`3f8618613bde1bdd7e13863970eb1c140e201c6f` converge through no-ff commit
`a3fba116e9719c1859842ddea75c5312d6dc7e80`.

The immutable bundle pinned to exact P1 artifacts, generated-client Fetch wire,
credential refresh, Runtime/client parity, forced and interrupted lifecycle,
deployment compatibility, Execution Envelope, CLI/Studio explanation parity,
fenced maintenance, exact generated types, rows/dependencies/write/redaction
budgets, full inherited P4/P5 database matrices, local PostgreSQL 17.10, five
P6 hostile-role attacks, B-tree-only introspection and zero-RLS/no-RLS-claim
gates pass. Managed Supabase PostgreSQL 17.6 independently passes version,
collation, session, advisory-lock, LISTEN/NOTIFY, trigger-ledger, SKIP LOCKED,
reconnect, drift, and named-schema cleanup checks without a provider plugin.
An initial focused review found two real wire failures; repair commit
`6100fc8f` closed them. The replacement focused Opus-medium review and final
connected-tracer Opus-medium review returned PASS with no blockers.

The post-P6 public projection is also complete. Three fresh independent
Opus-medium reviews of the final public Runtime/Studio page returned PASS for
facts, prose/information architecture, and executable examples. The
credential-free aggregate reran the complete local matrix, truthfully withheld
the managed claim without credential environment, and the TypeScript/editor,
docs typecheck, oxfmt, oxlint, link, ancestry, clean-status, and
`git diff --check` gates passed.

The focused sibling `P6R1/PostCommitOutcome` revision was reviewed at
`deea51ba2799867825b120ec46ec5d8944991d1b` and recorded at
`cb568dc402462163d632a2d689da709a087f64ae` after initial head `d5c562d8`
was validly `BLOCKED`. The single replacement Opus-medium review passed.
P6R1 preserves Operation Wire v1 bytes and digest, accepts Wire v2 digest
`2f4cd0631be02ff8a979a0aaa22d0fd393d3638db55e4cc9bbb2db6d9a5ade28`,
adds only the exact `COMMITTED_RESULT_UNAVAILABLE` framework transaction
outcome, and carries every v1 result kind and declared error forward. Retained
v1 Queries remain executable; v1 Mutations receive v1-readable
`CLIENT_OUTDATED` before Context Resolution or Operation execution. ADR-0023
records that Mutation-only compatibility narrowing and the general bounded NFC
Call Identity contract.

### Candidate surface this chapter may accept

- generated `createApp()` with `fetch`, `execution`, and idempotent `close`;
- immutable `client.withContext(input)` and the exact generated wire contract;
- `questpie build`, explicit migration apply, and standalone `questpie start`;
- startup, readiness, liveness, drain, role, and restart behavior;
- one versioned Execution Envelope plus a closed append-only event family;
- `questpie explain` and minimal Studio inspection/maintenance surfaces.

### Required artifacts

- immutable bundle inventory, checksums, Runtime Build, and wire contract;
- Runtime lifecycle and role state machines;
- exact Fetch frames, generated client, and compatibility diagnostics;
- canonical Execution Envelope and event-body union;
- Studio read models and narrow typed maintenance command union;
- connected local/managed PostgreSQL conformance report.

### Passing evidence

1. Build, explicit reviewed migration apply, and start are the one normal path.
2. Artifact, identity, version, schema, or Runtime Build mismatch refuses
   startup before traffic or worker execution.
3. Direct, generated client, recompute, worker, and Studio use the same
   Execution, Policy, Operation, error, and transaction engines.
4. Response loss and crash after database commit remain recoverable from stable
   call, ledger, and dispatch identities.
5. Policy, transaction, change, subscription, dispatch, attempt, error, log,
   trace, and audit events correlate without exposing secrets.
6. Studio has no raw SQL, private-table CRUD, Policy bypass, or second backend;
   application data uses ordinary generated Operations.
7. Readiness and bounded drain handle Operations, subscriptions,
   reconciliation, schedules, leases, and external-effect ambiguity safely.
8. The same Definitions pass on local PostgreSQL and one managed Supabase
   target without an application-visible provider SPI.
9. Cold start, memory, operation duration, rows, bytes, dependencies,
   subscriptions, fanout, retained state, and per-Principal concurrency are
   measured and fail with structured diagnostics.

Later seams: split roles, full public Service/Route/Action, broad Auth/File/
Search integrations, complete Job/Workflow, fleet Studio, Cloud, optional
Redis/KV/broker/storage capabilities, Channels, OpenAPI/MCP projections, and
host/provider SPIs. A final public spelling consolidation must compare accepted
named `define*` factories with compiler-specialized `define.<kind>` and
`<kind>.define` families under exact inference, declaration, editor-budget,
Package-isolation, and no-registry proofs before any accepted spelling changes.

## Post-P6 implementation-gate closure

Status: accepted at proof head
`a164e33e752ab54d48fcf903371938ecff3dc082`. The fresh focused Opus-medium
review ran against clean repair head
`79d7816dbf0b9b6e052706daf71fe173e1cbfc42` and returned `PASS`.

The proof closes only the four blockers carried out of P6:

1. inherited P4 retention and sequence-wrap evidence runs in the exact new
   proof-owned PostgreSQL 17.10 container, with prune-while-snapshot-open,
   prune-after-close, and no-snapshot negative controls;
2. CLI and Studio have separate source producers and independent joins over
   canonical artifacts and Runtime observations while emitting identical
   canonical bytes;
3. the connected migration tracer derives closed plans, verifies immutable
   committed checksums, applies DDL and receipt atomically, recovers a lost
   success response, rejects tampering, and detects then repairs Drift;
4. an exact Owner-accepted Package Augmentation reaches Package Inventory,
   Manifest/App Contract, Schema Projection, migration, matched Runtime Query,
   exact TypeScript type, and editor completion, while wrong inventory refuses
   readiness.

It adds only ordinary B-tree evidence, no raw-SQL or generic `using` authoring
authority, no provider SPI, no RLS object, and no RLS claim. Production Runtime
was not implemented. The connected tracer's pre-implementation integration
gate is closed; future slices must retain this matrix as regression evidence.

## P17 — Service, Route/Fetch, and Auth composition

Status: accepted by ADR-0015. The exact clean reviewed input is
`7211bd3c8a9cdbe131b026874d4441f3ccb39c9d`; the acceptance record head is
`79d3667019e0a4cda6f7652d24f2d9c6b68d4fca`. One valid fresh stateless Claude
Opus review at medium effort returned `PASS`. Two earlier 300-second invocations
returned empty timeout non-results and are not review verdicts.

The focused proof establishes:

- stable identity, Owner, Origin, collision-free Fetch mounts, and no mandatory
  Auth schema or client ownership;
- exact raw-body and compiled-handler parity between Fetch and generated direct
  Route invocation, with an explicit direct ingress Principal;
- anonymous, resolved, and provider-failure credential outcomes without a
  second authorization decision;
- lazy/coalesced application Services isolated across two Runtime instances;
- lazy/coalesced execution Services per root with reverse cleanup after
  ordinary response, stream EOF, error, cancellation, and Runtime close;
- no implicit System authority, data facade, mutation facade, or raw database
  at Route ingress;
- compiler-shaped lifetime and effect dependency direction, capability-scoped
  Query/Mutation/Route projections, Package isolation, negative imports, exact
  completion sets, and bounded declarations/editor work.

Canonical intent digests:

- Service/Route resource projection:
  `6a743c530abf00246d37d36a43de5146c1ad8f9c0982017dfd6b5d7d9ad86511`;
- Fetch mount projection:
  `6bb6a67a95789681d04f92f8f1326f77f06656837816276d00e59f24e366b8db`.

Final deterministic evidence after non-semantic review cleanup uses 1,257
TypeScript instantiations, a 0.39-second focused typecheck, 2,396 declaration
bytes, and complete application/Route/Execution completion sets. Oxfmt,
Oxlint, the aggregate Bun proof, and `git diff --check` pass.

Implementation must derive artifacts from real compiler input and add exact,
wildcard, parameter, precedence, and overlap Route fixtures. Ticket #21 owns
the final Service/credential factory import because their executable slots must
not silently expand ADR-0009's six-value Current App Contract allowlist or enter
structural evaluation.

## P18 — lifecycle jobs and one durable kernel

Status: accepted by ADR-0016. The exact clean reviewed input is
`fa2960083c94f824d7c0f4d005a9aec01babb978`; the acceptance evidence head is
`71463e99a70481b0950ae18d1ff409c034c1b158`. One fresh stateless Claude Opus
review at medium effort returned `PASS`.

The focused proof establishes:

- a complete v3 `beforeValidate`/`beforeChange`/`afterChange`/`afterRead`
  mapping with one explicit v4 owner and rejected failure mode per job;
- one accept/claim/retry/cancel/complete transition implementation used by Job,
  committed-fact Reaction, and Workflow rather than three durable engines;
- explicit, delayed, and scheduled Job acceptance, stable scoped idempotency,
  and schedule removal that does not cancel accepted runs;
- Reaction creation only from an exact committed fact with stable causation and
  no independent producer;
- Workflow checkpoint resume, ordered names, stable Mutation Call and Action
  Effect identities across a crash window, typed/deduplicated signals, lease
  recovery, stale-worker fencing, and pinned executable compatibility;
- exact capability-scoped contexts, closed Workflow commands, absent generic
  browser controls, Package isolation evidence, declaration and editor budgets.

Canonical digests:

- lifecycle mapping:
  `659f18afea0d8d762dfba92ffe548597bb8ae265852982c248ad445c64f03cfd`;
- shared durable kernel:
  `1dc85342f92c2ab1f90db57a28974e81434c53b67149e965463b2bd16ba0d72b`;
- capability projections:
  `34720a80ff2a971aca5786e484a2dce98f2517f23d2adeb6f29e9d564477f8d5`.

The fixture uses 1,861 TypeScript instantiations, a 0.38-second focused
typecheck, 5,446 declaration bytes, and 0.29 ms autocomplete p95. P5 remains
authority for the PostgreSQL transition matrix and fresh run-as Policy proof.
Ticket #19 owns ten-instance scheduler and rolling-deployment behavior; ticket
#21 owns final factory spelling. Implementation evidence must tighten a needless
post-cancel recovered attempt and directly exercise nondeterministic command
mismatch and append-only assertions.

## P19 — multi-instance HA and optional acceleration

Status: accepted by ADR-0017. Initial reviewed head
`be611ef244687be9daccc2a9e02fbd2e2ccfe86e` received a valid `BLOCKED`
verdict. The exact repaired reviewed head is
`039a720d12956ddc8e1a310e287945de35a52065`; acceptance evidence head is
`96829bd7b08ea54e60fdc7d5b077366235d2dfea`. One replacement fresh stateless
Claude Opus review at medium effort returned `PASS`.

The repaired proof establishes:

- ten compatible instances with arbitrary direct/POST/worker/recompute/Studio
  entry, a three-instance SSE connect/POST/resume path, and no affinity;
- complete local cache and wake loss with PostgreSQL recovery and fresh Policy
  before cache disclosure;
- ten concurrent schedule sessions producing one unique tick/run and ten
  overlapping `SKIP LOCKED` worker sessions producing distinct claims;
- crash recovery with a new attempt/lease and stale-token rejection;
- explicit old-build refusal of v2 work, compatible new-build claim, and
  nonterminal executable retirement block/unblock;
- compiler/Policy/PostgreSQL-owned Channel identity, order, replay,
  deduplication, and reauthorization reset;
- B-tree-only PostgreSQL 17.10 state, zero expression/partial indexes, zero RLS
  objects, and no RLS claim.

Canonical digests:

- authority:
  `6cbddce542daa53a715c33b5850104b1847a5fa2310add3cb9b2f9d77fb72625`;
- accelerators:
  `bc38c0359e8bbc9282df731089ce4587ece44ea522f963cccd6828ede0ac7eba`;
- capability projections:
  `512f97afca6fe96ab868fd21aaa743a3c0deb01aa740bdf8d28426d3154990ba`.

Implementation evidence must additionally exercise changed-payload Channel
conflicts, no future tick after schedule removal, stale/corrupt real cache keys,
post-write arbitrary routing, and contended old/new executable claims. Ticket
#20 owns Files/Search and byte storage; #21 owns final public spelling; #22 owns
nightly/manual HA, fanout, worker, rolling, and optional-infrastructure load
architecture.

## P20 — File, Search, and contract projections

Status: accepted by ADR-0018. Initial reviewed head
`fb06a82c195ad3eeb3f1feddc4a9261e278033fd` received a valid `BLOCKED`
verdict. The repaired reviewed head is
`eaa21e0ca2c4a3b941a04e98b1a0278d0fe0aba9`; acceptance evidence head is
`6e056bc44c15740b2797a9489fe3823c3100bdad`. One replacement fresh stateless
Claude Opus review at medium effort returned `PASS`.

The proof establishes:

- ordinary File metadata ownership, exact structural role projection, and no
  hidden Collection or independent provider Definition;
- identical filesystem and S3-compatible lifecycle behavior through one narrow
  byte capability with no Principal, Policy, transaction, or raw database;
- reserve replay/conflict, pending nondisclosure, checksummed idempotent
  transfer, cancellation, finalize replay, missing bytes, delete replay, abort,
  orphan cleanup, and cleanup replay;
- byte capability on Route/Execution context and a negative Mutation boundary;
- committed Search projection and checkpoint, higher-ranked forged/denied
  candidates, current revocation, one authorized total/facet/cursor universe,
  and bounded `first + 1` paging in runtime and PostgreSQL;
- compiler-owned OpenAPI/MCP/skill projections, unsupported raw-stream Origin
  diagnostic, exact generated boundaries, Package-safe negative imports, and
  editor/declaration budgets;
- PostgreSQL 17.10 with B-tree-only indexes, zero RLS objects, and no RLS claim.

Canonical digests:

- File projection:
  `0996ce721ac147a24863f83595d74efcd354c7a85d157307d683e84851af6943`;
- Search projection:
  `a411dc21be294b557ce84af16434411afb92d15b1ae81d7f2829c87c3e444adb`;
- contract projections:
  `9a67fe31fc4caf048be37be261b549635d60020764d2b061c60025f4443c1af4`;
- byte capability:
  `f3b20ecfad583a5051d1b99f470d7346911ed495a9c6cf0d7930b6fea127f9cf`.

TypeScript 5.9.2 records 1,496 instantiations, a 0.07-second check,
0.27-second total, 1,819 declaration bytes, and sub-100 ms warm completion p95.
Implementation retains focused edges for mixed-direction cursors, role-specific
File Fields, Search Field disclosure and exact denied codec, PostgreSQL
checkpoint contention/removal, and Route byte-capability lifetime. Ticket #21
owns final spelling; #22 owns repository and load architecture.

## P21 — semantic kernels, naming, and exports

Status: accepted by ADR-0019. Initial clean reviewed head
`1785809aeed4f517f5182c5fc3fffd5802433181` received `BLOCKED`. The repaired
reviewed head is `0f44e985cf897a499cae6801966a2467c1e09b68`; acceptance evidence head is
`d50d4334b116a5bdc46e95cdabf566d8db938d37`. One replacement fresh stateless
Claude Opus review at medium effort returned `PASS`.

The proof establishes:

- named `defineKind` factories over `define.kind` and `kind.define`;
- one scalar kernel for `codec`, `field`, and compatible `value` projections,
  with Operation only composing codecs;
- restricted Query/Policy relational views, Job/Reaction/Workflow durable
  views, and Route/Fetch views without a universal builder;
- exact stable `questpie`, generated `#questpie/app`, isolated
  `#questpie/package`, and generated `#questpie/client` boundaries;
- `defineWorkflow` as the seventh current-app/package factory,
  `defineChannel` versus Query `.watch`, and no `defineFetch`;
- File/Search/OpenAPI/MCP/skill final spelling and four distinct optional
  Runtime capability bindings without a provider registry; and
- complete application/Package fixtures, negative imports and invalid
  combinations, exact autocomplete/hover, relocation typecheck, no ambient
  registry, and bounded declaration/editor costs.

Canonical digests:

- scalar: `3178258696ccb9cfad99a6dabea943b3a6ba72572f7d6f8a8efcf6c5aad50b10`;
- Operation: `6a20de393afa9538ef2844fe9e1f03411c9d5927c67116bd02b3421f702da84a`;
- relational: `fe66d9a8d1c9050374026b436a19d4e2baaba29cdb767d8a6c9676120be6c697`;
- durable: `4823d87ac0df9f376f011c0f40674a5f0caed7f3a0a95acd750445c7803d851a`;
- Fetch: `d4ecf09b98c6457d1dc57dce6b3fa7abad0634fe64e9ed58fcbd031ec157d2cf`;
- capability: `b4e8caa94c2fde92cff01c764071fa195a83b60a1dae0258c19f1beaa6047be1`;
- exports: `25280f28bdffebe69eebfe96afda9abaad1c7ac55b623588265695cf64aad166`.

TypeScript 5.9.2 records 6,455 instantiations, a 0.16-second check,
0.36-second total, 5,811 generated declaration bytes, and sub-1 ms warm
completion/hover p95. Implementation must replace fixture declarations and the
copied relocation digest with real compiler output, preserve raw Route
ingress, prove the complete Workflow commands and value/operation helper
projections, and bind byte storage through P17 without Mutation authority.

## P22 — repository foundation

Status: accepted by ADR-0020. Initial clean reviewed head
`bf45e2036fb1796f7f97899b9ef5672bdce4d27d` received `BLOCKED` because Knip
selected `unlisted` and `binaries` without promoting them from warnings. The
repaired reviewed head is `fe8b5158d4d4eefb5920f07b3c7198fa3a4d8553`;
acceptance evidence head is `17008b0547f24b53d456530b798e8d96ae2e2b1e`.
One replacement fresh stateless Claude Opus review at medium effort returned
`PASS`.

The proof establishes:

- one closed eight-lane repository runner with a sub-second warm focused loop
  and a 9.40-second repaired docs-only full loop;
- Bun 1.3.14, exact canonical TypeScript 6.0.2, and one non-blocking native
  TypeScript 7.0.2 forward lane;
- report-only noisy Knip classes plus blocking `unlisted`, `binaries`, and
  `unresolved`, with a negative dependency/binary control;
- independent PostgreSQL 17 correctness, selected-PR microbenchmark, nightly/
  manual load, manual soak/chaos, and stable-runner release lanes;
- one repository-owned performance manifest/harness with slice-owned budgets;
- package export/declaration/artifact guards, OIDC release, contribution and
  security guidance; and
- a concise portable five-branch router skill, reduced HANDOFF, deterministic
  context check, and repo-owned fresh stateless acceptance wrapper.

Canonical digests:

- router skill:
  `7237c3d9b42a9cf64dcb7e1e308b229eceb13605ac878236e168121027e9e714`;
- acceptance wrapper:
  `0a846bb9ec1c7d78be1e8b247be946659363229087a637bea4f77885f4101753`;
- quality runner:
  `7805beb1422b05a682ed5f4062f6e265738ae58543be18de00eff5fc6e436c1d`;
- performance harness:
  `3ee1016f791d9b9065b69d60cbe31023aa0d6bed05cc972b71f3f71f165f042e`;
- Knip configuration:
  `cc65143d5cac1adda5b896b2eb21a510aac23a3147557d2ac144436122fe735d`.

Repository-foundation work implements no production compiler or Runtime.
Individual implementation slices must add their own correctness fixtures,
micro/load/soak manifests and budgets when the accepted behavior first exists.

## P14 — complete conformance map

Status: accepted. Initial reviewed head
`e222be7484f6b5ae10eaf7eb209b2259f5a17865` received `BLOCKED` for a
tautological validator and missing Channel Resource owner. Repaired reviewed
head `56a39c27704afef00c6b25fdbd13ade88278b668` adds a structured 20-row
validator, five invalid-matrix controls, and separates compiler/Policy/
PostgreSQL Channel semantics from `channelCarrier`. The replacement fresh
stateless Opus-medium review returned `PASS`; acceptance evidence head is
`3a89c565cb1eba59815d106df1c06406ac20ac98`.

The conformance map uses collaboration/publishing and materially different
archive/permit/embargo fixtures. Every cell owns its fixtures, direct/network/
worker/recompute/Studio surfaces, hostile cases, quality lane, and artifact.
Local and selected managed PostgreSQL, ten-instance rolling/crash behavior,
optional-infrastructure loss, exact generated types/exports, and slice-owned
performance budgets are explicit. It retains B-tree-only Index and makes no RLS
claim. Runtime lifecycle compatibility and maintenance-command fencing remain
named edges for #15/#16 slicing.

## P15 — beta.1 release slice

Status: accepted by ADR-0021. Initial clean reviewed head
`49e142607e9c0275ee07a2fa4b90ff516eaf6995` received `BLOCKED` because the
accepted Service graph had neither a beta.1 owner nor an absence story, while
Context disposal depended on it. Repaired reviewed head
`5c4bdfa67ea97fa48793d01fbee188b7dbf19e3b` adds a first-class Services slice,
the dependency from Context/Policy, precise lifecycle/effect ownership, and two
matching negative controls. One replacement fresh stateless Claude Opus review
at medium effort returned `PASS`; acceptance evidence head is
`0d8e2543ff7e9d50bdab7d2b66b62ec4c35d8a6f`.

The checked release contains ten dependency-ordered slices from foundation
through connected conformance and nine explicit absence stories. It preserves
the P1–P6 spine, includes Service lifetime, Query watch, one committed-fact
Reaction, and minimal Studio, and defers capability breadth without inventing a
temporary public API. Seven negative mutations prove required slice,
dependency, seam, release-gate, Service ownership, and Context/Service ordering
failures. The primary tracer is collaboration/publishing and the portability
fixture is archive/permit/embargo. PostgreSQL remains the only durable
dependency, Index remains B-tree-only, and no RLS claim is introduced.

## P25 — remove Channels from the core

Status: accepted by ADR-0025. Initial reviewed head `51d7c5ba` was `BLOCKED`
because the authority projection was self-referential and did not classify the
permanent capability map or accepted P14/P15/P16 artifacts. Repair
`bb63199b` closed those boundaries but its replacement review found an
under-broad content scan. User-authorized repairs `cb394f67` and `ed0dfa7c`
broadened discovery to every `Channel` word and made benign exemptions
falsifiable from file bytes. The final fresh stateless Opus-medium review
returned `PASS`; the verified review record is committed at `053690f6`.

The proof establishes:

- no Channel Resource, `defineChannel`, generated client/codecs, PostgreSQL
  event ledger/order/replay/generation, presence model, or
  `runtime.channelCarrier` remains current or deferred;
- no replacement Signal, Broadcast, Presence, event-bus Resource, provider
  registry, compiler ABI, or runtime binding is introduced;
- Live Query owns current authorized state, ordinary Collections own durable
  history, and Reaction/Job plus Action or an external-effect Service own
  durable external publish attempts without exactly-once overclaim;
- provider events, subscription authentication, connection lifetime, advisory
  presence, rate limits, and telemetry are application/provider concerns and
  cannot authorize Operations; and
- accepted proof artifacts and reviews remain immutable historical evidence,
  while permanent maps and current ADR/product/gate/build/public/visual/
  wayfinder surfaces project the removal.

The repository-aware validator scans 39 Channel-bearing current authority
files: 21 require projection and 18 are exact domain/ordinary-English
exemptions whose bytes contain no core capability marker. Seven accepted
historical evidence files are explicitly exempt and superseded. Negative
controls reject ten contract regressions, omission of marker-invisible
ADR-0021, and misclassification of a core semantic-kernel document as benign.
The collaboration fixture's Company → Space → Channel → Membership → Message
domain graph remains intact.

## Acceptance and projection protocol

For each chapter:

1. freeze its design-fiction fixture and exact proof checklist;
2. work in a clean focused proof worktree and commit every deterministic proof;
3. record full commit IDs, canonical digests, Bun commands, PostgreSQL versions,
   TypeScript/editor/runtime measurements, and `git diff --check`;
4. do not use an exploratory review as acceptance;
5. after all evidence passes, run one fresh focused Claude Opus review at
   medium effort;
6. only after `PASS`, update the ADR index, `CONTEXT.md`, public v4 docs,
   implementation gates, blocked work map, and `HANDOFF.md`;
7. keep every later seam explicit and do not project its candidate syntax as
   authority.

After P6, run one final fresh Opus-medium review of the connected tracer packet.
Production compiler/Runtime implementation begins only after the accepted
chapters needed by that tracer have been projected into authority. P1 alone is
not permission to build a disconnected compiler preview.

## Release interpretation

ADR-0021 fixes `4.0.0-beta.1` as an end-to-end application-server vertical, not
only code generation. It includes the connected compiler, migration, Service,
Context/Policy, Query/Mutation, Runtime/client, Live Query, Reaction, and
minimal Studio spine. The checked slice artifact owns the exact dependency
order, compatibility promises, absence stories, and release gates. Ticket #16
must collapse that accepted slice into one build specification and native
blocking issue graph before implementation begins.
