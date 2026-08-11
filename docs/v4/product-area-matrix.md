# QUESTPIE v4 Product Area Matrix and Port Checklist

- Status: Canonical scope projection from `SPEC.md`
- Date: 2026-08-10
- Audience: maintainers and contributors

`Capability` is an inventory label in this document. It is not a public
composition primitive. Concrete Definitions and explicit references form the
application.

## Current tracer

| Product area           | Required proof                                                         | Port from v3                                  | Status    |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------- | --------- |
| Static compiler        | Identity, Owner, Origin, Augmentation, deterministic Compiled Manifest | Generated layer DAG and collision failures    | Specified |
| TypeScript             | Concrete App Contract with no ORM types                                | Published-consumer and type-budget gates      | Tracer    |
| PostgreSQL data        | Field, Collection, Relation, Constraint, bounded Query grammar         | Data behavior tests, not Drizzle public types | Tracer    |
| Schema lifecycle       | Canonical plan, transactional migration, receipt, fingerprint, drift   | Migration failure cases                       | Specified |
| Seeds                  | Immutable identity, dependencies, atomic receipt, run history          | Selected deterministic fixtures               | Specified |
| Context                | Principal, Tenant, Authority, cancellation, trace                      | Request-scope behavior tests                  | Tracer    |
| Policy                 | Typed filter, SQL pushdown, fail-closed execution                      | Access and field-output tests                 | Tracer    |
| Operations             | Query, Mutation, Action, Route, declared errors                        | Route use cases and transaction tests         | Tracer    |
| Transactional Dispatch | Atomic business write plus durable intent                              | Queue dispatch table and recovery tests       | Tracer    |
| Change Ledger          | Durable commit record and lossy wake                                   | Outbox, cursor, reconciliation, txid tests    | Tracer    |
| Live Query             | Observed supported reads and recomputed result                         | Refresh, replay, auth fence, reconnect tests  | Tracer    |
| Generated client       | Exact server and browser contract                                      | Client and TanStack Query use cases           | Tracer    |
| Execution Envelope     | Shared IDs for operation, transaction, dispatch, attempt, trace        | Existing observer and telemetry lessons       | Tracer    |
| Minimal Studio         | Origins, migrations, operations, dispatch, realtime, logs              | Selected diagnostic UI components             | Tracer    |

## Later slices

| Product area     | Dependency before grill                     | Intended role                               | Status              |
| ---------------- | ------------------------------------------- | ------------------------------------------- | ------------------- |
| Jobs             | Transactional Dispatch and lease proof      | Durable background execution                | Next slice          |
| Durable Workflow | Jobs, timers, signals, idempotency, history | Persisted orchestration on the same Runtime | Later               |
| Auth             | Principal and Policy proof                  | Resolve credentials into Principal          | Later               |
| Files            | Data lifecycle and blob seam                | File records plus external bytes            | Later               |
| Search           | Stable query grammar                        | PostgreSQL FTS and vector operations        | Later               |
| KV               | Proven internal need                        | Named coordination or application data      | Re-evaluate         |
| Channels         | Live Query transport proof                  | Explicit transient events and presence      | Later               |
| OpenAPI          | Stable operation exposure and schemas       | Projection of explicit Operations           | Later               |
| MCP              | Stable exposure, Policy, and error contract | Projection of explicit Operations           | Later               |
| Full Studio      | Stable Jobs, Workflows, Auth, and Files     | Operational projection of later slices      | Later               |
| Managed Cloud    | External production proof                   | Semantic deployment control plane           | Business validation |

## V3 evidence inventory

Port behavior and tests for:

- transactions, constraints, relations, localization, and bulk atomicity;
- policy failure and output filtering;
- legacy v3 outbox, replay, authorization fences, reconciliation, and topology
  tests;
- Queue intent, idempotency, leases, retries, and terminal states;
- generated import direction and built declaration consumption;
- TypeScript, package, bundle, `any`, clone, dead-module, export, and audit
  budgets.

Do not port:

- Modules, runtime merge, last-wins, or implicit application overrides;
- open codegen categories, builder grammar extensions, or global registries;
- recursive builder-state inference or public Drizzle types;
- Admin backend extensions or Operator App composition;
- host adapter and provider matrices;
- Better Auth plugin internals as a compiler protocol.

## Tracer completion

- [ ] One owned `appointments` Collection compiles.
- [ ] One external Package applies an authorized Augmentation.
- [ ] Migration create, apply, checksum, and drift pass.
- [ ] One idempotent Seed is visible in CLI and minimal Studio.
- [ ] One Policy uses Principal, Tenant, and a Relation.
- [ ] One paginated Query produces exact client types.
- [ ] One Mutation commits data, Change Ledger, and dispatch intent atomically.
- [ ] One Live Query recomputes after commit.
- [ ] Crash before wake loses no refresh or Reaction.
- [ ] Minimal Studio correlates operation, transaction, dispatch, and refresh.
- [ ] Public declarations contain no ORM types.
- [ ] Type and runtime budgets pass.
- [ ] Local and managed Supabase PostgreSQL pass the same conformance test.
- [ ] Raw SQL, cascades, and external PostgreSQL writes enter reconciliation.
- [ ] Duplicate Mutation delivery does not duplicate the business change.
- [ ] Execution and subscription limits fail with explicit diagnostics.
