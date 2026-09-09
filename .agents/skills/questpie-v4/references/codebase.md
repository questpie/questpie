# QUESTPIE codebase organization

Use **deep modules**: a small interface hiding substantial behavior. Organize
private implementation by product domain, not by generic technical layer.

## Topology

- Keep `questpie` as the sole application authoring/Runtime package and its
  explicit public barrel, including the accepted optional `questpie/react-query`
  subpath. React consumers use generated native options; retain the
  framework-neutral `.observe` and Query Resource implementation for non-React
  consumers. The retired React hook has no forwarding export.
  Compiler, Runtime, and testkit packages remain private implementation
  modules.
- Keep the generated scope capability framework-neutral and internal. The native
  Query Adapter uses TanStack's cache and the existing generated `.watch`, not
  Query Resource as an intermediate cache. Root and generated-client imports
  remain free of React/TanStack runtime dependencies.
- Keep `questpie-opentelemetry` as the one optional exact-peer package.
  Applications still author and run through `questpie`, and the integration
  implements the core-owned opaque observation handle. This is not a generic
  integration-package rule, and the `questpie-` prefix conveys no trust.
- Group compiler implementation under domain folders such as `composition/`,
  `schema/`, and `seed/`.
- Give each domain one internal seam at `<domain>/index.ts`. Cross-domain imports
  use that seam; files below it remain private to the domain. A domain whose
  main seam necessarily loads an external adapter may additionally expose one
  side-effect-free `<domain>/contract.ts` seam for types, errors, and brands;
  cross-domain contract-only imports may use it without pulling adapter code
  into compiler-controlled evaluation.
- Place adapters below their owning domain, for example
  `schema/postgres/apply.ts`, instead of creating a provider-layer directory.
- Add an adapter seam only when two real adapters exist. PostgreSQL is the only
  durable adapter in v1. Do not turn optional integrations into a generic
  provider matrix, registry, or application-authored provider SPI.

## Interface discipline

1. Name the module and its reason to change.
2. Define the smallest caller-visible interface, including errors, ordering,
   budgets, and invariants.
3. Keep canonicalization, validation, planning, rendering, and persistence
   behind that interface when callers need them as one capability.
4. Inject remote or external dependencies. Keep in-process and
   local-substitutable dependencies internal.
5. Test observable behavior through the same interface callers use. Remove
   tests that exist only to reach private helpers after the deeper test exists.

Avoid pass-through files whose deletion merely moves one call. A folder split
must improve locality, ownership, or testability.

## Size ratchet

- New or modified production files above 500 lines emit a review warning.
- New production files above 800 lines fail quality checks.
- Existing files above 800 lines live in the shrink-only baseline. Growth
  fails; reaching 800 lines requires removing the baseline entry.
- Line count is a pressure signal, not the reason for a seam. Split on distinct
  reasons to change and keep the resulting modules deep.

Run `bun run architecture:check` after changing production topology.

## Tests and artifacts

- Keep behavior tests in `tests/unit`, `tests/type`, `tests/hostile`,
  `tests/integration/postgres`, and `tests/performance`.
- Keep committed migration and Seed artifacts beside their owning fixture.
- Keep correctness, micro, load, and soak evidence in separate lanes.
- Import a domain through its seam in tests unless the test explicitly owns an
  internal adapter contract.

## Review

For every changed module, verify its owner, interface, dependencies, adapter
seams, tests, and size-ratchet result. Reject cyclic domain dependencies,
parallel kernels, generic provider matrices, and public exports added only for
testing.
