# QUESTPIE codebase organization

Use **deep modules**: a small interface hiding substantial behavior. Organize
private implementation by product domain, not by generic technical layer.

## Topology

- Keep `questpie` as the single published package and explicit public barrel.
- Keep compiler, runtime, and testkit packages private implementation modules.
- Group compiler implementation under domain folders such as `composition/`,
  `schema/`, and `seed/`.
- Give each domain one internal seam at `<domain>/index.ts`. Cross-domain imports
  use that seam; files below it remain private to the domain.
- Place adapters below their owning domain, for example
  `schema/postgres/apply.ts`, instead of creating a provider-layer directory.
- Add an adapter seam only when two real adapters exist. PostgreSQL is the only
  durable adapter in v1.

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
