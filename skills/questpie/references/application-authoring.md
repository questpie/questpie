# Application authoring

Read the complete public guides for
[Definition composition](https://questpie.com/docs/v4/definition-composition)
and [schema lifecycle](https://questpie.com/docs/v4/schema-lifecycle) before
changing the Application Root or PostgreSQL shape.

## Own each definition once

- Import structural factories such as `defineCollection`, `field`,
  `constraint`, `index`, and `relation` from `questpie`.
- Import executable factories such as `defineQuery`, `defineMutation`,
  `defineAction`, `defineRoute`, and `defineJob` from the current generated
  `#questpie/app` contract.
- Import the application client from `#questpie/client`.
- Let convention discovery and the configured Application Root compose
  Definitions. Installing a package does not activate it.
- Give public Resources stable explicit names. Resolve duplicate identities or
  normalized-path collisions at their owners instead of depending on import
  order.

Do not hand-edit `.questpie/generated` output. A complete build owns that
directory and deletes stale generated files.

## Organize the application by domain

For a new application, follow the Team Support Desk convention: group each
Collection with its Policy, Collection Operations, named Queries and Mutations,
Jobs, and local helpers. For example:

```text
src/
  execution.ts
  tickets/
    index.ts          Collection declaration and lifecycle
    policy.ts
    operations.ts     Collection Operation declarations
    queries.ts
    mutations.ts
    sla-follow-up.ts
  auth/
web/
  main.tsx
  auth/
  tickets/
  questpie.ts         generated client boundary
runtime/             external deployment adapters
questpie/            committed migrations and immutable Seeds
tracer/              fixture host and test automation
```

These paths are a convention, not a compiler grammar. Preserve a coherent
existing layout; `source.root` controls Definition discovery and explicit names
control Resource identity. Put the actual Collection declaration in the domain
entry rather than adding a pass-through barrel. Keep helpers local until real
consumers need sharing. Product UI must build without importing tracer code;
browser automation can import and exercise the product UI.

After moving Definitions, rebuild and review Origins and executable artifacts.
Keep immutable migration and Seed history intact. A source move is not a
schema migration or permission to change a Resource name.

## Change PostgreSQL shape deliberately

The Compiled Manifest is desired state, committed migrations are reviewed
history, and the Schema Fingerprint is observed database state. Follow the
application's compile, plan, review, commit, apply, and Drift-verification
workflow. A build is not permission to apply a migration.

Model database guarantees as Constraints and Indexes where PostgreSQL owns the
invariant. Keep stable Resource and Field identities separate from physical
PostgreSQL names.

## Keep ingress explicit

Use a Route for an authored external protocol path. Set its accepted
`credentials` and `policy` modes explicitly and keep request parsing at that
boundary. Application credential resolution produces a Principal; Context and
Policy remain the data authorization boundary.

Use immutable Seeds for repeatable bootstrap data. Treat a changed Seed as a
new named Seed rather than mutating committed history.
