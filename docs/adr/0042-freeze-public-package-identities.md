# ADR-0042: Freeze public package identities

- Status: Accepted
- Date: 2026-09-03
- Owners: Product architecture, package distribution, release

## Context

ADR-0033 and ADR-0035 accepted the OpenTelemetry and React projections but
placed them under scoped package names. The directionally approved Deep-DX
import map instead keeps the small React bridge next to the framework surface
and separately establishes unscoped `questpie-<capability>` names for compiler
capability Packages. OpenTelemetry is not such a compiler Package; its own
workbench independently names `questpie-opentelemetry` as the ordinary host
integration package.

Package identity is public release behavior. It cannot be repaired by silently
renaming manifests, retaining compatibility packages, or describing research as
already Accepted. The projection kernels, ownership boundaries, and current
exact-peer guarantees remain sound; only their npm placement and the resulting
release cardinality need a focused decision before beta.2 is assembled.

## Proposed decision

QUESTPIE ships exactly two public npm packages at one exact release version:

- `questpie` owns the framework, compiler, generated application and clients,
  Runtime, CLI, and the optional `./react` export subpath;
- `questpie-opentelemetry` owns the official OpenTelemetry integration and has
  an exact peer dependency on `questpie` at the same version.

The public React import is:

```ts
import { useQueryResource } from "questpie/react";
```

`questpie/react` is an export subpath, not another npm package. It keeps the
entire ADR-0035 boundary: one `useSyncExternalStore` projection over Query
Resource and no cache, identity, transport, retry, invalidation, Context,
credential, provider, SSR, Suspense, hydration, ReactDOM, or fallback owner.

The `questpie` package declares `react: ^19.2.0` as an optional peer. Importing
`questpie` or any non-React public subpath must not resolve, import, initialize,
or expose React or React-only declarations. Importing `questpie/react` requires
a compatible React peer. A missing React peer fails module resolution; an
incompatible React peer fails package-manager peer validation or QUESTPIE's
packed-consumer compatibility gate. The subpath never selects a bundled React,
vendored React, global React, alternate hook implementation, or non-React
fallback.

The public OpenTelemetry import is:

```ts
import { createOpenTelemetry } from "questpie-opentelemetry";
```

`questpie-opentelemetry` keeps the entire ADR-0033 and ADR-0034 boundary. It is
host configuration, not a compiler Package, Definition, Service, Context
capability, general provider SPI, authorization model, or durable truth. Its
exact `questpie` peer must match its own version. The CLI telemetry flag resolves
only `questpie-opentelemetry` from the application root; absence, an incompatible
peer, a missing export, or an incompatible opaque observability contract fails
before readiness under the existing closed startup failure semantics.

The names `@questpie/react` and `@questpie/opentelemetry` are deleted. Neither
name remains as a package, export, dependency, alias, forwarding manifest,
re-export, CLI lookup candidate, diagnostic suggestion, or compatibility path.
Resolution never falls back from a canonical name to an obsolete one.

The unscoped `questpie-` prefix conveys no trust. Official status comes from
QUESTPIE documentation and release provenance, never from npm spelling. This
decision does not create a general integration ABI or reserve the prefix.

## Package and release contract

Both public npm packages advance together. For beta.2 they are exactly
`4.0.0-beta.2`; `questpie-opentelemetry` declares exact peer
`questpie: 4.0.0-beta.2`. `questpie` declares optional peer
`react: ^19.2.0`. No workspace-only public identity or third publishable
archive exists.

Release verification must:

1. reject missing, extra, private-as-public, obsolete scoped, or
   version-mismatched public packages;
2. pack both archives twice byte-identically and bind their declaration and
   archive digests into the release manifest;
3. install both into one relocated clean consumer and prove the root,
   `questpie/react`, and `questpie-opentelemetry` imports;
4. prove `questpie` root install/import/build without React or OpenTelemetry;
5. prove `questpie/react` succeeds with React 19 and fails closed when React is
   absent or outside the accepted peer range;
6. prove `questpie-opentelemetry` fails closed when `questpie` is absent or at
   a different version; and
7. scan active packages, generated code, fixtures, tests, public docs, skills,
   CLI resolution, release manifests, lockfiles, and packed bytes for obsolete
   scoped names; historical ADR and frozen beta.1 records may name the bytes
   they actually governed.

## Failure, disclosure, and runtime semantics

Package-resolution and peer failures happen at install, import, build, or
startup as appropriate; they never become request-time fallback behavior.
Native package-manager and module-loader diagnostics remain owned by those
tools. QUESTPIE-owned CLI, release-gate, and startup diagnostics name only the
canonical package or subpath, expected version or peer range, and safe mismatch
class. QUESTPIE-owned diagnostics expose no registry credentials, filesystem
search history, environment values, application Context, or payload.

Changing package placement changes no request, transaction, retry,
cancellation, Policy, nondisclosure, observation, Query Resource, or shutdown
semantics. Root `questpie` remains usable when optional integrations are absent.

## Supersession ledger

This decision supersedes only:

- ADR-0033's `@questpie/opentelemetry` package spelling, package placement and
  peer metadata, CLI resolution specifier, and release-cardinality/archive
  clauses;
- ADR-0035's `@questpie/react` package spelling, package placement and peer
  metadata, and release-cardinality/archive clauses; and
- matching package-name and cardinality wording in their authority projections.

ADR-0033's observation kernel, opaque handle, SDK ownership, exact-version OTel
coupling, startup, failure, disclosure, propagation, durable-link, flush, and
shutdown semantics are preserved. ADR-0034 is unchanged. ADR-0035's Query
Resource and React projection semantics are preserved. No Operation, HTTP,
OpenAPI, MCP, lifecycle, Relation, Policy, PostgreSQL, or generated App Contract
behavior changes.

ADR-0039 remains Proposed. Its candidate package inventory must consume this
decision only after PASS; it cannot accept or project this proposal itself.

## Deletion and migration

After acceptance, one tracer-led breaking migration renames the OpenTelemetry
package, moves the React adapter into `questpie`'s `./react` export, updates the
CLI and every consumer, and then deletes the two scoped package identities in
the same vertical. The repository must never contain parallel canonical and
compatibility package graphs.

SPEC, CONTEXT, public documentation, HANDOFF, package manifests, release
manifests, and ADR-0039 are projected only after a committed PASS record. Frozen
beta.1 authority and evidence remain immutable and may retain the historical
names they governed.

## Acceptance

This Proposed decision requires one manifest-bound acceptance review because it
supersedes Accepted public package and exceptional release semantics. Before
review, executable proof must falsify the package-topology decision without
changing production: exactly two package manifests, root-without-React
isolation, React-subpath failure without React, success with React 19, exact
OpenTelemetry peer declaration and import, obsolete-name non-resolution, and a
complete machine-checked projection/deletion inventory. The isolated prototype
also packs both candidate packages twice byte-identically, installs them into
relocated offline consumers, and rejects incompatible declared peer versions.
Deterministic production packing, production declaration digests, and
exhaustive active-surface deletion remain post-acceptance implementation gates
in the release contract above; the acceptance record must not claim that the
prototype has already shipped or completed them.

A committed PASS permits a separate authority projection followed by the
breaking implementation vertical and its independent Standards and Spec
reviews. PASS does not authorize push, tag, publish, or deploy.

The pinned Opus transport returned two terminal `NO_RESULT` timeouts without a
review artifact. At the human owner's direction, an independent three-axis
Codex high-reasoning panel reviewed the replacement candidate, initially
blocked authority and deletion-inventory omissions, and returned PASS on all
three axes after the focused repairs. The transparent record is
`docs/v4/prototypes/public-package-identities/CODEX-PANEL-REVIEW.json`; it does
not claim to be protocol-v2 or an Opus result and creates no fallback transport
precedent in the repository wrapper.
