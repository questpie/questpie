# QUESTPIE v4 implementation gates

These gates apply to every implementation slice. The first authorized slice is
the Barbershop tracer in `SPEC.md`.

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
- Generated value and emit layers form a downward-only acyclic graph. An erased
  type-only source edge to the current virtual App Contract is the only upward
  edge; generated values cannot import back through it.

## Gate 3: TypeScript contract

- Leaf Definitions infer local input and output without application-wide
  recursive types.
- The generated App Contract uses exact keys, context, input, output, exposure,
  and declared errors.
- Public declarations contain no ORM type identity, broad `string`, `any`, or
  ambient fallback registry.
- TypeScript instantiations stay inside the committed tracer budget.

## Gate 4: schema lifecycle

- Compiled Manifest, Committed Migration chain, and actual Schema Fingerprint
  remain distinct.
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

## Gate 5: transaction and authorization

- Mutation owns one PostgreSQL transaction.
- Business data, Change Ledger rows, and Transactional Dispatch intent commit
  atomically.
- Principal, Tenant, and Authority are immutable for one Execution.
- Policy fails closed and constrains direct execution, network clients, and
  Studio equally.
- Privileged raw database behavior is explicit and tested.

## Gate 6: realtime correctness

- Live Query dependencies come from supported reads that the handler actually
  executes. Recompute replaces the dependency set.
- Policy, tenant, Relation, and pagination reads participate in invalidation.
- A lossy wake cannot lose a committed refresh because the Change Ledger is
  durable.
- Crash, reconnect, duplicate wake, replay gap, and slow-client cases have
  behavior tests.
- External PostgreSQL writes have an explicit capture contract.
- Raw SQL without an explicit dependency token is not reactive.
- Independent Live Queries converge independently until a cross-Query
  checkpoint contract is accepted.

## Gate 7: durable execution

- Every dispatch has stable causation and idempotency identity.
- Lease expiry, retry, backoff, cancellation, timeout, and terminal state are
  explicit.
- At-least-once delivery is not described as exactly-once business execution.
- A protected external effect has an idempotency or compensation test.
- Duplicate network delivery and a lost response after commit do not duplicate
  the business change.
- Retryable transactions cannot call Services with unsafe external effects.

## Gate 8: Execution Envelope and Studio

- Operation, transaction, change, dispatch, attempt, error, log, trace, and
  audit events use one versioned correlation schema.
- Runtime records are append-only. The Execution Envelope is not a mutable
  aggregate record.
- CLI, Studio, telemetry, and tests consume the same contract.
- Studio uses normal App authority and generated operations.
- Secret values and sensitive Principal data do not enter diagnostics.

## Gate 9: executable tracer evidence

- The Barbershop slice passes direct, network-client, and minimal-Studio tests.
- A crash after commit and before wake loses no Reaction or Live Query refresh.
- The same Definitions pass on local PostgreSQL and one managed Supabase
  PostgreSQL project.
- Type, codegen, migration, cold-start, operation, and invalidation budgets pass.
- Execution duration, rows, bytes, dependencies, subscriptions, retained
  checkpoints, fanout, and per-Principal concurrency limits fail explicitly.
- `git diff --check` and the smallest relevant package checks pass.

## Stop conditions

Stop and revise the contract when:

- a new public abstraction has no tracer guarantee;
- a first-party implementation needs downstream private authority;
- runtime state or import order changes composition;
- the App Contract needs fallback `any`, broad `string`, or ORM types;
- development and production use different migration planners;
- Studio reconstructs state from private log text;
- a deferred product area starts before its dependency gates pass.
