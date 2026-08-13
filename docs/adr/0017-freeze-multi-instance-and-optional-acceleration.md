# ADR 0017: Freeze Multi-Instance Correctness and Optional Acceleration

- Status: Accepted
- Date: 2026-08-13

## Context

The accepted Runtime, Live Query, and durable contracts must remain correct
when ten compatible Runtime instances accept arbitrary requests, reconnects,
scheduler ticks, and worker claims. Process-local ownership, sticky routing, or
mandatory Redis/broker coordination would turn rolling deployment and instance
failure into new authority protocols. Optional infrastructure may improve
latency, but PostgreSQL must remain the only hard durable dependency and source
of truth.

## Decision

QUESTPIE makes multi-instance operation a default correctness invariant.

- Every compatible `all`-role Runtime instance may accept Fetch, direct roots,
  generated-client POSTs, Live Query reconnects, Channel bindings, Studio
  reads, reconciliation scans, scheduler ticks, and durable claims. There is no
  application, scheduler, queue, or realtime leader and no process registry or
  sticky-session correctness.
- PostgreSQL unique identities and fenced compare-and-set transitions decide
  Mutation replay, schedule-tick acceptance, reconciliation frontiers, Channel
  event order, durable claims, retry, cancellation, and terminal state.
  Application Services remain per Runtime, Execution Services per root, and
  connection buffers per connection.
- A crashed instance may lose local Services, connections, buffers, caches, and
  wake hints. Expired leases are reclaimed; clients reconnect to any compatible
  instance and either resume from PostgreSQL-bound state or receive a freshly
  authorized reset.
- Rolling deployment uses separate schema, wire, Policy/Context, realtime,
  executable, and internal-protocol compatibility decisions. An instance
  claims only work whose pinned executable bytes it carries. Retained Resume
  Tokens and nonterminal Durable Runs may block old-build retirement.
- Query cache is a compiler/Runtime optimization, not raw application KV. A
  cache entry binds application/build, Query, canonical input, output codec,
  authority partition, observed dependency generations, and finite expiry.
  Fresh Context and Policy run before disclosure. Missing, stale, corrupt,
  timed-out, or unavailable entries are misses or resets; a handler cannot
  observe the backend or branch on a hit.
- Process Memory and Redis/KV may implement the narrow Query-byte-store
  capability. They own neither invalidation nor authorization. A raw `ctx.kv`
  is not accepted.
- PostgreSQL `NOTIFY`, Redis pub/sub, or another notification broker may carry
  bounded possible-progress hints. Duplicate, reordered, delayed, coalesced,
  or absent wakes have no semantic effect because startup and reconnect
  reconcile PostgreSQL durable state.
- The v1 realtime transport is one bounded multiplexed SSE downstream per
  client scope plus Fetch/POST upstream. A connection is local and disposable;
  its next upstream request or reconnect may reach another compatible instance.
- Channel is a distinct compiler Resource with exact event codecs, subscribe
  and publish Policy, resolved-subject identity, per-Channel order, bounded
  replay/gap semantics, authority invalidation, and limits. Accepted event
  identity, order, replay, and generation live in PostgreSQL. Every subscribe,
  reconnect, and authority invalidation creates fresh authorization work.
- A later WebSocket or Pusher-compatible carrier must reuse the exact frame,
  resume, Policy, limit, and reset contract. It cannot mint events, decide
  Policy, or become replay truth, and it does not create a provider matrix.

## Consequences

- Cache hit/miss, broker health, instance routing, or connection ownership
  cannot change application results, Context, Policy, Live Query, durable
  execution, or Channel authority.
- Direct, Fetch/POST, worker, recompute, and Studio paths remain adapters to the
  same accepted Context, Policy, Operation, transaction, and observation
  engines.
- The Execution Envelope, health/readiness, CLI, and Studio expose safe cache
  status, wake lag, connection/reset reason, scheduler contention, claims,
  executable compatibility, and Channel replay state without leaking secrets
  or promoting telemetry to authority.
- WebSocket, Pusher-compatible delivery, cross-Query atomic publication,
  persistent offline replay, global presence, and partitioned reactive
  Collections remain later measured contracts.
- Ticket #20 owns byte storage and Search. Ticket #21 owns final public naming.
  Ticket #22 owns nightly/manual HA, fanout, rolling-deployment, worker, and
  optional-infrastructure load architecture.
- The implementation proof must directly exercise changed-payload Channel
  idempotency conflicts, schedule removal preventing future ticks, stale and
  corrupt real cache keys, post-write arbitrary routing, and contended old/new
  executable claims.

## Rejected alternatives

- Sticky connection or request affinity as a correctness requirement.
- A singleton application, scheduler, queue, or realtime leader.
- Mandatory Redis, broker, Pusher, or cache state as durable truth.
- Raw application KV or broker access that can create a second business or
  authorization path.
- Provider-specific Channel semantics or direct provider client events in the
  safe contract.
- A universal infrastructure builder that exposes invalid combinations.
