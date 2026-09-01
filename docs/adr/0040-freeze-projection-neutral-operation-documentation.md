# ADR-0040: Freeze projection-neutral Operation documentation

- Status: Proposed
- Date: 2026-09-02
- Owners: Product architecture, compiler, generated projections

## Context

ADR-0036 derives HTTP paths, methods, schemas, outcomes, and handlers from the
App Contract. It deliberately defers human-facing prose and examples because
adding them only to OpenAPI would create a second contract. The same prose is
also useful in generated declarations, public documentation, and the proposed
MCP catalogue.

The current Operation factories have no documentation slot. Query and Mutation
composition can drop an unknown member when non-literal or untyped authoring
escapes TypeScript, so a misspelling could appear to work while emitting
nothing; Action discovery is already closed. Codecs are closed reusable value
grammars; attaching prose to them would change every codec consumer and make one
description leak into unrelated Operations.

## Proposed decision

Query, Mutation, and Action Definitions may carry one optional
projection-neutral member:

```ts
describe: {
	summary: "Close an open ticket",
	description: "Returns the committed ticket state.",
	examples: [{ input: { id }, output: { id, status: "closed" } }],
}
```

`summary` is required when `describe` is present. `description` and `examples`
are optional. Every example explicitly contains `input`, including `{}` for an
empty-input Operation; `output` is optional. Examples are typed from that
Operation's existing input and output codecs, introduce no schema language, and
never execute. Collection Operation Set `list`, `get`, `create`, `update`, and
`delete` members use the same shape at the member that establishes the generated
Operation. Member-level closure admits `describe` and rejects every other new
member.

All Operation Definition shapes become closed. An unknown member fails at its
Origin instead of being ignored. No codec, Field, Collection, Context, error,
Route, Job, or application configuration metadata member is introduced.

The compiler validates examples through the existing codecs and canonical wire
encoder. Cursor values are forbidden because only Runtime can mint a valid
digest-bound cursor. Example output may be omitted. Examples are synthetic
documentation data, never requests, fixtures, Seeds, authorization facts, or
handler inputs.

`summary` is NFC plain text, one line, 1–120 Unicode scalars. `description` is
NFC plain text, 1–1,024 Unicode scalars. Leading/trailing whitespace, lone
surrogates, C0, DEL, C1 controls other than line feed in `description`, Unicode
line/paragraph separators in `summary`, and bidi directional controls fail. The
compiler escapes each target format; prose
does not become executable source or authority. Total canonical example bytes
are bounded to 4,096 per Operation and remain inside the generated-byte budget.

## Artifact and digest boundary

The compiler emits `operation-documentation.json` with format
`questpie.operation-documentation`, version 1, ASCII-sorted Resource identities,
validated prose, and canonical wire examples. Origin stays in the compiler's
explain/source index and outside these semantic bytes, so relocating an
unchanged Definition does not churn the documentation digest. Its
domain-separated digest is independent of Client Contract, Operation Wire,
Schema Projection, and Schema Fingerprint digests. A prose-only change therefore
cannot invalidate a generated client or plan a database migration.

OpenAPI, MCP, generated declaration documentation, explain output, and any
future application-specific skill projection pin this documentation digest next
to their semantic source digests. OpenAPI places the pin at compiler-owned
`info.x-questpie-operation-documentation-digest`, changing none of its four
accepted top-level members. The canonical HTTP adapter and Runtime do not read
the artifact at request time.

OpenAPI projects `summary`, `description`, and schema-valid examples. MCP maps
the summary to optional `title` and summary plus description to `description`.
Any MCP risk hint is derived only from accepted Operation kind semantics, never
from `describe`; documentation never grants Authority, changes Policy, or
justifies Mutation/Action risk annotations. MCP prose is model-facing
application instruction. This contract claims bounded structural safety and no
content filter or compiler-proven prompt purity. Generated JSDoc is emitted from
this artifact and is never extracted from authored comments.

The planned public repository skill at `skills/questpie` is a portable framework
authoring skill. It is not generated from application prose. An
application-specific generated skill remains a named later consumer of this
artifact rather than beta.2 scope.

## Failure and disclosure semantics

Invalid text, an unknown Operation member, codec-mismatched or noncanonical
examples, cursor examples, or byte-limit overflow are fatal compile diagnostics
with the exact Origin and member path. Diagnostics disclose no example values.
Package and application Origins remain visible in explain output.

The registered fatal diagnostic is:

| Code             | Class                  | Closed reasons                                                                                                                                              |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QP-COMPOSE-030` | `invalidDocumentation` | `unexpectedOperationMember`, `missingSummary`, `invalidText`, `missingExampleInput`, `exampleCodecMismatch`, `runtimeMintedExample`, `exampleLimitExceeded` |

Descriptions are application-authored public contract data. They may explain
domain purpose but must not claim access the caller's Policy does not grant.
They do not reveal Policy evidence or make a hidden Operation discoverable:
each projection still follows its own accepted exposure selection.

## Supersession ledger

This decision fills only ADR-0036's explicit descriptive-metadata deferral and
adds closed member admission to Query, Mutation, Action, and the five Collection
Operation Set members. It does
not change canonical codecs, Operation execution, network exposure, HTTP paths,
OpenAPI schema ownership, Policy, Runtime, or the public skill format. It
rejects projection-specific prose and codec-level examples as candidates rather
than superseding an Accepted surface.

## Acceptance

ADR-0040 remains Proposed until executable evidence and an independent review
prove exact type inference, closed member admission, text and example
validation, canonical bytes/digest separation, Origin-safe diagnostics,
OpenAPI/MCP/JSDoc consumption, Package parity, relocation, stale deletion, and
the absence of codec metadata, projection-specific prose, Runtime reads,
fallbacks, or application-specific skill generation.

No ADR index, SPEC, CONTEXT, public documentation, or HANDOFF projection may
describe this decision as Accepted before a committed PASS record exists.
