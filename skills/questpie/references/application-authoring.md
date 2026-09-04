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
