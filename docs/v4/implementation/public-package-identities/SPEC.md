# Public package identities implementation spec

- Status: Proposed; unimplemented
- Classification: Product packaging projection with an exceptional release boundary
- Consumers: Team Support Desk, packed consumers, CLI telemetry host
- Authority prerequisite: a focused superseding package-identity decision must
  receive its required committed `PASS` before implementation begins

## Outcome

Beta.2 publishes exactly two npm packages:

| Package                  | Public imports                                                                             | Ownership                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `questpie`               | `questpie`, `questpie/react`, and the existing private bridge used by the official adapter | Core authoring, compiler, Runtime, CLI, and the thin React projection |
| `questpie-opentelemetry` | `questpie-opentelemetry`                                                                   | Official OpenTelemetry SDK graph and Runtime observation projection   |

The old `@questpie/react` and `@questpie/opentelemetry` package identities are
deleted. They are not aliases, redirects, compatibility packages, dependency
stubs, or fallback resolution candidates. Frozen ADR and proof records retain
their historical spelling; current authority and public documentation project
only the new identities after acceptance.

This slice changes package placement and naming only. It does not change Query
Resource, React rendering, Runtime observation, trace propagation, lifecycle,
Policy, PostgreSQL, wire, or generated App Contract semantics.

## `questpie/react`

`questpie` exports a `./react` subpath whose runtime surface remains exactly:

```ts
export function useQueryResource<Output>(
	resource: QueryResource<Output>,
): QueryResourceSnapshot<Output>;
```

The subpath imports React and uses `useSyncExternalStore`. The root `questpie`
entry and CLI do not import, resolve, or bundle React. `react: ^19.2.0` is an
optional peer of the `questpie` archive so non-React applications can install,
import, build, and run core without React. Importing `questpie/react` without a
compatible React peer fails at installation or module resolution; QUESTPIE does
not provide a shim or silent disable.

The old separate React package directory, manifest, build task, archive, peer
relationship to core, and install helper are deleted once the subpath tracer is
green. The subpath owns no cache, transport, identity, retry, invalidation,
provider, ReactDOM, SSR, Suspense, hydration, or fallback behavior.

## `questpie-opentelemetry`

The existing adapter package changes its npm identity to
`questpie-opentelemetry`. It keeps the exact beta.2 `questpie` peer and the same
single public `createOpenTelemetry` export. Core keeps no OpenTelemetry SDK
dependency.

`questpie start --telemetry=opentelemetry` resolves only
`questpie-opentelemetry` from the application root. Missing package, missing
export, incompatible peer or Runtime metadata, and invalid configuration retain
the accepted fail-before-readiness diagnostics and disclosure rules. The CLI
does not probe the old scoped identity after a failure.

Domain separators such as `questpie-opentelemetry-projection-v1` and
`questpie-opentelemetry-config-v1` are protocol identities, not npm package
specifiers. They remain byte-identical unless a separate accepted protocol
decision changes them.

## Fixture and generated-artifact boundary

Team Support Desk imports `useQueryResource` from `questpie/react`, imports
`createOpenTelemetry` from `questpie-opentelemetry`, and declares no old scoped
dependency. Its PostgreSQL 17 and Firefox journey must exercise the packed
artifacts, not workspace-only paths.

This rename does not by itself change compiler-generated application files,
Runtime Build identity, signal projection, or beta.1 generated goldens. A
generated digest changes only when regeneration demonstrates a byte change;
package-name replacement is not a reason to refresh unrelated goldens.

## Release artifact contract

The beta.2 release inventory contains exactly the two packages above at one
version. Release verification:

1. builds and packs each archive twice byte-identically;
2. rejects a missing, extra, private-as-public, old-name, or version-mismatched
   package;
3. installs both archives into one relocated clean consumer and imports
   `questpie`, `questpie/react`, and `questpie-opentelemetry`;
4. proves core root import and packed application build without React or
   OpenTelemetry;
5. proves the React subpath with React 19 and rejects an absent or incompatible
   React peer;
6. proves explicit telemetry activation and exact-peer incompatibility fail
   before readiness; and
7. proves both old scoped specifiers are unresolved.

The release manifest binds every public export declaration, including
`questpie/react`; hashing only `dist/index.d.ts` is insufficient. Its canonical
declaration inventory is sorted by export key and records the exported
declaration target and SHA-256. The package archive SHA-256 remains a separate
field. Manifest content is refreshed only from twice-identical built bytes.

Moving React into core necessarily changes the `questpie` archive digest.
Changing the adapter package name necessarily changes its archive digest even
if its generated filename is unchanged. Declaration digests and any generated
golden changes are measured rather than predicted.

## Documentation and supersession

The authority projection explicitly supersedes only the package-name,
package-count, install, import, and peer-placement clauses of ADR-0033 and
ADR-0035. Their behavioral decisions remain Accepted. `SPEC.md`, `CONTEXT.md`,
`HANDOFF.md`, the ADR index, beta.2 inventory, public React and OpenTelemetry
guides, and implementation ledgers must agree on the two-package inventory.

Frozen acceptance manifests, review records, prototypes, and research are not
globally rewritten. A repository scan distinguishes those historical records
from current production, fixture, release, and public-documentation surfaces.

## Non-goals

- no compatibility alias, redirect, fallback resolver, or transitional third
  package;
- no additional React hook, provider, cache, SSR, or ReactDOM API;
- no OpenTelemetry SDK dependency in core and no `questpie/opentelemetry`
  subpath;
- no change to protocol/domain digest strings solely because of npm naming;
- no MCP, lifecycle, relation, realtime, Job, Workflow, or generated-client
  redesign; and
- no push, tag, publish, or deploy.

## Completion evidence

Completion requires the focused package tests, clean packed consumers, Team
Support Desk PostgreSQL 17/Firefox tracer, affected Collaboration hostile
coverage, Standards and Spec reviews, `architecture:check`, `package:check`,
strict dependency audit, `quality:release`, two consecutive byte-identical
release dry-runs on the final head, `git diff --check`, and cleanup of every
owned temporary process, database, browser, archive, and install directory.
