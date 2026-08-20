# Choose the owner of application work

Start from the guarantee the work needs, not from a lifecycle phase name.

| Work                                           | Owner       | Boundary                                                                |
| ---------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| Canonicalize caller input without I/O          | `normalize` | Closed pure program inside the owning Operation lifecycle               |
| Supply a trusted server value                  | `values`    | Closed assignment from input or immutable Execution facts               |
| Read or derive an authorized result            | Query       | One Policy-aware read snapshot                                          |
| Decide whether a principal may perform work    | Policy      | Pure authorization decision over explicit subject, resource, and facts  |
| Validate application state or write atomically | Mutation    | One PostgreSQL transaction, including audit and durable acceptance      |
| Call an external or nondeterministic provider  | Action      | Explicit effect outside transaction retry                               |
| Adapt an HTTP request and response             | Route       | Transport boundary that delegates state and effects to Operations       |
| React to one exact committed fact              | Reaction    | Durable committed-fact causation with no independent producer           |
| Accept explicitly requested background work    | Job         | Durable dispatch with scoped idempotency and optional delay or schedule |
| Coordinate checkpointed multi-step work        | Job         | Durable named Mutation/Action steps, timers, and typed signals          |
| Observe a changing authorized read             | Live Query  | Re-evaluated Query result driven by committed invalidation              |

Reaction and Job are distinct authoring meanings over one internal run,
attempt, lease, retry, cancellation, result, retention, and history kernel.
Checkpointed work remains Job. No owner grants another owner's capability
implicitly.

Query and Live Query are not separate read kernels: watchability is a generated
projection of a supported Query. Ephemeral connected-client messages are
ordinary application/provider integration, not framework-owned work. Route
owns protocol adaptation (and the closed file-byte capability where declared),
not reads or writes. Policy decides authority but cannot return protected rows.
