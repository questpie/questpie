# ADR 0014: Freeze Runtime, Client, Execution Envelope, and Minimal Studio

- Status: Accepted
- Date: 2026-08-13

## Context

The accepted compiler, Context, Policy, Operation, Live Query, Change Ledger,
and Reaction contracts need one deployment and execution boundary. Without a
fixed boundary, direct calls, Fetch, generated clients, workers, recomputation,
and Studio could construct different authority, errors, lifecycle, or state.

## Decision

QUESTPIE accepts one generated standalone Runtime contract for the connected
tracer.

- `questpie build` publishes one checksum-verified immutable Runtime bundle.
  The bundle binds the exact Application Identity, Manifest, App Contract,
  Runtime Build, executable slots, Origin Map, schema binding, migration head,
  Change Ledger, durable compatibility, generated declarations, and wire
  contract. Publication replaces one verified complete-directory pointer.
- Reviewed migration apply remains explicit. `questpie start` verifies the
  bundle, Runtime ABI, Application Identity, migration head, schema
  fingerprint, and registered internal protocol before it accepts a root or
  worker claim. Startup never discovers or merges source Definitions.
- The generated `createApp()` exposes `fetch`, `execution`, and idempotent
  `close`. ADR-0015 later adds the compiler-owned `routes` direct-invocation
  projection; it does not change these three members. Generated clients create
  immutable `withContext(input)` scopes.
  Fetch credentials resolve outside the request body and construct one fresh
  ordinary root Execution.
- Direct, Fetch, generated-client, nested, recompute, worker, and Studio entry
  paths use the same Context, Policy, Operation, transaction, error, result,
  and observation engine. A network body cannot construct Authority or expose
  a Reaction.
- The versioned operation wire binds application, client contract, wire
  digest, operation, call identity, Context input, input, and timeout. Result,
  operation-specialized declared error, framework failure, and protocol
  rejection are closed frames. Mutation transport does not retry
  automatically.
- Runtime readiness stays false until verification and durable reconciliation
  finish. Drain refuses new roots and claims, closes watches with a retryable
  reset, waits bounded owned work, aborts remaining Executions, fences durable
  attempts, disposes resources in reverse order, and stops. `close` is
  idempotent. The accepted first contract runs the combined `all` role only.
- Deployment compatibility is decided separately for schema, wire,
  Policy/Context, realtime resume, executable bytes, and internal protocol.
  Retained Resume Tokens and nonterminal Durable Runs can block retirement.
- One closed Execution Envelope correlates safe append-only Runtime events.
  Credentials, database URLs, raw payloads, relational Policy evidence,
  serialized Context, Service state, secrets, and stack traces are excluded.
- Studio reads application data through ordinary generated Operations and
  Policy. `questpie explain` and Studio use canonical artifacts, Runtime state,
  receipts, and events. The accepted maintenance commands are narrow,
  explicitly authorized, idempotent, expected-version fenced, and audited.
- Local PostgreSQL and a managed Supabase PostgreSQL project are conformance
  targets. This evidence creates no public provider SPI. P6 adds only B-tree
  indexes and makes no RLS claim.

## Consequences

- Applications do not author a server entrypoint, worker entrypoint,
  `defineRuntime`, host adapter, provider adapter, handler registry, or private
  Studio backend.
- A corrupt, stale, cross-application, schema-incompatible, or executable-
  incompatible bundle fails before traffic. Runtime startup does not apply
  migrations automatically.
- A client can distinguish retryable availability and resource limits from
  declared application errors and internal failures. Stable call identity
  recovers a committed Mutation result after response loss.
- Split API/worker roles, host/provider SPIs, remote or fleet Studio, complete
  migration execution, Package Augmentation through Runtime, Action, Files,
  Search, Job, and Workflow remain separate gated verticals. ADR-0015 accepts
  Service, Route, and Auth composition as the next focused vertical.

## Rejected alternatives

- Runtime source discovery, Module/plugin merge, authored entrypoints, or a
  public host/provider SPI before a second concrete implementation.
- One coarse deployment digest as the only compatibility decision.
- A separate direct engine, client backdoor, Studio database path, raw SQL
  console, ambient Admin/System authority, or network-exposed Reaction.
- Mutable execution mega-rows, arbitrary JSON logs, secret-bearing telemetry,
  or reconstructing operational truth from log text.
- Automatic Mutation retry after response loss, automatic migration apply at
  startup, or a database RLS claim without its complete hostile matrix.
