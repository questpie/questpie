# ADR 0003: Make Studio the operational application surface

- Status: Accepted
- Date: 2026-08-10

## Context

V3 Admin mixed schema inspection, CRUD, CMS presentation, custom Operator App
composition, auth assumptions, and backend builder extensions. Most real
Operator Apps still required a separate product interface.

The standalone Runtime owns application semantics that a generic PostgreSQL
console cannot explain: resolved ownership, Policy decisions, transaction and
dispatch causation, Live Query recomputation, Job attempts, Workflow history,
and migration compatibility.

## Decision

The optional official interface is Studio.

Studio inspects one compiled application and operates it through public
application contracts. It shows the Compiled Manifest, Origin Map, migrations,
Drift, Seeds, Operations, Policies, transactions, dispatch, Queues, Jobs, Workflows,
realtime state, logs, traces, metrics, and audit history.

The Runtime emits append-only events with one stable Execution Envelope
correlation schema. Studio, CLI, OpenTelemetry, tests, and a future Cloud
consume this event family.

Studio is not a CMS, SQL console, database hosting dashboard, page builder, or
Operator App framework. Application-specific Operator Apps live in userland and
use the same generated client.

## Consequences

- The backend has no Admin-specific builder or private CRUD architecture.
- Observability is a Runtime contract rather than a UI afterthought.
- Existing v3 UI components can be reused only after they consume the new
  public App Contract.
- Workflow and Queue inspection fit Studio after their shared durable spine is
  proven.

## Rejected alternatives

- Port the v3 Admin extension system.
- Remove all official inspection and operational UI.
- Clone Supabase Studio as a general database console.
