# ADR-0049: MCP `outputSchema` becomes opt-in; drop `inputSchema`'s top-level `$schema` by default

- Status: Proposed
- Date: 2026-09-23
- Owners: Product architecture, compiler, MCP projection
- Ticket: owner-directed schema diet, 2026-09-23 — see
  `autopilot-worktrees/v4-r1` (Autopilot repo, branch `feat/v4-r1-reference`)
  `docs/architecture/v4-mcp-catalogue-size-research-2026-09-22.md` for the
  measurement this decision acts on.

## Context

ADR-0038 makes the MCP `tools/list` catalogue derive a compiler-owned closed
`oneOf` `outputSchema` for every tool: one success frame plus one branch per
declared and framework error the Operation can produce. On this repository's
own `fixtures/team-support-desk` (12 tools, compiled with
`{ "projections": { "mcp": true } }`, measured as the compact-JSON `tools`
array inside `tools/list`'s `result.tools`), that catalogue is **91,704
bytes**, averaging 7,642 bytes/tool. Re-measuring per field on this same
fixture, `outputSchema` alone accounts for the overwhelming majority of that
weight (consistent with the Autopilot research pass's independent 12-tool
sample, where `outputSchema` was 83.6% of 75,222 bytes) — it is a `oneOf` of
8–15 largely-repeated framework failure frames
(`DEADLINE_EXCEEDED`, `RESOURCE_LIMIT`, `COMMITTED_RESULT_UNAVAILABLE`, ...)
per tool, most of which are shared framework shapes, not Operation-specific
content.

The MCP `2026-07-28` specification lists `outputSchema` as **optional**
(`inputSchema` is required; `outputSchema` carries no such requirement). This
is a lever the MCP protocol already grants and ADR-0038 chose not to use. The
research pass separately confirmed no MCP wire-level "send schema on demand"
primitive exists (pagination only changes how many _tools_ are visible per
page, not per-tool bytes; `tool_search_tool_*`/`defer_loading` is a
Messages-API context-window optimization that still requires the full
`tools/list` catalogue to already be on the wire) — dropping `outputSchema`
outright is the only lever that acts on wire bytes directly, and it is the
cheapest one available: on this fixture, the default configuration below
(`outputSchema` dropped, `inputSchema` losing only its top-level `$schema`)
saves **84.3%** of the catalogue (measured below).

One smaller, independent lever stacks with it. `$schema` is a fixed 56-byte
`"https://json-schema.org/draft/2020-12/schema"` string repeated on every
`inputSchema` and (previously) every `outputSchema` — it identifies the JSON
Schema dialect, not a per-tool fact, and MCP `2026-07-28` does not require a
tool schema to declare it; an absent `$schema` is universally treated as
2020-12 by JSON Schema tooling, which is the only dialect this compiler ever
emits.

An earlier draft of this ADR also proposed dropping the `pattern` on
`format: "uuid"` fields, reasoning that `format` alone already asserted the
same constraint. **That reasoning was wrong and the change was reverted before
acceptance** — see "Uuid `pattern` is kept, not dropped" below. `inputSchema`
therefore loses only its own top-level `$schema` key; every codec-derived
schema underneath it, uuid fields included, is untouched.

The owner decided 2026-09-23 to take this schema diet: **`outputSchema`
becomes opt-in and defaults off**; the `$schema` trim applies to what remains
always-on (`inputSchema`, at its own top level only).

## Proposed decision

`tools/list` no longer includes a tool's `outputSchema` by default. The
application config gate that already exists for MCP as a whole
(`projections.mcp`, ADR-0038) grows one nested opt-in, following the same
config shape the codebase already uses for a nested option block (e.g.
`postgres`'s sibling keys):

```json
{ "projections": { "mcp": true } }
```

remains exactly today's default-off shape (no `outputSchema` emitted, and
`true` is still accepted verbatim — this is not a breaking config rename).
An application that wants the ADR-0038 `outputSchema` back, in full, opts in
per application (not per Operation — see "Why global, not per-Operation"
below) with:

```json
{ "projections": { "mcp": { "outputSchema": true } } }
```

`projections.mcp` accepts exactly `true` or `{ "outputSchema": true }`; any
other shape — a wrong-valued `outputSchema`, an `outputSchema` key missing
from the nested object, or an unknown sibling key under `projections.mcp` —
is a compile-time `QP-COMPOSE-017 invalidApplicationRoot` diagnostic with the
message `projections.mcp must be true or { outputSchema: true }` (unknown-key
shapes get the sibling `projections.mcp has unknown key <name>` message every
other `questpie.json` block already uses), matching every other
`questpie.json` validation in `packages/compiler/src/index.ts`. There is no
per-Operation `mcp` member or per-Operation `outputSchema` override — ADR-0038
already forbids per-Operation MCP authoring in the basic slice
("no per-Operation `mcp` member or compatibility spelling exists in the basic
slice"), and this ADR does not reopen that.

When `outputSchema` is included (opt-in), it is produced by the exact same
code ADR-0038 specified and is **byte-identical to today's `outputSchema`**:
same closed `oneOf`, same top-level `$schema` declaration, same `uuid`
`format`+`pattern` pair on every branch that carries a uuid-typed field. This
ADR does not redesign `outputSchema`'s content or encoding — the `$defs`/`$ref`
de-duplication design the research pass also scoped (61.6% saved, keeps
validation value) is a _different_, not-yet-decided lever and is explicitly
out of scope here (see "Alternatives rejected"). Opting in trades bytes for
today's exact fidelity; it is not a smaller, redesigned `outputSchema`. The
acceptance test suite proves this against a golden fixture captured directly
from the pre-ADR-0049 compiler, not merely against this ADR's own
implementation — see "Measured effect" below.

Independent of that opt-in, every tool's `inputSchema` (which is always
emitted — the MCP spec requires it) drops exactly one thing, unconditionally,
regardless of the `outputSchema` setting: its own **top-level `$schema` key**.
`tools/list` never places a top-level `$schema` on `inputSchema`, whether or
not `outputSchema` is opted in — the two schemas are independent objects, and
opting into `outputSchema` does not restore `inputSchema`'s `$schema`. Nothing
else about `inputSchema` changes: every codec-derived field underneath it —
`uuid` fields included, with both `format` and `pattern` — is exactly what
`projectOperationCodecSchema` (the same function the canonical HTTP/OpenAPI
projection, ADR-0036, also uses) already produced. `inputSchema` is
codec-exact apart from that one omitted top-level key.

### Uuid `pattern` is kept, not dropped

A pre-acceptance draft of this ADR additionally proposed dropping the
`pattern` on `format: "uuid"` fields, on the reasoning that `format` alone
already asserted the same constraint. Adversarial review (2026-09-23)
found that reasoning false on two independent grounds, and the change was
reverted before this ADR was accepted:

- **`format` is annotation-only in JSON Schema 2020-12.** The 2020-12
  specification does not require implementations to treat `format` as an
  assertion; a compliant validator may accept any string for
  `format: "uuid"` without checking it looks like a UUID at all. `pattern`
  is the only keyword in this schema that is a real, universally-enforced
  assertion. Dropping it would not have removed a duplicate constraint — it
  would have removed the only constraint most validators actually enforce.
- **RFC 4122 and this codec disagree on case.** RFC 4122 permits uppercase
  hex digits in a UUID's textual form; this framework's uuid codec
  (`packages/runtime/src/codec/index.ts`) and its MCP/OpenAPI schema
  projection (`packages/compiler/src/operation-projection/schema.ts`) both
  accept lowercase only (`^[0-9a-f]{8}-...$`). A client relying on
  `format: "uuid"` alone (per RFC 4122) could construct an uppercase value
  that validates against the advertised schema and is then rejected by the
  real codec at call time — a real, avoidable client-visible correctness
  regression, not merely a cosmetic one.

Dropping `pattern` would also have broken ADR-0038's Acceptance item 2,
"codec-exact JSON Schema 2020-12 input" — `inputSchema` is supposed to be an
exact projection of the Operation's input codec, and the lowercase-only
constraint is part of that codec. This ADR keeps that acceptance item intact:
`inputSchema` is unconditionally codec-exact, with the sole documented
exception of the top-level `$schema` key.

### What an MCP client loses, and why it is acceptable

An MCP client that previously validated a `tools/call` result's
`structuredContent` against the advertised `outputSchema` (the spec: "Clients
**SHOULD** validate structured results against this schema") can no longer do
so by default — there is nothing to validate against unless the application
opts in. This is a real capability loss, not a cosmetic one. It is judged
acceptable for the default because:

- The MCP spec itself makes `outputSchema` optional; a client that treats a
  missing `outputSchema` as "cannot validate, proceed anyway" is already
  spec-conformant behavior, not a client the server needs to route around.
- Nothing about **executing** a tool call changes. Every call still creates a
  fresh Execution and returns the same canonical `structuredContent`
  (success or declared/framework error) that `outputSchema` would have
  described — `encodeOperationResult`
  (`packages/runtime/src/application/mcp-operation.ts`) computes that content
  independent of whether `outputSchema` was advertised; runtime behavior,
  error frames, and disclosure rules are unaffected by this ADR (see
  "Runtime error boundary is unchanged" below).
- The gap is real but narrow: it is _client-side pre-validation convenience_
  and _model-visible structured-output hinting_, not authorization, not
  transport safety, not error-shape stability — none of which ADR-0038 ever
  let `outputSchema` govern in the first place ("No annotation, description,
  tool-list membership, model confirmation, or MCP credential scope grants
  Authority or replaces Policy").
- Any application that has a real, measured need for that validation gets it
  back with the one-line opt-in, at today's exact fidelity, with no
  compatibility shim or second code path to maintain.

### Why global, not per-Operation

The smallest opt-in surface consistent with the framework's existing
`questpie.json#projections` config style is one additional boolean-shaped key
nested under the existing `projections.mcp` gate — the same shape
`projections` itself already uses for its two top-level members
(`openapi`/`mcp`), and the same "exact keys, `true`-only, or reject" validation
every other `questpie.json` block in `packages/compiler/src/index.ts` already
applies (see `postgres`, `source`). A per-Operation opt-in
(a hypothetical `mcp: { outputSchema: true }` argument on an individual
`defineQuery`/`defineMutation`/`defineAction`) was considered and rejected:
ADR-0038 already froze "no per-Operation `mcp` member or compatibility
spelling"; reopening that for one narrow byte-budget knob would recreate the
exact per-Operation authoring surface ADR-0038 was written to prevent, for a
decision (validation strictness) that is naturally an application-wide
posture, not a per-tool one. An application that wants some tools with full
validation and others without it can still get that by _not_ opting in and
running its own client-side validation for the specific tools it cares about
using the codec information it already has server-side (the OpenAPI
projection, or its own compiled Operation contracts) — this ADR does not need
to invent a second server-side mechanism for that.

### Runtime error boundary is unchanged

This ADR touches only `packages/compiler/src/mcp/index.ts` (tool assembly)
and `packages/runtime/src/application/mcp/artifact.ts` (the artifact decoder,
which must stop requiring `outputSchema` to always be present). It does not
touch `packages/runtime/src/application/mcp-operation.ts` (the executor) or
`packages/runtime/src/application/mcp/index.ts` (the ingress/dispatch). ADR-
0038's failure boundary is unchanged, verified by inspection: declared and
framework Operation outcomes remain ordinary tool results
(`structuredContent` plus `isError: true`, computed by `encodeOperationResult`
independent of the advertised `outputSchema`); only unknown tools, malformed
MCP envelopes, and MCP server protocol failures use JSON-RPC errors (`-32601`
unknown method, `-32602` invalid params such as an unknown tool name,
`-32020`/`-32022` for header/body ambiguity and unsupported protocol
versions) — exactly ADR-0038's existing split, confirmed unchanged by reading
`mcp-operation.ts` and `mcp/index.ts` line by line for this ADR and by the
unmodified `tests/unit/mcp02-operation-adapter.test.ts` /
`tests/integration/postgres/mcp-credential-gate.test.ts` suites passing
against the new default.

### Compiler artifact and explain boundary

The compiler's MCP catalogue/runtime-binding artifact format
(`format: "questpie.mcp-projection"`, its digest, and
`questpie explain projection mcp`) is unchanged in shape; a tool binding's
`tool` record simply omits the `outputSchema` key when not opted in, the same
pattern the artifact already uses for `title`/`description` (present only
`hasDocumentation`) and `annotations` (present only for `kind: "query"`).
`packages/runtime/src/application/mcp/artifact.ts`'s `decodeMcpProjection`
now treats `outputSchema` as present-when-present rather than
always-required, validating its shape only when the key exists — an
`inputSchema`-only tool binding is not itself invalid runtime state. Every
tool in one catalogue must agree on presence: either all carry `outputSchema`
or none do (`decodeMcpProjection` fails closed on a mixed catalogue). This
matches the config surface, which is an application-wide posture, not a
per-Operation one — a hand-tampered or otherwise-inconsistent artifact is
rejected rather than silently accepted with partial coverage.

### Compatibility posture

The artifact's `format`/`version` pair stays `"questpie.mcp-projection"`/`1`
— this is not a wire format redesign, only an additive change to which keys
one tool binding inside it carries. Concretely:

- **A runtime built from this ADR decodes an artifact compiled by the
  pre-ADR-0049 compiler without modification.** That artifact has
  `outputSchema` present on every tool (the old, unconditional default); the
  new `decodeMcpProjection`'s per-tool `hasOutputSchema` branch takes the
  "present" path uniformly across all tools, satisfies the new all-or-none
  check, and validates every `outputSchema`'s shape exactly as before.
- **A runtime built from before this ADR fails closed on an artifact compiled
  by this ADR's default (`outputSchema` absent).** The old
  `decodeMcpProjection` calls `exact(tool, ["name", "inputSchema",
"outputSchema", ...])` unconditionally — `exactRuntimeArtifactKeys` requires
  the tool's actual key set to match that list exactly, in both directions.
  An `outputSchema`-absent tool fails that check and `decodeMcpProjection`
  throws (`failRuntimeArtifact`) rather than silently mounting a
  partially-understood catalogue.
- **This skew is not a real deployment concern in practice.** The compiler
  (`@questpie/compiler`) and the runtime (`@questpie/runtime`) are both
  private workspaces bundled into the single public `questpie` package
  (ADR-0042); an application always compiles with and decodes against the
  exact same installed `questpie` version in the same build. There is no
  published API boundary across which an old runtime could ever receive a
  new compiler's artifact, or vice versa, and this ADR does not introduce
  one. The two bullets above describe what would happen if that boundary
  existed (e.g. a stale `.questpie/generated` directory surviving a partial
  upgrade) — fail-closed, not a silent misread — not a supported
  cross-version integration this ADR is adding.

## Measured effect on `fixtures/team-support-desk`

Measured by compiling the fixture (12 tools, real committed migrations,
`DATABASE_URL`-free compiler measurement — no PostgreSQL needed for this
number) and computing `Buffer.byteLength(JSON.stringify(tools.map(t =>
t.tool)))` — the same bytes that land inside `tools/list`'s
`result.tools` array, independently reproduced by the acceptance evidence
this ADR ships with (`tests/unit/mcp01-compiler-catalogue.test.ts`):

| Configuration                                      | Tools array bytes | Bytes/tool (avg) | vs. today  |
| -------------------------------------------------- | ----------------- | ---------------- | ---------- |
| Today (`projections.mcp: true`, pre-ADR-0049)      | 91,704            | 7,642.0          | —          |
| Default post-ADR-0049 (`projections.mcp: true`)    | 14,379            | 1,198.3          | **−84.3%** |
| Opt-in (`projections.mcp: { outputSchema: true }`) | 91,020            | 7,585.0          | −0.7%      |

The opt-in row is lower than "today" only by the twelve omitted top-level
`inputSchema.$schema` keys (12 × 56 bytes = 672 bytes; the measured gap is
684 bytes, the remainder is incidental key-ordering/whitespace from
re-serialization). Every opted-in tool's `outputSchema` is verified
byte-for-byte identical — not merely structurally similar — to a golden
fixture (`tests/unit/__fixtures__/mcp01-outputschema-golden.json`) captured
directly from the pre-ADR-0049 compiler (commit `71d38a53a`) compiling this
same fixture; the acceptance test
(`tests/unit/mcp01-compiler-catalogue.test.ts`) deep-equals every one of the
12 tools' `outputSchema` against that fixture, not just one representative
tool.

This is a smaller catalogue-wide percentage than the Autopilot research
pass's 88.1% combined figure, and smaller than this ADR's own earlier
(reverted) draft figure, because that figure assumed dropping the `uuid`
`pattern` as well — a change this ADR does not make (see "Uuid `pattern` is
kept, not dropped" above). On this fixture's default (`outputSchema` fully
dropped, `inputSchema` losing only its top-level `$schema`) path alone, the
reduction is 84.3%, consistent with the research's own "drop `outputSchema`
entirely" row (84.2%) plus this fixture's own top-level `$schema` saving on
top.

## Acceptance

Ratification requires:

1. `tests/unit/mcp01-compiler-catalogue.test.ts` — a size-ceiling test
   documenting the exact measured baseline (91,704 bytes/12 tools) and
   asserting the default-mode catalogue stays under a ceiling proving the
   measured reduction (with headroom for fixture drift); a test that default
   mode has no tool with `outputSchema` and no tool with a top-level
   `inputSchema.$schema`, while a uuid field in `inputSchema` keeps both
   `format: "uuid"` and its `pattern` (a regression guard against ever
   silently narrowing/widening what MCP callers are told is valid input); a
   test that `projections.mcp: { outputSchema: true }` restores
   `outputSchema` and deep-equals it, per tool, against a golden fixture
   captured from the pre-ADR-0049 compiler; config validation tests for the
   `projections.mcp` shape (accepts `true` and `{ outputSchema: true }`,
   rejects `{ outputSchema: false }`, rejects `{}` with the same accurate
   message as the wrong-value case, rejects unknown sibling keys).
2. `packages/runtime/src/application/mcp/artifact.ts`'s `decodeMcpProjection`
   accepting both an `outputSchema`-absent and an `outputSchema`-present tool
   binding, and rejecting a catalogue that mixes the two, covered by the same
   suite (`mcp01`) via `decodeMcpProjection` round-tripping the compiled
   artifact in both configurations.
3. The existing hostile/error-boundary suites
   (`tests/unit/mcp02-operation-adapter.test.ts`,
   `tests/unit/mcp02-runtime-ingress.test.ts`,
   `tests/integration/postgres/mcp-credential-gate.test.ts`) passing
   unmodified against the new default, demonstrating the runtime error
   boundary is unaffected.
4. `bun run format:check`, `bun run lint`, `bun run check-types`, and the
   full `bun test` unit suite passing; the PostgreSQL-backed suite passing
   against an isolated database.

## Alternatives rejected

- **Keep `outputSchema` on by default, only drop `inputSchema`'s top-level
  `$schema`.** Rejected as the sole lever: measured on this fixture, dropping
  `$schema` alone saves about 2% (§ "Context"); `outputSchema` itself is
  where the weight is, and this alone does not solve the byte problem this
  decision exists to solve.
- **Also drop the `pattern` on `format: "uuid"` fields.** Proposed in an
  earlier draft of this ADR and reverted before acceptance — see "Uuid
  `pattern` is kept, not dropped" above. `format` is annotation-only in JSON
  Schema 2020-12 and this framework's uuid codec is stricter (lowercase-only)
  than what RFC 4122's `format: "uuid"` keyword alone implies; dropping
  `pattern` would have both broken ADR-0038's codec-exactness acceptance item
  and let a client construct input the advertised schema accepted but the
  real codec rejects.
- **`$defs`/`$ref` de-duplication of the ~19 unique error-frame shapes,
  keeping `outputSchema` on by default.** A real, spec-legal, less
  destructive alternative (research pass: 61.6% saved on the Autopilot
  reference sample, preserves client-side structured-output validation for
  every tool without an opt-in). Rejected for _this_ ADR only because the
  owner's 2026-09-23 direction was explicitly "go with the schema diet"
  (drop-by-default), not the dedup-and-keep design; it remains a candidate
  for a later, separate ADR if an application wants validation-by-default
  back without paying the full `outputSchema` byte cost, and nothing in this
  ADR forecloses it — it would compose with this ADR's opt-in (the opt-in
  path could later gain a `$defs`-deduplicated variant without changing this
  ADR's default).
- **Per-Operation `mcp.outputSchema` opt-in.** Rejected: reopens ADR-0038's
  frozen "no per-Operation `mcp` member" clause for a posture (validation
  strictness) that is naturally application-wide; see "Why global, not
  per-Operation" above.
- **Silently redefine `outputSchema`'s content when opted in (e.g. also strip
  its top-level `$schema`).** Rejected: the opt-in exists specifically for an
  application that wants today's exact validation fidelity back; changing its
  content on top of gating its presence would make "opt in for the old
  behavior" a misnomer and would need its own separate acceptance evidence
  for a shape nobody asked for.

## Supersession

This ADR narrowly supersedes one clause of ADR-0038: "The tool `outputSchema`
is a compiler-owned closed `oneOf` ..." is no longer unconditional — it is now
gated behind `projections.mcp.outputSchema: true` and off by default. Every
other ADR-0038 clause (tool naming, `inputSchema` argument shape, the
Query/Mutation/Action call argument disjunction, the failure boundary, the
catalogue's Policy-neutral, deterministic, `ttlMs: 0`/`cacheScope: "public"`
nature, and the absence of per-Operation MCP authoring) is unchanged. It does
not supersede ADR-0036 (canonical HTTP/OpenAPI projection) — OpenAPI's schema
projection, `$schema` usage included, is untouched; this ADR's `inputSchema`
change (omitting one top-level key) is applied only inside the MCP
tool-assembly module (`packages/compiler/src/mcp/index.ts`) itself, after the
shared `projectOperationCodecSchema` codec projector OpenAPI also uses has
already run — that shared function's output is never modified by this ADR.
It also does not affect ADR-0038's Acceptance item 2 ("codec-exact JSON
Schema 2020-12 input"): `inputSchema` remains codec-exact underneath its one
omitted top-level key.
