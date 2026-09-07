# QUESTPIE v4 beta.2 release scope candidate

- Status: candidate table for Proposed ADR-0039
- Release: `4.0.0-beta.2`
- Rule: a candidate row enters the release only after its authority, implementation, tracer,
  documentation, package, and review evidence all pass

This table separates the completed pre-schedule implementation baseline from
the static-schedule and Mutation-checkpoint extension proposed by
[ADR-0043](../adr/0043-freeze-static-job-schedules-and-mutation-checkpoints.md).
Rows marked complete record that baseline; they do not establish final
verification of the extended candidate. ADR-0039 and ADR-0043 remain Proposed.
This inventory does not project unfinished behavior into public documentation.

| Capability                                                       | Release owner                              | Required artifact or package                                           | Reference consumer                  | Release evidence                                                                                                   | Candidate state                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Existing beta.1 core plus lifecycle, Action, Route/Auth, and Job | `questpie`                                 | generated App/Runtime/client and protocol artifacts                    | Collaboration and Team Support Desk | retained PostgreSQL/browser/release gates                                                                          | complete                                                                                              |
| Static UTC Job schedules and minimum named-Mutation checkpoints  | compiler and durable Runtime               | schedule artifacts, protocol v9, generated checkpoint references       | Team Support Desk and Collaboration | activation/removal, ten-contender ticks, finite bounds, receipt recovery, retained executables, PostgreSQL/browser | implemented candidate under Proposed ADR-0043; final gates and formal PASS pending                    |
| Discriminated value/reference helpers                            | `questpie`                                 | `DiscriminatedValue`, `DiscriminatedReference`, `matchDiscriminated`   | public recipes and packed consumer  | type inference, package exports, no codec/Relation companion                                                       | complete                                                                                              |
| Query Resource                                                   | compiler and generated client              | compiler-proven `.observe(input)` and bounded Context-scope registry   | Collaboration hostile client        | PostgreSQL/Firefox authority, replacement, eviction, cancellation, lifetime                                        | complete; executable prototype deleted                                                                |
| React Query Resource adapter                                     | `questpie/react`                           | `useQueryResource` with an optional React 19 peer                      | Team Support Desk                   | React 19 types, browser behavior, clean install, peer mismatch                                                     | complete                                                                                              |
| Inverse Relation selection                                       | relational compiler and PostgreSQL Runtime | artifact v2, generated contract, one SQL/decoder path                  | Team Support Desk and Collaboration | nested grammar, Policy/nondisclosure, direct/network/browser parity                                                | complete through INV-06                                                                               |
| Runtime observation                                              | `questpie`                                 | accepted Envelope v2 and durable trace links introduced by protocol v8 | Collaboration                       | complete owner census, faults, durable links, two instances                                                        | complete                                                                                              |
| OpenTelemetry projection                                         | `questpie-opentelemetry`                   | exact-peer SDK adapter and CLI binding                                 | Team Support Desk and Collaboration | real OTLP browser/hostile graph, disclosure, cleanup, package parity                                               | complete through OTEL-08                                                                              |
| Canonical Operation HTTP                                         | compiler and Runtime ingress               | per-Operation Query/Mutation/Action endpoints                          | generated client                    | credentials, Context, identities, cancellation, nondisclosure, no old endpoint                                     | complete; no polymorphic endpoint or fallback                                                         |
| Operation documentation                                          | compiler                                   | projection-neutral documentation artifact and digest                   | OpenAPI, MCP, declarations, explain | Package/application parity, escaping, stale deletion, no Runtime prose read                                        | complete through DOC-02; shared by OpenAPI and MCP                                                    |
| OpenAPI 3.1                                                      | compiler                                   | canonical `openapi.json` and explain inventory                         | Team Support Desk with Scalar UI    | carrier/codec parity, deterministic output, stale deletion, browser rendering                                      | complete; Scalar hides and injects only the exact compatibility trio                                  |
| Basic MCP                                                        | compiler and Runtime ingress               | canonical catalogue/binding and `POST /_questpie/mcp`                  | strict current-protocol MCP client  | schema/outcome parity, Policy hostiles, cancellation, no retry/fallback                                            | complete through MCP-03                                                                               |
| Public framework skill                                           | repository `skills/` tree                  | portable Agent Skills directory plus referenced released docs/examples | clean external agent workspace      | format validation, no internal pointers, packed-example compile                                                    | complete; packed example and negative portability gates pass                                          |
| Public beta.2 documentation                                      | docs application                           | versioned release inventory and finished guides                        | human and agent readers             | links, snippets, package existence, docs typecheck/build                                                           | pre-schedule content complete; schedule guide remains an internal draft; authority projection pending |
| Aggregate release                                                | release tooling                            | two same-version tarballs and release manifest                         | relocated clean consumer            | PostgreSQL/browser, `quality:release`, two byte-identical dry-runs                                                 | pre-schedule implementation complete; extended candidate gates and ADR-0043/ADR-0039 PASS pending     |

## Current aggregate evidence

The preserved pre-schedule acceptance manifest excludes Cron and cannot cover
this extension. ADR-0043 requires its own committed, verified formal PASS before
its authority is projected. The extended beta.2 scope then needs a fresh
aggregate manifest and ADR-0039 acceptance. Full integrated PostgreSQL 17 and
browser lanes, affected load/soak gates, `quality:release`, exact package artifact
bindings, two consecutive byte-identical release dry-runs, and independent
Standards and Spec reviews remain required on the final candidate. Earlier
passes do not close unresolved failures in that candidate.

The extension advances the internal PostgreSQL protocol to v9 through an
explicit non-rolling cutover. Incompatible Runtime instances must stop before
the upgrade; existing v8 observation data and immutable protocol history remain
preserved. Migration does not activate schedules. The exact upgrade and
acknowledgement rules belong to Proposed ADR-0043.

The [scheduled-job guide draft](./research/static-job-schedules/PUBLIC-GUIDE-DRAFT.md)
remains internal until ADR-0043 has a committed, verified formal PASS and its
deployment wording matches the final release cut. Public documentation for the
extension is therefore incomplete; the latest-release projection also waits
for ADR-0039 PASS.

The accepted package-identity inventory for the beta.2 candidate is `questpie`, including
`questpie/react`, and `questpie-opentelemetry`. Both packages advance at the
same version. The two-package migration must produce new measured archive and
declaration digests; the previous three-package digests do not describe this
candidate.

ADR-0038 accepts the basic MCP boundary after a human-directed replacement
Codex panel found and closed malformed-envelope, unknown-method, and
serialization-fault gaps. The preserved record states that it is not a
protocol-v2 Opus PASS and does not add a fallback to the acceptance wrapper.
MCP-01 through MCP-03 now pass compiler, Runtime, Package, PostgreSQL 17,
Firefox, cancellation, uncertainty, replay, nondisclosure, and hostile
observation evidence. Their small strict test client speaks exactly the accepted
`2026-07-28` protocol; it is not a claim that an older published SDK revision is
compatible. The portable public skill passes format, link, portability,
negative-import, and all referenced-example compilation gates. ADR-0039
remains Proposed until its own manifest-bound review passes. No push, tag,
publish, or deployment occurred.

## Explicit exclusions

| Exclusion                                      | Reason                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Polymorphic Relation/codec/descriptor/registry | the accepted DX is ordinary TypeScript discriminant helpers; application storage shape remains an application choice          |
| `Workflow` Resource or factory                 | accepted checkpointed work belongs to Job                                                                                     |
| Autopilot implementation                       | downstream product work; this release supplies only a precise framework inventory for its later migration and landing handoff |
| Files, Search, Studio, split Runtime roles     | outside the frozen beta.2 tracer scope                                                                                        |
| compatibility transports or fallback behavior  | beta.2 replaces obsolete paths and keeps one owner per kernel                                                                 |
