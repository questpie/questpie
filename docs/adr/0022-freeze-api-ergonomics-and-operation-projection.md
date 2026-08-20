# ADR 0022: Freeze API Ergonomics and Operation Projection

> The distinct Workflow authoring clause is historical and superseded by
> [ADR-0026](./0026-freeze-action-and-unify-checkpointed-work-in-job.md).
> Checkpointed orchestration is a closed projection of Job.

- Status: Accepted; Workflow clause superseded by ADR-0026
- Date: 2026-08-14

## Context

The beta.1 compiler fixed named structural and executable factories, exact
Resource Identity, and generated server Operation maps. Before BETA-02 expands
the executable surface, the public spelling must avoid aliases in mixed files,
preserve canonical identity, and remain safe when dotted Operation names become
nested callable members.

## Decision

- QUESTPIE keeps named `defineKind` factories. Stable structural factories come
  from `"questpie"`; application- and Package-specialized executable factories
  come from their generated contracts. A `define.*` namespace would require an
  alias, an ambient registry, a generated bootstrap dependency, or a universal
  builder that exposes invalid combinations.
- Canonical Resource Identity remains the exact
  `<kind>:<qualified-name>` key used by manifests, App Contract identity maps,
  receipts, references, CLI, Studio, and external projections.
- Generated server Operation capability maps are nested-only. For example,
  `action:delivery.sendMessage` is called as
  `ctx.actions.delivery.sendMessage`. Direct client/App maps retain their
  accepted exact-key spelling.
- The compiler reports `QP-COMPOSE-023 operationProjectionCollision` before
  declaration emission when one Operation kind contains both a callable leaf
  and its namespace descendant. The diagnostic contains both sorted Origins.
  Equal names in different Operation kinds remain valid.
- The compiler reports `QP-COMPOSE-024 operationProjectionUnsafeName` when an
  Operation's final segment is `then`. This prevents a callable namespace from
  becoming Promise-like. A non-final `then` segment and non-Operation Resources
  named `then` remain valid.
- Generated server capability maps are frozen null-prototype objects. Valid
  `constructor` and `prototype` segments are ordinary own members.
- Job, Reaction, and Workflow remain distinct public authoring meanings over
  one internal durable run/attempt/lease/history kernel. The permanent
  capability map, not the v3 hook vocabulary, guides work ownership.

## Consequences

- Server handlers use ergonomic nested calls without changing durable or
  protocol identity.
- A same-kind leaf/prefix pair cannot compile, while cross-kind equality and
  exact external identity maps remain representable.
- Structural and executable imports stay explicit and compiler bootstrap stays
  acyclic. There is no ambient registry or universal Definition builder.
- Null-prototype namespaces do not inherit object helpers; application code
  treats them as generated capability maps rather than general objects.

## Rejected alternatives

- `define.*` or another universal namespace spanning stable and generated
  factories.
- A second flat server call alias beside the nested projection.
- Changing Resource Identity to path segments.
- Reserving every `then` segment or rejecting prefix pairs outside one
  Operation kind map.
- Separate Job, Reaction, and Workflow execution kernels or a restored general
  lifecycle hook catalogue.
