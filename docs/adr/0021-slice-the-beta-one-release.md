# ADR 0021: Slice the beta.1 release

> Workflow-specific forward clauses in this record are historical and
> superseded by
> [ADR-0026](./0026-freeze-action-and-unify-checkpointed-work-in-job.md).
> Their closed checkpoint semantics remain current as Job; `defineWorkflow`
> and a separate Workflow Resource are not current or deferred public surface.

> Partially superseded by [ADR-0024](./0024-descope-minimal-studio-from-beta-one.md)
> for the minimal Studio path and Studio parity in beta.1.
>
> The future Channel seam in the accepted P15 artifact is historical and
> superseded by [ADR-0025](./0025-remove-channels-from-core.md). Channels are
> removed from QUESTPIE rather than deferred beyond beta.1.

- Status: Accepted
- Date: 2026-08-14

## Context

The accepted ideal contract is broader than one safe first release. A CRUD-only
preview would be quick but would not test the transaction, observation,
durability, Runtime, or Studio seams that make QUESTPIE one product. Shipping
all accepted capability breadth would make the first implementation wave too
large.

## Decision

`4.0.0-beta.1` was accepted here with a minimal Studio path. ADR-0024 removes
that path from the release while preserving the compiler, migration, Runtime,
direct, Fetch/client, watch, recovery and worker vertical.

The dependency-ordered release slices are foundation, schema, Services,
Context/Policy, Operations, Runtime/client, realtime, one committed-fact
Reaction, backend maintenance compatibility, and connected conformance.
Service lifetime precedes Context disposal. The Runtime and durable slices also own the accepted
maintenance Authority, expected-version fencing, typed concurrent winner,
append-only audit, drain, and compatibility-retirement seams.

The complete machine-checked scope is
[`beta-slice-p15/SLICE.json`](../v4/prototypes/beta-slice-p15/SLICE.json).
Action, raw Route and credential Auth integration, generic Job and Workflow
breadth, File bytes, Search, OpenAPI/MCP/skill output, optional cache/broker,
split Runtime roles, and remote Studio are absent from beta.1. Each retains the
named compatible seam in that artifact. Its Channel and carrier seams do not:
ADR-0025 removes them from the product. PostgreSQL remains the only durable
dependency, Index remains B-tree-only, and this release makes no RLS claim.

The collaboration/publishing fixture is the primary connected tracer. The
archive/permit/embargo fixture proves portability. Release evidence includes
local and one selected managed PostgreSQL target, exact generated declarations,
direct/network/worker parity, crash and response-loss recovery, ten-
instance compatibility evidence, optional-infrastructure absence, and slice-
owned quality/performance budgets.

## Consequences

- Beta.1 is not a temporary public architecture or a complete ideal-product
  implementation.
- Deferred capabilities are documented as exact absences rather than half-
  implemented runtime switches.
- Source compatibility with v3 is not promised. Data, behavior, wire, and
  durable compatibility are explicit, versioned release decisions.
- Production work begins only from the accepted build specification and
  dependency-ordered issues produced by atlas ticket #16.

## Rejected alternatives

- A compiler-only or CRUD-only preview.
- Pulling every accepted later capability into beta.1.
- Deferring a capability without preserving its owner and compatible seam.
- Optional infrastructure as durable authority or a provider matrix.
