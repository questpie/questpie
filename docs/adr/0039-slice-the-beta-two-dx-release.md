# ADR-0039: Slice the beta.2 DX release

- Status: Proposed
- Date: 2026-09-01
- Owners: Product architecture, compiler, Runtime, client, release

## Context

ADR-0021 froze `4.0.0-beta.1` as a deliberately narrow connected release. Its
absence list included capabilities that are now accepted or being completed:
Action, Route and credential ingress, Job, reactive Query state, OpenTelemetry,
inverse Relation selection, OpenAPI, MCP, and public agent guidance.

Shipping that larger product under the beta.1 identity would make the release
contract and its public guide false. Closing each later vertical independently
without one release inventory would also let package peers, generated
artifacts, public documentation, and tracer evidence disagree.

## Proposed decision

The next connected prerelease is `4.0.0-beta.2`. Beta.1 remains immutable
history. Beta.2 contains only the rows in the candidate scope table at
[`docs/v4/beta2-release-scope.md`](../v4/beta2-release-scope.md).

Two public packages ship at the exact same version:

- `questpie` owns structural authoring, the compiler, generated application and
  clients, Runtime kernels, CLI, and the optional `questpie/react` subpath. The
  subpath projects Query Resource through `useSyncExternalStore` and owns no
  cache, transport, retry, invalidation, provider, SSR, Suspense, hydration, or
  fallback behavior;
- `questpie-opentelemetry` is an exact peer that projects the Runtime
  observation contract through the official OpenTelemetry SDK and owns no
  application authority or durable truth.

The repository also ships a public `skills/` tree in the current Agent Skills
format. That framework-authoring skill teaches an agent to use released
QUESTPIE behavior and points to versioned public documentation. It is distinct
from an application-specific skill projection derived from one compiled App
Contract; beta.2 does not invent or hand-author that compiler projection.

The public v4 guide describes the latest released beta. Each prerelease keeps
one frozen release inventory. Beta.2 documentation becomes the latest guide
only in the release-ready projection after every included vertical passes.
Unaccepted and incomplete work remains in internal decision and implementation
documents rather than public pages.

## Release boundary

Beta.2 closes one generated contract across direct calls, canonical HTTP,
OpenAPI, MCP, Query Resource, React, PostgreSQL, and browser consumers. OpenAPI
and MCP derive names and schemas from the same compiler-owned Operation and
codec facts. Authors do not repeat HTTP paths, MCP tool names, parameters,
schemas, nullability, bounds, results, or errors. No compatibility endpoint,
fallback request method, second executor, second realtime kernel, or parallel
lifecycle/CRUD kernel ships.

The beta includes the three ordinary TypeScript disjunction helpers accepted
by ADR-0037 and their public recipes. It does not add a polymorphic Relation,
codec, descriptor, registry, or Runtime kernel. Applications remain free to
model a discriminated value inside one Collection or across several
Collections.

Job remains the single owner of explicit, delayed, and closed checkpointed
durable work. Beta.2 adds no `Workflow` Resource or `defineWorkflow` factory.
Autopilot is a downstream consumer and landing-page subject, not framework
release implementation or authority.

## Acceptance

Beta.2 is release-ready only when:

1. every included vertical is Accepted where required, implemented without a
   compatibility path, integrated into the reference applications, and closed
   by independent Standards and Spec review;
2. the canonical generated App Contract drives direct, HTTP, OpenAPI, MCP,
   Query Resource, and React types without author-restated schemas or paths;
3. Team Support Desk passes as the beginner browser consumer and Collaboration
   passes its authority, nondisclosure, lifecycle, inverse, realtime,
   OpenTelemetry, HTTP, and MCP hostiles on PostgreSQL 17;
4. `questpie` and `questpie-opentelemetry` use exact `4.0.0-beta.2`
   release/peer relationships, `questpie` declares React `^19.2.0` as an
   optional peer, both archives pack twice byte-identically, install together
   in a relocated clean consumer, and fail closed on missing or mismatched
   required peers;
5. the public skill validates in its distribution directory, follows no
   repository-internal pointer, uses only released syntax, and its referenced
   examples compile against the packed packages;
6. the public docs expose a frozen beta.1 inventory and an exact beta.2
   inventory, build successfully, and contain no capability that the packed
   release cannot execute;
7. the full registered PostgreSQL 17 and browser lanes, package contract,
   architecture, strict dependency audit, `quality:release`, two consecutive
   byte-identical release dry-runs, and `git diff --check` pass on the exact
   candidate head;
8. every disposable PostgreSQL container, browser process, receiver, host,
   listener, port, temporary install, tarball, and generated tracer output is
   removed on success and deliberate failure.

This exceptional release boundary requires focused manifest-bound acceptance
after deterministic evidence is complete. A PASS permits a separate authority
projection and release-ready commit. It does not authorize push, tag, publish,
or deploy.

## Consequences

- A later beta starts from one clean three-package and artifact inventory.
- Public documentation distinguishes released behavior from accepted or
  in-progress source behavior.
- Landing-page work can consume one exact framework capability inventory while
  keeping Autopilot product claims separate.
- Files, Search, Studio, split Runtime roles, a polymorphic Relation kernel,
  and a separate Workflow Resource remain outside beta.2.
