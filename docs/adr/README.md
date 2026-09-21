# QUESTPIE v4 architecture decisions

This directory contains only current v4 decisions. Earlier exploratory ADRs
were removed from the clean-state branch because they mixed incompatible
product models. Git history and `docs/v4/research/` preserve the evidence.

## Accepted

1. [Standalone PostgreSQL application runtime](./0001-standalone-postgresql-application-runtime.md)
2. [Reviewable schema and migration lifecycle](./0002-reviewable-schema-lifecycle.md)
3. [Studio as the operational application surface](./0003-studio-is-the-operational-application-surface.md)
4. [One tracer before product breadth](./0004-prove-one-tracer-before-capability-breadth.md)
5. [Principal in core and Auth outside the compiler ABI](./0005-keep-principal-core-and-auth-outside-the-compiler-abi.md)
6. [Transactional v1 schema artifact protocol](./0006-freeze-the-transactional-v1-schema-artifact-protocol.md)
7. [Static composition compiles before runtime](./0007-compile-static-composition-before-runtime.md)
8. [Foundational data and structural Query contract](./0008-freeze-the-foundational-data-and-structural-query-contract.md)
9. [Executable Definitions bind from the current App Contract](./0009-bind-executable-definitions-from-the-current-app-contract.md)
10. [Trusted Context and relational Policy](./0010-freeze-trusted-context-and-relational-policy.md)
11. [Query, Mutation, and explicit lifecycle](./0011-freeze-query-mutation-and-explicit-lifecycle.md)
12. [Live Query and Change Ledger](./0012-freeze-live-query-and-change-ledger.md)
13. [Transactional Dispatch and Reaction](./0013-freeze-transactional-dispatch-and-reaction.md)
14. [Runtime, Client, Execution Envelope, and Minimal Studio](./0014-freeze-runtime-client-envelope-and-minimal-studio.md)
15. [Service, Route, and Auth Composition](./0015-freeze-service-route-and-auth-composition.md)
16. [Lifecycle Jobs and the Shared Durable Kernel](./0016-freeze-lifecycle-jobs-and-shared-durable-kernel.md)
17. [Multi-Instance Correctness and Optional Acceleration](./0017-freeze-multi-instance-and-optional-acceleration.md)
18. [File, Search, and Contract Projections](./0018-freeze-file-search-and-contract-projections.md)
19. [Semantic Kernels and the Public Surface](./0019-freeze-semantic-kernels-and-public-surface.md)
20. [Repository Foundation](./0020-establish-the-repository-foundation.md)
21. [Beta.1 Release Slice](./0021-slice-the-beta-one-release.md)
22. [API Ergonomics and Operation Projection](./0022-freeze-api-ergonomics-and-operation-projection.md)
23. [Post-Commit Operation Outcome](./0023-freeze-post-commit-operation-outcome.md)
24. [Descope Minimal Studio from Beta.1](./0024-descope-minimal-studio-from-beta-one.md)
25. [Remove Channels from the Core](./0025-remove-channels-from-core.md)
26. [Freeze Action and Unify Checkpointed Work in Job](./0026-freeze-action-and-unify-checkpointed-work-in-job.md)
27. [Simplify V4 Delivery Around Runnable Tracers](./0027-simplify-v4-delivery-flow.md)
28. [Freeze Action Effect Identity, Limits, and Operation Wire v3](./0028-freeze-action-effect-identity-limits-and-wire-v3.md)
29. [Unify Policy expression authoring](./0029-unify-policy-expression-authoring.md)
30. [Freeze Collection provenance and trusted values](./0030-freeze-collection-provenance-and-trusted-values.md)
31. [Freeze Collection lifecycle programs and issue mapping](./0031-freeze-collection-lifecycle-programs-and-issue-mapping.md)
32. [Freeze bounded inverse `toMany` Query projection](./0032-freeze-bounded-inverse-tomany-query-projection.md)
33. [Freeze Runtime observation and the OpenTelemetry projection](./0033-freeze-runtime-observation-and-opentelemetry-projection.md)
34. [Freeze explicit ingress trace plans and response-absent HTTP terminals](./0034-freeze-explicit-ingress-trace-plans-and-response-absent-http-terminals.md)
35. [Freeze Query Resource and React client integration](./0035-freeze-query-resource-and-react-client-integration.md)
36. [Freeze canonical Operation HTTP and OpenAPI projection](./0036-freeze-canonical-operation-http-and-openapi-projection.md)
37. [Freeze discriminated value TypeScript helpers](./0037-freeze-discriminated-value-helpers.md)
38. [Freeze basic MCP Operation projection](./0038-freeze-basic-mcp-operation-projection.md)
39. [Freeze projection-neutral Operation documentation](./0040-freeze-projection-neutral-operation-documentation.md)
40. [Freeze public package identities](./0042-freeze-public-package-identities.md)
41. [Freeze static Job schedules and Mutation checkpoints](./0043-freeze-static-job-schedules-and-mutation-checkpoints.md)
42. [Native React Query integration](./0044-native-react-query-integration.md)

## Proposed

- [Slice the beta.2 DX release](./0039-slice-the-beta-two-dx-release.md)
- [Collection `delete` kernel operation](./0047-collection-delete-kernel-operation.md)
- [Freeze local OpenAPI projection explanation](./0041-freeze-local-openapi-projection-explanation.md)
- [Freeze public testing surface](./0045-freeze-public-testing-surface.md)
- [MCP and canonical HTTP credential challenge](./0046-mcp-and-canonical-http-credential-challenge.md)
- [Compiler-owned database-level Collection and Field immutability](./0048-collection-database-immutability.md)

## Open decisions

The schema lifecycle, static composition, foundational data/structural Query,
executable Definition compiler, trusted Context Resolution, relational Policy,
Query, Mutation, Collection Operation, explicit lifecycle, Live Query, Change
Ledger, Transactional Dispatch, Reaction, Runtime, generated client, Execution
Envelope, minimal Studio, Service lifetime, raw Route/Fetch mounting, and Auth
composition contracts are accepted. Lifecycle job mapping, explicit Job
acceptance, and the shared Job/Reaction/Workflow durable kernel are also
accepted. Ten-instance correctness, PostgreSQL-only durable authority,
discardable cache/wake accelerators, and multiplexed SSE plus Fetch/POST are
accepted by ADR-0017. File metadata/byte separation, the
filesystem and S3-compatible byte seam, authorized Search projection, and
compiler-owned OpenAPI/MCP/skill outputs are accepted by ADR-0018. ADR-0019
freezes the shared semantic kernels, named factories, structural/app/package/
client exports, Live Query spelling, and optional capability bindings.
ADR-0020 accepts the portable agent router and review protocol, Bun/TypeScript
baseline, measured quality lanes, PostgreSQL CI, Knip ratchet, performance
harness, and guarded release path.
ADR-0025 removes the framework-owned Channel Resource, generated surface,
PostgreSQL event ledger/replay, presence model, and carrier binding while
preserving the collaboration fixture's ordinary `Channel` Collection.
ADR-0026 freezes Action as the external-invocation boundary, preserves
application-composed Route/Auth, and moves the accepted closed checkpoint,
timer, signal, and compatibility semantics into one Job Resource. Workflow and
`defineWorkflow` are no longer current or deferred public surface; Reaction
remains distinct over the shared durable kernel.
ADR-0027 makes the runnable tracer pull future delivery, separates Kernel
semantic acceptance from ordinary Product integration, timeboxes focused proof
construction, preserves tool-derived integrity digests, and removes manually
maintained proof/digest ledgers from living process prose.
ADR-0028 freezes required caller `effectKey` material, Runtime-scoped ordinary
Action Effect Identity, the exact semantic Action limits, additive Operation
Wire v3, and honest non-retryable post-dispatch ambiguity while retaining Wire
v1/v2 Query and Mutation compatibility.
ADR-0029 replaces the split `policy.exists` plus `query.*` Policy spelling with
one capability-branded `expr` vocabulary and Policy-only `expr.exists`. It
preserves Policy ownership, evidence nondisclosure, dependency capture, SQL
ordering, and the temporary Query-only `query` surface until the separate S7
migration.
ADR-0030 adds exact Field provenance and a distinct trusted `values` lane to the
existing internal Collection create/update kernel. Trusted values bypass only
caller Field authority; the fully merged candidate still passes the same
Policy, validation, constraint, receipt and transaction boundaries. It does not
publish automatic network CRUD or accept the deferred lifecycle redesign.
ADR-0031 resolves that lifecycle deferral with exactly `normalize`, `validate`,
`check`, and `afterWrite`; one canonical compiler-interpreted lifecycle
program; payloadless Collection issues; explicit Operation-owned issue mapping;
`ctx.now`; and database-owned `onUpdate: "now"`. It preserves Policy as the
sole authored authorization mechanism, one Mutation transaction, and one
generated Collection write kernel.
ADR-0032 supersedes ADR-0008's one-hop description and projected-`toMany`
deferral. Existing recursive-`toOne` Template v1 bytes remain readable and
emitted; one child-owned bounded `collection.list({ first, ... })` inverse
projection emits Template v2, shares one Policy-aware PostgreSQL statement,
and returns one exact readonly child array without nested cursor semantics.
ADR-0033 narrowly supersedes ADR-0014 only for the private Execution Envelope v1
event schema and fixed digest. It adds Execution Envelope v2's exact safe
allowlist, one private scoped observation kernel, one optional exact-peer
official OpenTelemetry adapter, and the non-rolling protocol-v8 durable
trace-link cutover. Observation remains lossy and non-authoritative; the
decision adds no authored telemetry capability, public event callback, general
provider SPI, audit truth, or implementation status. ADR-0035 later supersedes
only ADR-0033's then-current two-package release cardinality.
ADR-0034 narrowly repairs two incomplete ADR-0033 private-interface clauses.
Adapter extraction returns the complete continue/restart ingress trace plan,
and Fetch/Route terminals use an exact numeric-or-null response-status union so
pre-Response cancellation, deadline, or framework failure never invents an
HTTP response. No old decoder, second observation kernel, or compatibility path
is retained.
ADR-0035 adds `.observe(input)` only to compiler-proven watchable generated
Queries, keeps canonical Query Resource identity and bounded lifetime inside one
immutable generated Context scope, and accepts an optional exact-peer React
`useSyncExternalStore` adapter. It adds no fallback poller, Mutation
invalidation, global provider, second client cache, or polymorphic Relation
kernel. ADR-0042 supersedes only its package placement: the adapter now ships as
the `questpie/react` subpath. ADR-0044 subsequently supersedes that React
recommendation, not the neutral Query Resource contract.
ADR-0036 replaces the polymorphic Operation RPC endpoint with one
compiler-derived endpoint per network Query, Mutation, and Action. Generated
clients and optional OpenAPI 3.1 use the same Resource identities, codecs,
Context, outcomes, Policy, cancellation, and executor. It adds no authored HTTP
path, projection-specific schema or prose, compatibility endpoint, fallback,
or second handler.
ADR-0037 exports `DiscriminatedValue`, `DiscriminatedReference`, and
`matchDiscriminated` as ordinary TypeScript helpers. They preserve exhaustive
disjunction handling and branded reference IDs without creating a codec,
Relation, generated descriptor, Policy traversal, or Runtime polymorphism.
ADR-0038 adds one application-selected, stateless MCP `2026-07-28` Tools
projection at `POST /_questpie/mcp`. It derives every tool name, schema,
description, example, outcome, and binding from canonical documented network
Operations and invokes the same executor. It adds no MCP-specific authoring,
authority, retry, session, compatibility protocol, raw Route, Job control, or
second business kernel.
ADR-0040 adds one optional Operation-level `describe` envelope with required
summary, optional description, and codec-typed examples. The compiler owns one
relocation-stable documentation artifact and independent digest shared by
generated projections. It adds no codec or Field prose, projection-specific
authoring, Runtime authority, executable example, compatibility alias, or
application-specific generated skill.
ADR-0041 proposes one exact local JSON command for the compiler-owned OpenAPI
projection explanation. It would print the existing canonical explanation
artifact unchanged after complete checksum and cross-pin verification, without
source evaluation, Runtime or database access, a CLI-owned envelope, or a
broader Resource/operational explain surface.
ADR-0042 replaces the scoped React and OpenTelemetry package placement with
exactly two public npm packages: `questpie` and
`questpie-opentelemetry`. It deletes the old identities without aliases or
fallback resolution while preserving both accepted projection kernels.
ADR-0044 accepts the optional `questpie/react-query` native factory, inferred
options and conservative non-live invalidation, scope retirement and native
Start SSR/hydration. It replaces the old React hook/export after consumer
migration without an alias. Neutral Query Resources, package cardinality and
server contracts remain unchanged. Framework-owned optimism, live infinite,
TanStack DB and offline/persistence remain outside beta.2. Its committed
architecture PASS does not certify production extraction or aggregate release.
ADR-0021 accepted the connected beta.1 slice: compiler through minimal Studio,
including Service lifetime, watched Query, one committed-fact Reaction, and
explicit absence stories for later breadth. ADR-0024 removes the Studio path
and parity gate from beta.1 and re-scopes BETA-09 as backend-only maintenance
compatibility.
ADR-0022 keeps named factories, preserves exact Resource Identity, accepts
nested-only generated server Operation calls, closes their leaf/prefix and
final-`then` diagnostics, and publishes the permanent capability ownership map.
ADR-0023 preserves Operation Wire v1 and accepts the versioned framework
post-commit outcome, exact recovery identities, and general bounded Call
Identity text.
ADR-0024 defers Studio until one useful privileged administration workflow and
its Principal, Policy/Authority and disclosure contract are accepted.
Complete Job checkpoint implementation, split Runtime roles, host/provider
SPIs, and remote/fleet Studio remain later verticals.
Migration execution and Package Augmentation through the connected Runtime
remain implementation gates, not newly accepted syntax.

An accepted ADR does not authorize implementation outside the current tracer.
ADR-0027's executable process and delivery scorecard live in
[`docs/v4/DELIVERY-FLOW.md`](../v4/DELIVERY-FLOW.md).
