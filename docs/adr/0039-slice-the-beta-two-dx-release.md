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
  clients, Runtime kernels, CLI, and the optional `questpie/react-query`
  subpath accepted by ADR-0044. Its generated native options use TanStack's
  cache and hooks with the existing generated transport. The release includes
  ordinary/Suspense and compiler-proven forward infinite Queries, conservative
  non-live invalidation, scoped retirement and native TanStack Start SSR/
  hydration. Neutral Query Resources remain available independently; they do
  not sit between the native cache and its watch. The old React hook/subpath
  is removed without an alias;
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
ADR-0043 supplies static numeric five-field UTC schedules, explicit
revision-fenced activation, one latest catch-up tick and the minimum
named-Mutation checkpoint. Dynamic due times stay application-owned rows.
Activation, schedule programs and retained executable compatibility have
separate identities. The checkpoint uses the existing Mutation receipt rather
than a second result ledger. Protocol v9 requires the accepted explicit
non-rolling cutover; compatible executable rolling behavior does not imply
mixed-protocol support.

Framework-owned optimistic layers, automatic rollback/rebase, causal
commit-to-observation guarantees, TanStack DB, live infinite lists and
offline/persistence remain outside this beta. Pending intent uses the executed
typed native userland recipe. Action checkpoints, sleep, signals, child Jobs,
dynamic schedule CRUD and broader workflows remain outside the Job subset.
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
   release/peer relationships. `questpie` declares React `^19.2.0` and
   TanStack React Query `^5.102.8` as optional peers. Both archives pack twice
   byte-identically and install together in a clean consumer; the native
   application is also physically relocated. Core installs, imports and builds
   without the optional UI packages. Native use executes with real supported
   peers, rejects missing required dependencies, and classifies unsupported
   versions against the declared ranges without inventing an import-time
   version guard. OpenTelemetry retains its exact required core peer;
5. the public skill validates in its distribution directory, follows no
   repository-internal pointer, uses only released syntax, and its referenced
   examples compile against the packed packages;
6. the public docs expose a frozen beta.1 inventory and an exact beta.2
   inventory, build successfully, and contain no capability that the packed
   release cannot execute;
7. the full registered PostgreSQL 17 and browser lanes, package contract,
   architecture, strict dependency audit, `quality:release`, two consecutive
   byte-identical release dry-runs, and `git diff --check` pass on the exact
   candidate head. The unchanged registered release workloads must execute
   on the dedicated `questpie-release` runner; manifest validation and local
   timings are not substitutes;
8. every disposable PostgreSQL container, browser process, receiver, host,
   listener, port, temporary install, tarball, and generated tracer output is
   removed on success and deliberate failure.

This exceptional release boundary requires focused manifest-bound acceptance
after deterministic evidence is complete. A PASS permits a separate authority
projection and release-ready commit. It does not authorize push, tag, publish,
or deploy.

## Consequences

- A later beta starts from one clean two-package and artifact inventory.
- Public documentation distinguishes released behavior from accepted or
  in-progress source behavior.
- Landing-page work can consume one exact framework capability inventory while
  keeping Autopilot product claims separate.
- Files, Search, Studio, split Runtime roles, a polymorphic Relation kernel,
  and a separate Workflow Resource remain outside beta.2.

## Candidate reconciliation

ADR-0043 and ADR-0044 supersede the earlier candidate's blanket schedule and
React SSR exclusions. This reconciliation changes no Accepted Kernel contract
and does not accept this ADR. The historical beta.2 manifest still carries the
pre-extension scope and measurements; it must be replaced with fresh
tool-bound final evidence before the permitted acceptance invocation. Only a
committed, verified PASS may precede a separate authority projection.
