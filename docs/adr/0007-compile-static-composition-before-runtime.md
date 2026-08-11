# ADR 0007: Compile static composition before runtime

- Status: Accepted
- Date: 2026-08-11

## Context

ADR 0004 requires one deterministic Barbershop tracer before broader product
work. V3 composed Modules and plugins at runtime, which made import order,
implicit activation, ownership, and generated types difficult to prove.

V4 needs Package reuse and explicit escape hatches without restoring a runtime
merge system or freezing a public compiler plugin ABI.

## Decision

QUESTPIE compiles all application composition before runtime.

- One committed, non-executable `questpie.json` records Application and
  PostgreSQL configuration plus direct Package activation and accepted Package
  inventory digests.
- QUESTPIE discovers exported local Definitions below one configured source
  root. File path and export name record Origin but do not create Resource
  Identity.
- `bun add` installs a dependency and never activates composition. `questpie add`
  installs and explicitly activates a compatible Package. The fixed
  `./questpie` Package export exposes only branded Definitions, Augmentations,
  and types.
- Every Resource has explicit Resource Identity and one establishing Definition
  as Owner. A second establishing Definition always collides.
- An Owner accepts one exact typed, Resource-kind-specific Augmentation value.
  V1 has no target-side patch, wildcard merge, last-wins rule, or import-order
  precedence.
- A fixed Package Definition is sealed. An application customizes it only by
  vendoring the Package composition locally and deactivating the Package root.
- The compiler evaluates structural graphs in controlled fresh realms. Build,
  check, and commands that write a Committed Migration or Seed artifact prove
  determinism with two complete compilations.
- The compiler emits a deterministic Compiled Manifest, Schema Projection,
  Origin Map, Build Input, and concrete App Contract. The QUESTPIE Runtime loads
  those artifacts and performs no discovery or merge.
- The Build Input covers application configuration, TypeScript configuration,
  the lockfile, the framework, activated Packages, and every library module in
  the structural graph. Origin remains deterministic but does not enter
  semantic or migration digests.

The accepted escape hatches preserve the same compiler and migration path:

- a user can edit the Package activation map manually;
- an application can vendor a sealed Package Definition and deactivate the
  Package root;
- `questpie.json` can override only a PostgreSQL physical name by exact semantic
  identity;
- an external generator can write ordinary source Definitions before compile.

## Consequences

- Dependency installation cannot change the App Contract by itself.
- A Package update cannot change accepted composition without an inventory
  review, and database changes still require the normal Migration Plan review.
- Local Definition types remain Resource-local. The generated App Contract is
  the exact application-wide type authority.
- Package trust remains an application responsibility. The controlled evaluator
  is a determinism boundary, not a security sandbox for hostile code.
- A Package that exports a sealed Definition must be vendored as a whole when an
  application needs to customize that Resource and still use other composition
  exports from the Package.
- Later Resource kinds can add their own closed Definition and Augmentation
  contracts without gaining compiler hooks or runtime merge authority.

## Rejected alternatives

- Activate Packages because they are installed or imported.
- Maintain a central application `definitions` registry.
- Merge Module or plugin objects at runtime.
- Use ambient TypeScript registry augmentation as application composition.
- Let Package order, file order, or import order select a collision winner.
- Add a general public compiler, lowering, install-hook, or generator API.
- Let applications patch Package-owned Resources by target identity.
- Derive Resource Identity from Package, file, directory, or export names.
