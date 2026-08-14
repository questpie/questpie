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

## Open decisions

The schema lifecycle, static composition, foundational data/structural Query,
executable Definition compiler, trusted Context Resolution, relational Policy,
Query, Mutation, Collection Operation, explicit lifecycle, Live Query, Change
Ledger, Transactional Dispatch, Reaction, Runtime, generated client, Execution
Envelope, minimal Studio, Service lifetime, raw Route/Fetch mounting, and Auth
composition contracts are accepted. Lifecycle job mapping, explicit Job
acceptance, and the shared Job/Reaction/Workflow durable kernel are also
accepted. Ten-instance correctness, PostgreSQL-only durable authority,
discardable cache/wake accelerators, multiplexed SSE plus Fetch/POST, and typed
Channel ownership are accepted by ADR-0017. File metadata/byte separation, the
filesystem and S3-compatible byte seam, authorized Search projection, and
compiler-owned OpenAPI/MCP/skill outputs are accepted by ADR-0018. ADR-0019
freezes the shared semantic kernels, named factories, structural/app/package/
client exports, Channel/Live Query spelling, and optional capability bindings.
ADR-0020 accepts the portable agent router and review protocol, Bun/TypeScript
baseline, measured quality lanes, PostgreSQL CI, Knip ratchet, performance
harness, and guarded release path.
ADR-0021 accepts the connected beta.1 slice: compiler through minimal Studio,
including Service lifetime, watched Query, one committed-fact Reaction, and
explicit absence stories for later breadth.
Complete Workflow, Action, split
Runtime roles, host/provider SPIs, and remote/fleet Studio remain later
verticals.
Migration execution and Package Augmentation through the connected Runtime
remain implementation gates, not newly accepted syntax.

An accepted ADR does not authorize implementation outside the current tracer.
