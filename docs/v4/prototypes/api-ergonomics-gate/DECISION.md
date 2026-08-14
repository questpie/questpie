# API ergonomics gate decision

## Selected outcomes

- Keep named `defineKind` factories. A stable structural `define` and a
  generated executable `define` require aliases in a mixed file. Combining
  them makes structural construction depend on generated application output,
  violating the compiler bootstrap boundary.
- Keep exact `<kind>:<qualified-name>` Resource Identity in manifests,
  receipts, references, CLI, and Studio.
- Generate nested-only Operation call projections by splitting the Qualified
  Resource Name at dots. `delivery.sendMessage` becomes
  `ctx.actions.delivery.sendMessage`.
- Reject a leaf/prefix pair within one Operation kind with
  `QP-COMPOSE-023 operationProjectionCollision` and both sorted Origins.
  Identical names in different Operation kinds remain valid because their
  capability maps are separate.
- Materialize generated runtime maps as frozen null-prototype objects so valid
  `constructor` and `prototype` segments are ordinary own members.
- Preserve one durable kernel with separate Job, Reaction, and Workflow
  authoring meanings.
- Teach work ownership through the permanent v4 capability map. Legacy hook
  vocabulary remains historical evidence rather than public navigation.

## Fixed absences

There is no second flat public call surface, universal Definition builder,
ambient registry, general lifecycle hook catalogue, second durable kernel, or
change to canonical Resource Identity.
