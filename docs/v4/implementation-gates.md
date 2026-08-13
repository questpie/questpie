# QUESTPIE v4 implementation gates

These gates apply to every implementation slice. The first authorized slice is
the Barbershop tracer in `SPEC.md`.

The post-P6 integration closure is accepted at proof head
`a164e33e752ab54d48fcf903371938ecff3dc082`. Its reviewed clean evidence head
`79d7816dbf0b9b6e052706daf71fe173e1cbfc42` received one fresh focused
Opus-medium `PASS`. It closes the four prerequisites that previously blocked
the connected tracer; their assertions remain mandatory regressions below.

## Authority and language

- `SPEC.md` owns scope and order, Accepted ADRs own durable decisions,
  `CONTEXT.md` owns terms, and each accepted `docs/v4/` workbench owns its exact
  versioned contract. Resolve a contradiction explicitly.
- Public docs project accepted behavior. Issues sequence work but grant no
  authority. QUESTPIE commands produce generated output and canonical
  artifacts; users review required output instead of reconstructing it.

## Gate 0: current-scope test

- The change is required by the current tracer or removes a blocker for it.
- The guarantee cannot be supplied with a smaller public surface.
- A deferred ADR does not enter implementation without a new focused grill.
- The change does not create a second schema, composition, execution, or
  observability path.

## Gate 1: identity and ownership

- Every Resource has explicit Resource Identity, Owner, and Origin.
- File, export, Feature, Package, and discovery order do not create identity.
- A second contributor uses an explicit Augmentation Contract.
- A collision diagnostic names both Origins and the missing authority.

## Gate 2: compiler determinism

- The same inputs produce the same Compiled Manifest, Origin Map, diagnostics,
  and App Contract.
- Runtime startup performs no Module or plugin merge.
- Import order cannot select behavior.
- Generated value and emit layers form a downward-only acyclic graph. Type-only
  source edges and the seven allowlisted pure executable Definition factories can
  resolve through the Current App Contract. Structural evaluation cannot load
  emitted Runtime output or any other generated value.
- Inline and imported handlers slice into one static Executable Slot without a
  handler registry, required paired file, repeated Resource name, or
  per-operation capability map.
- `questpie check` and build construct the Current App Contract. They cannot use
  stale disk output as current-build authority.
- Runtime Build pairing refuses missing, duplicate, stale, wrong-kind, or
  cross-build Executable Slot bindings.
- `questpie build` publishes one complete checksum inventory through an atomic
  directory-pointer replacement. Structural verification evaluates no handler;
  Runtime load evaluates the statically bound executable module once.
- Startup binds the exact Manifest, App Contract, Package Inventory, Runtime
  Build, executable, schema, migration, Change Ledger, resume, durable-
  compatibility, Origin, and wire artifacts. It refuses every mismatch before
  traffic or worker claims.

## Gate 3: TypeScript contract

- Leaf Definitions infer local input and output without application-wide
  recursive types.
- The generated App Contract uses exact keys, context, input, output, exposure,
  and declared errors.
- Public declarations contain no ORM type identity, broad `string`, `any`, or
  ambient fallback registry.
- Generated Collection contracts expose exact Field identities, segment-array
  paths, one primary key, codecs, and resolved Relations. Embedded `value.*`
  members never masquerade as independently addressable Fields.
- TypeScript instantiations stay inside the committed tracer budget.
- Recursive executable output components require an explicit output pin. They
  cannot widen or use a previous generated contract.
- Repository-foundation ticket #22 must replace the inherited TypeScript 5.9.2
  proof baseline with a measured canonical implementation compiler decision.
  The gate includes a clean TypeScript 6 migration, stable TypeScript 7 native
  side-by-side conformance, docs/MDX and declaration tooling, generated exact
  contracts, editor behavior, Package isolation and refreshed performance
  budgets. Historical 5.9.2 measurements remain labeled evidence and are never
  silently reinterpreted as results from a newer compiler.

## Gate 4: schema lifecycle

- Compiled Manifest, Committed Migration chain, and actual Schema Fingerprint
  remain distinct.
- Every regular Collection has exactly one named primary-key Constraint. `id`,
  `createdAt`, and `updatedAt` are ordinary Fields; schema defaults initialize
  values but do not implement Mutation-owned update behavior.
- Inline Shapes compile to ordinary leaf columns with canonical segment-array
  paths. Typed `field.object` and `field.array` values compile to one JSONB
  column with a bounded `value.*` codec. Open `field.json` stays tagged and
  untyped inside. Compilation never synthesizes a hidden Collection.
- Every text Field lowers `questpie.binary` to explicit deterministic
  PostgreSQL collation `C`; database-default ordering cannot enter keys,
  Constraints, Indexes, Queries, or cursors.
- Every schema change produces one reviewable Migration Plan.
- Migration identity, checksum, destructive classification, Owner, and Origin
  are stable and visible.
- Schema Projection, Migration Plan, base and target snapshots, and Schema
  Fingerprint use the canonical v1 formats and domain-separated digests in
  `docs/v4/schema-lifecycle.md`.
- A rename is explicit; a destructive migration is accepted by its exact Plan
  Digest; blocked and non-transactional steps cannot create a v1 artifact.
- Apply rejects incompatible history or checksum.
- Apply owns one transaction per v1 migration and commits the immutable
  Migration Receipt with the DDL.
- Drift verification runs after apply.
- Seeds are immutable, dependency-ordered, and commit data with their Seed
  Receipt. V1 accepts only typed data steps and exposes no callback, SQL, or
  external-effect seam.

## Gate 4A: structural Query contract

- Each structural Query has one closed parameter, selection, filter, total
  order, and forward-page template. The compiler never adds a Field, predicate,
  order term, or tie-breaker silently.
- Every order states direction and null placement, ends in one non-null primary
  or unique key, and is projected into the selected result. Page size cannot
  exceed 100.
- Scalar-list parameters declare `maximumItems` from 1 through 1,000. Binding
  checks the authored count before deduplication, rejects null members, and
  canonicalizes the list as a set; the empty set remains valid.
- Query Template, parameter scope, cursor, and dependency bytes use the exact
  domain-separated canonical formats in
  `docs/v4/data-model-and-query-grammar.md`.
- V1 addresses inline leaf Fields only. Typed or open JSON interiors,
  whole-JSON equality, projected `toMany`, aggregates, backward pagination, and
  native statements remain blocked until their own accepted contracts exist.

## Gate 5: transaction and authorization

- Query owns one bounded consistent read snapshot. Its generated Context is
  read-only and exposes no dispatch, raw database/SQL, transaction, Policy
  bypass, Action, or ordinary System capability.
- Mutation owns one PostgreSQL transaction.
- Generated Mutation reads and writes, validation, Constraints, audit writes,
  Operation Result Receipt, and typed dispatch intent join that transaction.
- A closed Collection Operation Set lowers before Manifest emission to ordinary
  `list/get/create/update/delete` Query or Mutation Resources. There is no
  runtime CRUD dispatcher or private Studio data path.
- Mutation ordering is decode, admission, consistency boundary, row scope and
  lock, sparse caller Field authority, pure normalization, schema defaults,
  closed server values, complete candidate validation, candidate Policy,
  PostgreSQL Constraints, selection, output authority, output validation,
  commit, and encoding.
- `createdAt` and `updatedAt` remain ordinary Fields. Server values and every
  `updatedAt` change require explicit Mutation-owned assignments.
- Inferred output is accepted only when the compiler materializes a supported
  closed codec at its Origin. An explicit or recursive output pin validates and
  encodes; it cannot cast an unsupported value.
- Mutation call identity is scoped by application, Tenant, Operation,
  Principal, and call ID, binds the canonical input digest, and stores exact
  result bytes in the owning transaction. An exact duplicate applies once;
  changed-input reuse fails.
- Cancellation before commit rolls back. Cancellation or response loss after
  commit reports recoverable committed-result ambiguity and never claims
  rollback. Direct and wire adapters agree through the same Operation engine.
- Closed Field normalization, closed server values, named Mutation,
  transactional audit, typed pending dispatch intent, and external Action have
  distinct owners. A general `before*`/`after*` hook catalogue is forbidden.
- Business data, Change Ledger rows, and Transactional Dispatch intent commit
  atomically.
- One transport-neutral Context resolves once per root Execution, coalesces
  concurrent consumers, fails before Policy or handlers, propagates unchanged
  to nested work, and disposes scoped Services after success or failure.
- Context bootstrap is bounded, exact-key, selected, read-only, deadline- and
  cancellation-aware, and exposes no raw database, write, Queue, Service, or
  System capability.
- Principal, Tenant, Authority, and resolved Context values are immutable for
  one Execution. Ordinary roots cannot select or infer System Authority.
- Policy fails closed and constrains direct execution, network clients, nested
  work, recomputation, worker attempts, and Studio equally.
- Collection Policy fixes admission, SQL row scope, sparse supplied-input
  Field checks, selected-output omission, current-row scope, and complete
  candidate authority. It never rewrites values.
- Relational Policy evidence is bounded and boolean-only. Returned rows apply
  normal target disclosure Policy, while mutable evidence reads remain
  dependencies and are rechecked inside the owning consistency boundary.
- Framework-owned SQL applies Policy before filters, counts, cursor sentinels,
  ordering, locking, and disclosure. Runtime post-filter fallback is forbidden.
- Missing and Policy-invisible rows and references are nondisclosing;
  validation, Constraints, cursors, and error order cannot form an oracle.
- A lock waiter rechecks current mutable evidence and candidate authority in
  the Mutation transaction before writing.
- The accepted projection emits no RLS claim. Any later derived RLS contract
  needs its full hostile role, pooling, setting, `USING`/`WITH CHECK`, race, and
  constraint-leak matrix.
- Privileged raw database behavior is explicit and tested.

## Gate 6: realtime correctness

- Live Query dependencies come from supported reads that the handler actually
  executes. Recompute replaces the dependency set.
- Policy, tenant, Relation, and pagination reads participate in invalidation.
- A lossy wake cannot lose a committed refresh because the Change Ledger is
  durable.
- Reconciliation uses a persisted PostgreSQL visibility horizon; fact identity,
  sequence, timestamp, and trigger XID maxima are forbidden frontiers.
- Crash, reconnect, duplicate/coalesced/delayed/absent wake, replay gap,
  retention, sequence-wrap, and slow-client cases have behavior tests.
- Reconnect validates an opaque client-managed token or returns a complete
  freshly authorized reset.
- External PostgreSQL writes have an explicit capture contract.
- Managed writers cannot forge reconciliation state or disable capture.
- Dependency, subscription, result-byte, buffer, fanout, lag, retained-token,
  and retention-age limits fail explicitly.
- Raw SQL without an explicit dependency token is not reactive.
- Independent Live Queries converge independently until a cross-Query
  checkpoint contract is accepted.

## Gate 7: durable execution

- Business rows, Change Ledger facts, audit, dispatch/run state, and Mutation
  result receipt commit or roll back in one transaction.
- A lost wake cannot lose committed work; durable ready state is authority.
- Dispatch, run, attempt, lease, effect, cancellation, causation, correlation,
  and terminal receipt identities stay distinct.
- Duplicate scoped acceptance returns one logical run and receipt; changed
  canonical input conflicts.
- Claim transactions use bounded `SKIP LOCKED` work, persist an attempt and
  fence, and end before a handler or provider call.
- Every attempt constructs one fresh root Execution, resolves Context once,
  checks current Policy, and never inherits System Authority from a worker.
- Lease expiry, heartbeat loss, stale completion/retry, retry, backoff,
  cancellation, timeout, dead letter, and terminal state are explicit and
  fenced.
- At-least-once delivery is not described as exactly-once business execution.
- A protected external effect has stable identity plus an idempotency or
  reliable receipt test; otherwise response loss is explicit ambiguity.
- Duplicate network delivery and a lost response after commit do not duplicate
  the business change.
- Retryable transactions cannot call Services with unsafe external effects.
- Payload/result, pending runs, active attempts, claim batch, history, retry
  horizon, dead letters, and retention are finite and fail explicitly.
- Pending runs pin exact executable bytes; incompatible readiness and bounded
  drain cannot strand work.
- Job, Reaction, and Workflow must lower to one durable transition kernel with
  capability-scoped generated projections. Job accepts explicit direct,
  Mutation, delayed, or scheduled work; Reaction exists only from one exact
  committed fact; Workflow adds closed named Mutation, Action, timer, and
  signal checkpoints.
- Schedule removal never cancels an accepted run. A Reaction has no independent
  producer or author-supplied second dedup key. A Workflow has no generic
  callback checkpoint or latest-code replay.
- Implementation evidence must directly reject a needless recovered attempt
  after cancellation, nondeterministic Workflow replay mismatch, and mutable or
  truncated append-only event history.
- Generic browser Queue, worker, lease, Reaction, Job, and Workflow controls
  stay absent. Applications expose selected controls through ordinary Policy-
  protected Query and Mutation Operations.
- Complete Workflow publication remains blocked until signal authorization,
  child work, compensation, continuation/history limits, and multi-version
  compatibility pass.

## Gate 8: Execution Envelope and Studio

- Operation, transaction, change, dispatch, run, attempt, effect, error,
  subscription, migration, log, trace, metric, and audit events use one closed
  versioned correlation schema with monotonic per-owner sequencing.
- Runtime records are append-only. The Execution Envelope is not a mutable
  aggregate record.
- Credentials, database URLs, raw payloads, Policy evidence rows, serialized
  Context, Service state, secrets, and stack traces cannot enter the envelope.
- CLI, Studio, telemetry, and tests consume canonical artifacts, Runtime state,
  receipts, and the same event contract. Missing telemetry and partial Runtime
  availability remain explicit.
- Studio application data uses normal App authority, generated Operations, and
  Policy. It has no raw SQL, internal-table CRUD, Policy bypass, second backend,
  `defineStudio`, or Operator App framework.
- `acknowledgeAmbiguity`, `cancelRun`, `drainRuntime`, and `retryRun` require
  explicit maintenance Authority, exact identity, bounded reason, idempotency,
  expected-version fencing, a typed winner, and append-only audit.

## Gate 8A: Runtime, wire, and deployment

- The generated App exposes `fetch`, `execution`, idempotent `close`, and the
  ADR-0015 compiler-owned `routes` direct-invocation projection. Routes do not
  enter the generated JSON Operation client.
- Generated clients use immutable `withContext(input)` scopes and the exact
  generated Operation Wire. Request bodies cannot construct Principal or
  Authority, and Reaction slots are not network Operations.
- Result, operation-specialized declared error, framework failure, and protocol
  rejection frames have exact generated codecs. Retryable `RESOURCE_LIMIT` and
  `RUNTIME_UNAVAILABLE` cannot collapse to `INTERNAL`.
- Mutation transport never retries automatically. Stable Call Identity is the
  only recovery key after ambiguous response loss.
- Direct, Fetch, generated-client, nested, recompute, worker, and Studio entries
  use one Context, Policy, Operation, transaction, error, result, and
  observation engine.
- Readiness stays false until bundle/schema compatibility and durable
  reconciliation pass. No root or claim enters earlier.
- Drain refuses new roots and claims, resets watches, waits bounded owned work,
  aborts remaining Executions, fences attempts, waits cleanup, disposes owned
  resources in reverse, and stops. The accepted first Runtime role is `all`;
  split roles remain blocked.
- Schema, wire, Policy/Context, realtime, executable, and internal protocol are
  separate compatibility decisions. Retained Resume Tokens and nonterminal
  Durable Runs can block artifact retirement.
- Local PostgreSQL and one managed PostgreSQL target must pass without a public
  provider SPI. P6 conformance uses managed Supabase PostgreSQL 17.6 and makes
  no RLS claim.

## Gate 8B: Service, Route, and Auth composition

- Service identity, Owner, Origin, dependencies, lifetime, and effect class are
  compiler artifacts. Instances are lazy and coalesced runtime state, never
  Context facts, durable state, or serialized artifacts.
- Application Services are isolated per Runtime instance. Execution Services
  are isolated per root and stay alive through response stream EOF, error, or
  cancellation. Drain disposes execution scopes before application Services;
  cleanup is once in reverse dependency order.
- The compiler rejects Service cycles, application-to-execution dependencies,
  transaction-safe-to-external dependencies, duplicate identities, exact Route
  mount collisions, and ambiguous path overlaps.
- Query and Mutation contexts expose no external-effect Services. Service
  creation and Route execution do not silently retry effects.
- Raw Route context exposes exact Fetch request/response control, typed params,
  Principal, deadline, cancellation, and only Route-safe Services. It exposes
  no data facade, Mutation facade, raw database, or ambient System Authority.
- `ctx.execution` is the only Route transition into ordinary application work.
  It uses the accepted Context, Policy, Operation, transaction, observation,
  and error engines.
- Fetch credential resolution and direct invocation agree after ingress.
  Direct calls require a Principal and never replay network credentials.
- Zero or one credential resolver returns resolved Principal, anonymous, or a
  typed failure. It cannot decide Policy, Tenant, or Authority. Provider outage
  cannot silently become anonymous.
- Auth Collections, schema participation, native server configuration, and
  native client remain application or ordinary Package ownership. No auth
  library owns mandatory schema, migrations, authorization, or generated
  client authority.
- The focused implementation fixture derives Route and Service artifacts from
  source and proves exact/wildcard/parameter collision behavior, relocation,
  Package isolation, direct/Fetch parity, streams, cleanup, declarations,
  completions, negative imports, and TypeScript budgets.

## Gate 8C: multi-instance and optional acceleration

- Ten compatible Runtime instances accept arbitrary Fetch/POST roots, SSE
  reconnects, reconciliation scans, scheduler ticks, and durable claims with no
  application/scheduler/queue leader, process registry, or sticky correctness.
- Real concurrent PostgreSQL sessions prove unique schedule-tick acceptance,
  `SKIP LOCKED` claims, lease recovery, stale fencing, and old/new executable
  claim/retirement compatibility.
- Instance crash loses only local roots, Services, connections, buffers, cache
  bytes, and hints. Reconciliation, resume/reset, and lease recovery derive from
  PostgreSQL durable state.
- Query-cache disclosure creates fresh Context and checks current Policy,
  authority partition, codec/build identity, observed dependency generations,
  and expiry before using bytes. Missing, stale, corrupt, slow, or unavailable
  Memory/Redis entries are misses or resets; no raw `ctx.kv` exists.
- Duplicate, coalesced, reordered, delayed, and absent notification-broker
  hints produce the same Change Ledger, durable-run, schedule, and Channel
  outcomes through PostgreSQL reconciliation.
- One bounded multiplexed SSE downstream and Fetch/POST upstream work across
  different instances. WebSocket or Pusher-compatible delivery must reuse the
  exact frame, Policy, resume, limit, and reset contract and cannot become
  event or replay authority.
- Channel codecs, publish/subscribe Policy, subject identity, stable
  idempotency, per-Channel order, bounded replay/gap, authority invalidation,
  and limits are compiler/Policy/PostgreSQL-owned. Direct provider client
  events are outside the safe contract.
- Implementation hostile tests include changed-payload Channel conflicts,
  schedule removal preventing future ticks, real-key stale/corrupt caches,
  post-write arbitrary routing, and contended old/new build claims.

## Gate 8D: File, Search, and contract projections

- File metadata is one ordinary Collection with exact Fields, Constraints,
  Relations, Policy, migration, and row types. A closed structural projection
  maps exact source Field references to byte roles; no hidden Collection,
  independent File Definition, or second schema/Policy lifecycle exists.
- Generated reserve/finalize/abort/delete Mutations, bounded upload/download
  Routes or SDK members, and durable verify/delete/orphan Jobs use the accepted
  Operation, Service, Route, durable, and Execution Envelope kernels.
- Pending metadata is never served. Stable upload/finalize identities recover
  response loss; checksummed transfer and deletion are cancellable/idempotent;
  abort and orphan cleanup survive restart. Metadata becomes nondisclosable
  before byte deletion.
- Current metadata Policy runs before byte access. Missing, denied, and missing-
  byte results are nondisclosing. The byte capability receives no Principal,
  Context, Policy, Collection, transaction, raw database, or System Authority,
  and its Route binding follows accepted Service lifetime and disposal.
- Filesystem and S3-compatible adapters pass one exact `put`/`open`/`head`/
  `delete`, stream, condition, failure, cancellation, and recovery suite. No
  provider configuration or optional-method matrix enters the public contract.
- Search document projection is deterministic and context-free. Exact committed
  source-key dispatch, idempotent update/removal, durable checkpoint, rebuild,
  crash/retry, and multi-instance contention are visible and recoverable.
- Search candidates rejoin current source rows. Tenant, Collection Policy,
  deletion, requested facets, Field output authority, totals, statistics,
  mixed-direction cursor, and `first + 1` paging share one bounded authorized
  universe. Runtime post-filter/refill and unfiltered provider results fail.
- Public Index remains B-tree-only. Any physical PostgreSQL full-text Index or
  external Search engine stops for its own focused contract and hostile matrix.
- OpenAPI, MCP, and skill outputs derive from exact App Contract members,
  Origins, codecs, exposure, errors, limits, and wire versions. Unsupported
  members emit Origin diagnostics; generated MCP invocation reuses the accepted
  Operation adapter; a skill grants no Runtime authority.
- Projection artifacts pin exact source digests and reject collision, stale,
  unsupported, or inconsistent exposure. Their telemetry uses the Execution
  Envelope and never exposes secrets, raw payloads, Policy evidence, serialized
  Context, Service state, or database URLs.

## Gate 8E: semantic kernels and exports

- Input, output, Context, durable, and Channel values use one `codec.*` scalar
  kernel. `field.*` adds database-only capabilities and `value.*` is a
  compatible embedded-JSONB projection; Operation owns no duplicate scalar
  grammar.
- Query disclosure reads and boolean-only Policy evidence are restricted
  projections of one relational planner. Neither may acquire the other's
  return or authority behavior.
- Job, Reaction, and Workflow lower to one durable kernel while retaining exact
  distinct causes and contexts. Workflow checkpoint commands remain closed.
- `defineRoute` authors the Resource and generated `app.fetch` mounts it. There
  is no `defineFetch`; raw Route ingress has no data facade and uses an explicit
  `ctx.execution` transition.
- Stable structural exports come from `questpie`; seven kind-specific generated
  factories come from `#questpie/app` and isolated `#questpie/package`;
  `#questpie/client` exports no server factory. Negative imports, exact
  completions, Package isolation, relocation, emitted declarations, no ambient
  registry, and TypeScript budgets pass.
- `defineChannel` owns typed event authoring. Live Query has no constructor and
  gains `.watch` only from compiler-proven Query watchability.
- OpenAPI/MCP/skill selection lives under `questpie.json` `projections`; build
  emits artifacts and `questpie explain projection` reports provenance. No
  authoring factory or alternate handler registry exists.
- `runtime.cache`, `runtime.wakeBroker`, `runtime.channelCarrier`, and
  `runtime.byteStore` bind distinct exact Services. They do not form a provider
  registry, appear as an ambient handler capability bag, carry secrets in
  committed config, or change PostgreSQL authority/fallback semantics.

## Gate 9: executable tracer evidence

- The Barbershop slice passes direct, network-client, and minimal-Studio tests.
- A crash after commit and before wake loses no Reaction or Live Query refresh.
- The same Definitions pass on local PostgreSQL and one managed Supabase
  PostgreSQL project.
- Type, codegen, migration, cold-start, operation, and invalidation budgets pass.
- Execution duration, rows, bytes, dependencies, subscriptions, retained
  checkpoints, fanout, and per-Principal concurrency limits fail explicitly.
- `git diff --check` and the smallest relevant package checks pass.
- Inherited P4 retention/wrap evidence runs in the exact proof-owned PostgreSQL
  cluster. Pruning while an unrelated snapshot remains open retains the fact;
  after it closes and all consumers reconcile the fact prunes; the matching
  no-snapshot control also prunes. Sequence wrap remains independent of fact
  order.
- CLI and Studio derive canonical explanation bytes through separate source
  producers and independent joins. Neither may call the other or manufacture
  parity with a JSON round trip.
- The connected tracer executes Migration Plan creation, immutable checksum,
  transactional apply plus receipt, lost-response retry, tamper refusal, and
  Drift detection and repair.
- One exact Owner-accepted Package Augmentation passes through Package
  Inventory, Manifest/App Contract, Schema Projection, reviewed migration,
  matched Runtime Build, direct Query, generated exact type, and editor
  completion. Installed-only, active-but-unaccepted, and wrong-inventory cases
  remain inert or refuse readiness.

## Gate 10: repository foundation and slice-owned quality

- Bun 1.3.14 and exact canonical TypeScript 6.0.2 are executable repository
  authority. Native TypeScript 7.0.2 runs only as the non-blocking forward lane.
- Each implementation issue names one red test and smallest workspace
  typecheck for `bun run check:changed`; ordinary red-green work targets
  seconds and excludes PostgreSQL concurrency, managed-provider, load, and soak.
- `bun run quality:full` owns cached repository correctness. PostgreSQL 17 is a
  parallel required CI job. `bun run quality:release` adds stable Knip,
  performance-manifest, package export, declaration, and artifact checks.
- Knip noisy classes begin report-only. New unlisted dependencies/binaries and
  unresolved imports are blocking; the negative control must keep proving the
  gate itself fails.
- Correctness, microbenchmarks, load, and soak/chaos remain separate evidence.
  The repository owns the harness. Each accepted implementation slice owns its
  scenario budgets and adds them when the behavior exists.
- Selected-PR micro cases must be quick and stable. Multi-instance HA, fanout,
  durable-worker, rolling-deployment, and optional-infrastructure loss run
  nightly/manually. Crash/leak/retention matrices remain outside ordinary PRs.
- GitHub-hosted timing reports small movement and blocks only clear repeated
  regression. Strict release budgets require stable tagged runners.
- Agents start from root AGENTS and the repo-owned router skill. Proof
  acceptance uses a clean committed head and the repository wrapper; only an
  explicit fresh stateless Opus-medium PASS permits authority projection.

## Stop conditions

Stop and revise the contract when:

- a new public abstraction has no tracer guarantee;
- a first-party implementation needs downstream private authority;
- runtime state or import order changes composition;
- the App Contract needs fallback `any`, broad `string`, or ORM types;
- development and production use different migration planners;
- Studio reconstructs state from private log text;
- a deferred product area starts before its dependency gates pass.
