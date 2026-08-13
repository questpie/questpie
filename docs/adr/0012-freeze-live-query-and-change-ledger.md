# ADR 0012: Freeze Live Query and Change Ledger

- Status: Accepted
- Date: 2026-08-13

## Context

QUESTPIE needs realtime Query results without a second authorization path,
client-authored invalidation lists, or a wake mechanism that can lose a
committed change. A trigger-time sequence, timestamp, or transaction identifier
cannot be treated as a commit frontier because overlapping transactions can
commit in the opposite order.

## Decision

QUESTPIE keeps one ordinary generated Query method and adds `.watch` only when
the compiler can prove a closed watchable contract.

- One-shot calls preserve the exact P3 input, output, and optional
  `OperationCallOptions`. `.watch(input, callback, options)` uses the same input
  and complete output type.
- Deliveries are complete `initial`, `update`, or `reset` Query results. They
  are not row patches or Change Ledger events.
- The compiler declares supported watchability. The Runtime observes the
  supported Collection, structural Query, Context bootstrap, Policy evidence,
  Tenant, Relation, miss, empty-range, ordering, page-boundary, and sentinel
  reads that execution actually reaches.
- Each successful recomputation replaces the previous dependency plan. A
  failed or unauthorized recomputation preserves the last successful plan and
  publishes no result.
- Every recomputation creates a fresh root Execution and reevaluates Context
  and Policy before disclosure. An earlier socket or Policy decision is not
  authority for a later payload.
- Compiler-owned PostgreSQL triggers append bounded Change Ledger facts in the
  business transaction. `LISTEN`/`NOTIFY` is a lossy wake hint only.
- Reconciliation persists an exclusive PostgreSQL `xid8` visibility horizon.
  It processes visible facts below the next snapshot horizon and atomically
  advances each consumer frontier with its processed effects. Fact identity,
  timestamp, trigger XID, or maximum sequence value is not the frontier.
- Generated clients manage authenticated opaque resume tokens. A token is
  bound to deployment, Query and normalized input, authority partition, wire
  version, and retained generation. Unavailable or incompatible state yields a
  fresh authorized reset.
- Active watches, dependencies, result and buffer bytes, fanout, ledger lag,
  retained tokens, and retention age are finite. Hot changes may coalesce and
  slow consumers may reset or disconnect before buffers grow without bound.
- Independent watched Queries converge independently. This decision does not
  promise atomic publication across several Query Resources or persistent
  offline resume.
- Supported raw DML, cascades, managed external writers, `COPY`, `MERGE`,
  `ON CONFLICT`, and `TRUNCATE` use the same capture boundary. Partitioned
  reactive Collections fail schema validation in this contract.

## Consequences

- Application authors define one Query and use the same generated method for a
  current result or a Live Query.
- PostgreSQL durability, not a socket or notification queue, owns recovery.
- The Change Ledger contains invalidation evidence, never authorized client
  output.
- Managed writers cannot read or forge ledger/reconciliation state, disable
  capture, or assume replication or superuser authority. Actual superuser,
  replication bypass, dropped triggers, and uninstrumented tables remain
  trusted deployment boundaries and conformance failures, not protected
  application paths.
- The accepted foundational Index authoring contract remains B-tree-only. P4
  emits no RLS and makes no database-enforced authorization claim.
- P5 still owns Transactional Dispatch acceptance, Reaction delivery, attempts,
  leases, fencing, retry, cancellation, retention, and external-effect
  ambiguity. P6 owns production Runtime/Fetch framing and Studio protocol.

## Rejected alternatives

- A second realtime handler, client-authored database query, channel name, or
  manual invalidation list.
- Static call-site dependencies without Runtime observation.
- Historical-union dependency accumulation.
- Reusing historic Context or Policy authority on recomputation.
- Treating `LISTEN`/`NOTIFY`, a sequence, timestamp, XID, or ledger row maximum
  as a durable commit frontier.
- Sending row changes or Change Ledger facts as authorized Query results.
- Silent unlimited subscriptions, dependencies, fanout, retained state, lag,
  or buffers.
- Claiming atomic multi-Query publication, persistent offline resume, broad raw
  SQL read dependencies, non-B-tree Index authoring, or PostgreSQL RLS from the
  P4 proof.
