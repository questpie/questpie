# QUESTPIE v4 beta.2 release scope candidate

- Status: candidate table for Proposed ADR-0039
- Release: `4.0.0-beta.2`
- Rule: a row is included only after its authority, implementation, tracer,
  documentation, package, and review evidence all pass

This table is the planning inventory. It does not project unfinished behavior
into public documentation.

| Capability                                                       | Release owner                              | Required artifact or package                                           | Reference consumer                  | Release evidence                                                               | Candidate state                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Existing beta.1 core plus lifecycle, Action, Route/Auth, and Job | `questpie`                                 | generated App/Runtime/client and protocol artifacts                    | Collaboration and Team Support Desk | retained PostgreSQL/browser/release gates                                      | complete                                                                        |
| Discriminated value/reference helpers                            | `questpie`                                 | `DiscriminatedValue`, `DiscriminatedReference`, `matchDiscriminated`   | public recipes and packed consumer  | type inference, package exports, no codec/Relation companion                   | complete                                                                        |
| Query Resource                                                   | compiler and generated client              | compiler-proven `.observe(input)` and bounded Context-scope registry   | Collaboration hostile client        | PostgreSQL/Firefox authority, replacement, eviction, cancellation, lifetime    | complete; executable prototype deleted                                          |
| React Query Resource adapter                                     | `@questpie/react`                          | exact-peer `useQueryResource`                                          | Team Support Desk                   | React 19 types, browser behavior, clean install, peer mismatch                 | complete                                                                        |
| Inverse Relation selection                                       | relational compiler and PostgreSQL Runtime | artifact v2, generated contract, one SQL/decoder path                  | Team Support Desk and Collaboration | nested grammar, Policy/nondisclosure, direct/network/browser parity            | complete through INV-06                                                         |
| Runtime observation                                              | `questpie`                                 | accepted Envelope v2 and protocol v8                                   | Collaboration                       | complete owner census, faults, durable links, two instances                    | complete                                                                        |
| OpenTelemetry projection                                         | `@questpie/opentelemetry`                  | exact-peer SDK adapter and CLI binding                                 | Team Support Desk and Collaboration | real OTLP browser/hostile graph, disclosure, cleanup, package parity           | complete through OTEL-08                                                        |
| Canonical Operation HTTP                                         | compiler and Runtime ingress               | per-Operation Query/Mutation/Action endpoints                          | generated client                    | credentials, Context, identities, cancellation, nondisclosure, no old endpoint | complete; no polymorphic endpoint or fallback                                   |
| Operation documentation                                          | compiler                                   | projection-neutral documentation artifact and digest                   | OpenAPI, MCP, declarations, explain | Package/application parity, escaping, stale deletion, no Runtime prose read    | complete through DOC-02; MCP consumption remains excluded                       |
| OpenAPI 3.1                                                      | compiler                                   | canonical `openapi.json` and explain inventory                         | Team Support Desk with Scalar UI    | carrier/codec parity, deterministic output, stale deletion, browser rendering  | complete; Scalar hides and injects only the exact compatibility trio            |
| Basic MCP                                                        | compiler and Runtime ingress               | canonical catalogue/binding and `POST /_questpie/mcp`                  | current-protocol MCP client         | schema/outcome parity, Policy hostiles, cancellation, no retry/fallback        | Proposed candidate; informal audit repairs and fresh formal acceptance pending  |
| Public framework skill                                           | repository `skills/` tree                  | portable Agent Skills directory plus referenced released docs/examples | clean external agent workspace      | format validation, no internal pointers, packed-example compile                | standard research complete; authoring waits for released syntax                 |
| Public beta.2 documentation                                      | docs application                           | versioned release inventory and finished guides                        | human and agent readers             | links, snippets, package existence, docs typecheck/build                       | blocked by included verticals                                                   |
| Aggregate release                                                | release tooling                            | three exact-peer tarballs and release manifest                         | relocated clean consumer            | PostgreSQL/browser, `quality:release`, two byte-identical dry-runs             | implemented three-package subset green; beta.2 remains blocked by MCP and skill |

## Current aggregate evidence

The implemented three-package subset passes PostgreSQL 17 and Firefox reference
and hostile tracers, `quality:release`, strict package checks, the docs build,
and two byte-identical isolated dry-runs. The current tarball SHA-256 values are
`dd21a98ad45121d679db93458b7d4e6a0f4498146b2a8fcbc41bdbb136236518`
for `questpie`, `924829aaf4b4a4b83cdc9326a134651c018dfb49e55dea00319bc7e250f7eda0`
for `@questpie/react`, and
`e27ba51aa0c6a9249c5850f3cfb276c7063ff10ebc55106162833bbd349e718d`
for `@questpie/opentelemetry`.

This does not accept or release MCP. ADR-0038 remains Proposed after its one
permitted formal review returned terminal `NO_RESULT`, and ADR-0039/public skill
release remains downstream of that authority. No retry, fallback reviewer,
authority projection, push, tag, publish, or deployment occurred.

## Explicit exclusions

| Exclusion                                      | Reason                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Polymorphic Relation/codec/descriptor/registry | the accepted DX is ordinary TypeScript discriminant helpers; application storage shape remains an application choice          |
| `Workflow` Resource or factory                 | accepted checkpointed work belongs to Job                                                                                     |
| Autopilot implementation                       | downstream product work; this release supplies only a precise framework inventory for its later migration and landing handoff |
| Files, Search, Studio, split Runtime roles     | outside the frozen beta.2 tracer scope                                                                                        |
| compatibility transports or fallback behavior  | beta.2 replaces obsolete paths and keeps one owner per kernel                                                                 |
