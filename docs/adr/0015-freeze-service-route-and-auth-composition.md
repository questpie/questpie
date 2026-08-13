# ADR 0015: Freeze Service, Route, and Auth Composition

- Status: Accepted
- Date: 2026-08-13

## Context

The accepted Runtime can execute generated Operations, but integrations also
need owned dependencies, exact Fetch requests and responses, and credential
resolution. V3 provided useful service, route, and Auth jobs through mutable
registries, middleware ordering, and library-specific assumptions. Those
mechanisms would create a second composition or authorization path in v4.

## Decision

QUESTPIE accepts three capability-scoped composition primitives.

- A Service is a compiler-owned Definition with stable identity, Owner,
  Origin, explicit dependencies, an `application` or `execution` lifetime, and
  a transaction-safe or external-effect classification. Dependencies form a
  compiled acyclic graph. Application Services may depend only on application
  Services; transaction-safe Services may depend only on transaction-safe
  Services. Creation is lazy and coalesced. Disposal is once, in reverse
  dependency order.
- Application lifetime means one instance per Runtime instance, never one
  process or cluster singleton. Execution lifetime means one instance per root
  boundary. A raw Route boundary owns its execution Services until the returned
  body reaches EOF, errors, or is cancelled. Runtime drain finishes or aborts
  these scopes before disposing application Services.
- A Route is the bounded raw Fetch escape hatch. The compiler owns literal
  method/path identity, overlap diagnostics, admission metadata, limits,
  Origin, generated direct invocation, and mounting into the one generated
  `app.fetch`. Its handler receives the exact `Request`, typed parameters,
  Principal, cancellation, deadline, and only Route-safe Services. It receives
  no data facade, Mutation facade, raw database, or ambient System Authority.
- A Route enters ordinary application behavior only through an explicit
  generated Execution transition. That transition supplies Context input and
  an optional narrower Principal, then uses the accepted Context, Policy,
  Query, Mutation, transaction, observation, and error kernels.
- Network invocation resolves request credentials. Generated direct Route
  invocation requires an explicit ingress Principal and never replays network
  credentials. Both use the same compiled handler and lifetime kernel. Routes
  are not projected into the generated JSON Operation client.
- An application installs zero or one credential resolver. Zero produces the
  anonymous Principal. The resolver is bound to one explicit application-
  lifetime external Service and returns a resolved Principal, anonymous, or a
  typed ingress failure. It does not decide Policy, Tenant, or Authority.
- Auth Collections, migrations, configuration, native server object, and
  native client remain application or ordinary Package code. A future Better
  Auth reference Package may compose Collections, Service, credential resolver,
  and Route Definitions, but it has no privileged compiler ABI, mandatory
  schema, separate migration path, or generated-client authority.

The current proof uses the provisional spellings `defineService`,
`defineCredentialResolver`, and application-specialized `defineRoute`. Ticket
#21 owns the final factory and export consolidation; it may change spelling but
not these ownership and capability boundaries without a superseding proof.

## Consequences

- Service instances are not Context facts, static artifacts, or durable state.
  Artifacts expose identity, dependency, lifetime, effect, Owner, and Origin;
  the Execution Envelope may expose safe lifecycle observations but never
  Service state or credentials.
- Query and Mutation contexts cannot access external-effect Services. A
  retryable transaction therefore cannot hide a provider call behind a
  Service. Service creation and Route execution never silently retry effects.
- Auth provider outage is distinguishable from invalid or absent credentials;
  it cannot silently downgrade to anonymous.
- Exact method/path collisions fail compilation. Parameter grammar, wildcard
  precedence, and overlap diagnostics are mandatory compiler fixtures for the
  Route implementation slice.
- ADR-0014's generated App surface is extended only by the compiler-owned
  `routes` direct-invocation projection accepted here. `fetch`, `execution`,
  and `close` retain their accepted semantics.

## Rejected alternatives

- One universal fluent builder whose conditional methods admit invalid
  lifetime, effect, or execution combinations.
- Mutable Runtime middleware, service registries, authored server entrypoints,
  or order-sensitive mounting.
- Modeling a raw Route as an Action or generated JSON Operation.
- Making Better Auth or another vendor a second schema, migration,
  authorization, Context, or generated-client authority.
