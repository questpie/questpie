# ADR-0049: MCP `outputSchema` becomes opt-in; drop `$schema` and redundant `uuid` `pattern` by default

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
cheapest one available: on this fixture, dropping `outputSchema` alone saves
**87.3%** of the catalogue (measured below).

Two smaller, independent levers stack with it. `$schema` is a fixed 56-byte
`"https://json-schema.org/draft/2020-12/schema"` string repeated on every
`inputSchema` and (previously) every `outputSchema` — it identifies the JSON
Schema dialect, not a per-tool fact, and MCP `2026-07-28` does not require a
tool schema to declare it. `format: "uuid"` fields today also carry a
`pattern` (`^[0-9a-f]{8}-...$`) that duplicates what `format: "uuid"` already
asserts — one JSON Schema keyword pair encoding the same constraint twice.

The owner decided 2026-09-23 to take this schema diet: **`outputSchema`
becomes opt-in and defaults off**; the smaller `$schema`/`uuid` trims apply to
what remains always-on (`inputSchema` and the embedded `context` schema).

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

`projections.mcp.outputSchema` accepts only literal `true`; any other value,
or an unknown sibling key under `projections.mcp`, is a compile-time
`QP-COMPOSE-017 invalidApplicationRoot` diagnostic, matching every other
`questpie.json` validation in `packages/compiler/src/index.ts`. There is no
per-Operation `mcp` member or per-Operation `outputSchema` override — ADR-0038
already forbids per-Operation MCP authoring in the basic slice
("no per-Operation `mcp` member or compatibility spelling exists in the basic
slice"), and this ADR does not reopen that.

When `outputSchema` is included (opt-in), it is produced by the exact same
code ADR-0038 specified and is **byte-identical to today's `outputSchema`**:
same closed `oneOf`, same `$schema` declaration, same `uuid` `format`+
`pattern` pair on every branch that carries a uuid-typed field. This ADR does
not redesign `outputSchema`'s content or encoding — the `$defs`/`$ref`
de-duplication design the research pass also scoped (61.6% saved, keeps
validation value) is a _different_, not-yet-decided lever and is explicitly
out of scope here (see "Alternatives rejected"). Opting in trades bytes for
today's exact fidelity; it is not a smaller, redesigned `outputSchema`.

Independent of that opt-in, every tool's `inputSchema` (which is always
emitted — the MCP spec requires it) drops two things unconditionally,
regardless of the `outputSchema` setting:

1. **`$schema`** is no longer emitted on `inputSchema`. `tools/list` never
   places a `$schema` key at all when `outputSchema` is off (the default);
   when an application opts into `outputSchema`, that field's `$schema` is
   still present (untouched fidelity, see above) but `inputSchema`'s is not.
2. **`format: "uuid"` fields drop the redundant `pattern`.** Wherever the
   compact `inputSchema` (including the embedded `context` schema and any
   nested object/array) reaches a `{ "type": "string", "format": "uuid",
"pattern": "^[0-9a-f]{8}-..." }` triple, the `pattern` key is removed,
   leaving `{ "type": "string", "format": "uuid" }`. This only fires when
   `format` is exactly `"uuid"`; a `pattern` paired with any other `format`
   (or with none) is untouched. It is applied by a small recursive
   post-processing pass over the assembled `inputSchema`
   (`compactUuidSchema` in `packages/compiler/src/mcp/index.ts`), not by
   changing the shared `projectOperationCodecSchema` codec-to-schema
   projector — that function is also used by the canonical HTTP/OpenAPI
   projection (ADR-0036), which this ADR does not touch. OpenAPI's `uuid`
   schema keeps both `format` and `pattern` exactly as today.

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
`inputSchema`-only tool binding is not itself invalid runtime state.

## Measured effect on `fixtures/team-support-desk`

Measured by compiling the fixture (12 tools, real committed migrations,
`DATABASE_URL`-free compiler measurement — no PostgreSQL needed for this
number) and computing `Buffer.byteLength(JSON.stringify(tools.map(t =>
t.tool)))` — the same bytes that land inside `tools/list`'s
`result.tools` array, independently reproduced by the acceptance evidence
this ADR ships with (`tests/unit/mcp01-compiler-catalogue.test.ts`):

| Configuration                                      | Tools array bytes | Bytes/tool (avg) | vs. today  |
| -------------------------------------------------- | ----------------- | ---------------- | ---------- |
| Today (`projections.mcp: true`, pre-ADR-0049)      | 91,704            | 7,642            | —          |
| Default post-ADR-0049 (`projections.mcp: true`)    | 11,604            | 967              | **−87.3%** |
| Opt-in (`projections.mcp: { outputSchema: true }`) | 88,245            | 7,354            | −3.8%      |

The opt-in row is lower than "today" only because of the always-on
`inputSchema` `$schema`/`uuid` trims (§ above); its `outputSchema` field is
verified byte-identical, per tool, to today's pre-ADR-0049 `outputSchema`
(diffed directly for `query:tickets.detail` during this ADR's construction;
asserted structurally for every tool kind in the acceptance test).

This is a smaller catalogue-wide percentage than the Autopilot research
pass's 88.1% combined figure because that figure additionally assumed
`uuid` trimming and `$schema` removal applied to a _retained_ `outputSchema`
too (a variant this ADR does not build, to keep the opt-in path byte-
identical to today — see above); on this fixture's default (`outputSchema`
fully dropped) path alone, the reduction is 87.3%, consistent with the
research's own "drop `outputSchema` entirely" row (84.2%) plus this
fixture's own `inputSchema` `$schema`/`uuid` savings on top.

## Acceptance

Ratification requires:

1. `tests/unit/mcp01-compiler-catalogue.test.ts` — a size-ceiling test
   documenting the exact measured baseline (91,704 bytes/12 tools) and
   asserting the default-mode catalogue stays under a ceiling proving the
   measured reduction (with headroom for fixture drift); a test that default
   mode has no tool with `outputSchema` and no tool with `$schema` anywhere;
   a test that `projections.mcp: { outputSchema: true }` restores
   `outputSchema` and it is structurally byte-identical (`$schema`, full
   `uuid` `format`+`pattern` pair, complete `oneOf` branch set) to what
   ADR-0038 always produced; a test that every `format: "uuid"` field in
   `inputSchema` carries no `pattern`; config validation tests for the new
   `projections.mcp.outputSchema` shape (accepts `true`, rejects `false`,
   rejects unknown sibling keys).
2. `packages/runtime/src/application/mcp/artifact.ts`'s `decodeMcpProjection`
   accepting both an `outputSchema`-absent and an `outputSchema`-present tool
   binding, covered by the same suite (`mcp01`) via `decodeMcpProjection`
   round-tripping the compiled artifact in both configurations.
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

- **Keep `outputSchema` on by default, only drop `$schema` and shorten
  `uuid`.** Rejected as the sole lever: measured on this fixture, that alone
  is a small single-digit-percent saving (`outputSchema` itself is where the
  weight is); it does not solve the byte problem this decision exists to
  solve.
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
- **Silently redefine `outputSchema`'s content when opted in (e.g. also
  strip its `$schema`/`uuid` pattern).** Rejected: the opt-in exists
  specifically for an application that wants today's exact validation
  fidelity back; changing its content on top of gating its presence would
  make "opt in for the old behavior" a misnomer and would need its own
  separate acceptance evidence for a shape nobody asked for.

## Supersession

This ADR narrowly supersedes one clause of ADR-0038: "The tool `outputSchema`
is a compiler-owned closed `oneOf` ..." is no longer unconditional — it is now
gated behind `projections.mcp.outputSchema: true` and off by default. Every
other ADR-0038 clause (tool naming, `inputSchema` argument shape, the
Query/Mutation/Action call argument disjunction, the failure boundary, the
catalogue's Policy-neutral, deterministic, `ttlMs: 0`/`cacheScope: "public"`
nature, and the absence of per-Operation MCP authoring) is unchanged. It does
not supersede ADR-0036 (canonical HTTP/OpenAPI projection) — OpenAPI's `uuid`
schema and its `$schema` usage are untouched; the `uuid`/`$schema` trims in
this ADR are applied only inside the MCP tool-assembly module
(`packages/compiler/src/mcp/index.ts`), not the shared
`projectOperationCodecSchema` codec projector OpenAPI also uses.
