# Canonical HTTP and OpenAPI projection

- Status: Proposed focused acceptance candidate; not Accepted authority
- Rigor: ADR-0027 Kernel/public-protocol supersession for the narrow Operation
  Wire boundary; Product projection for OpenAPI
- Scope: canonical Query, Mutation, and Action network endpoints, generated
  client transport, plus optional OpenAPI emission
- Excluded: custom paths or methods, authored request/response schemas, raw-Route
  OpenAPI, security schemes, MCP, skills, multiple bindings, a second handler or
  Policy model, and production implementation

## Reconciled authority

ADR-0011 owns Operation identity, codecs, Policy, limits, Call Identity, errors,
cancellation, nondisclosure, transaction outcomes, and direct/network parity.
ADR-0015 owns raw Routes and the one Fetch router. ADR-0018 makes OpenAPI a
compiler projection of canonical App Contract members and Origins, never a new
handler or schema registry. ADR-0019 makes `questpie.json.projections` the
artifact selector. ADR-0023 fixes the post-commit Mutation outcome and HTTP 500.

Deep-DX packet sections 4.11 and 15 are directionally approved research, not
authority. This candidate deliberately replaces their custom-path sketch with
the later human direction: codec and Resource Identity are sufficient for the
ordinary HTTP surface.

The polymorphic `POST /_questpie/operation` transport is deleted. There is no
compatibility route or fallback. Generated clients and external callers use one
distinct canonical endpoint per network Operation and invoke the same existing
Operation adapter. Network tools visibly identify kind and Resource name.

## Two KISS candidates

### Candidate A — network exposure is canonical HTTP (recommended)

```ts
export const ticketDetail = defineQuery({
	name: "tickets.detail",
	network: true,
	input: codec.object({ ticketId: codec.uuid() }),
	// output, errors, Policy, limits, metadata, and handler remain canonical
});
```

Existing `network: true` is the sole authored exposure decision. The compiler
projects its canonical endpoint and generated-client method from Resource kind,
name, and codecs. There is no HTTP-specific authoring member.

### Candidate B — add `http: true`

This duplicates the already-authored network exposure fact and lets transport
surfaces drift. Candidate B is rejected. A server-only Operation stays direct;
a network Operation always has exactly its canonical endpoint.

## Canonical endpoint contract

### Identity, path, and method

The compiler derives exactly:

| Kind     | Method | Path                                  |
| -------- | ------ | ------------------------------------- |
| Query    | `GET`  | `/_questpie/query/<resource-name>`    |
| Mutation | `POST` | `/_questpie/mutation/<resource-name>` |
| Action   | `POST` | `/_questpie/action/<resource-name>`   |

`<resource-name>` is the exact Qualified Resource Name from Resource Identity,
not a source variable or generated-client alias. Its Accepted ASCII letters,
digits, and dot separators are emitted byte-for-byte as one path segment; `/`,
percent, backslash, Unicode normalization, and path traversal cannot be authored
by that grammar. The three literal kind segments make cross-kind equal names
disjoint. Any collision is a compiler defect, never source-order precedence.

Network Query, Mutation, and Action Definitions receive exactly one binding.
Direct-only Operations, Jobs, Reactions, Routes, and removed Channel/Workflow
kinds do not. Any `http` member is unknown authoring and fails compilation; there
is one binding and no compatibility spelling.

### Context, credentials, and one executor

Context remains a compiler-projected, typed part of the network contract. Authors
do not restate it in HTTP configuration, and the generated client's existing
`withContext(AppContextInput)` DX remains intact. It is distinct from credential
material: credential resolution produces Principal, while the request transports
only the canonical Context input consumed by the existing Context resolver.

For Query GET, Context uses exactly one reserved `Questpie-Context` header. Its
value is unpadded base64url over the canonical JSON wire representation derived
from the application Context input codec. The client emits exactly one value;
missing Context is equivalent to the codec's exact empty object only when that
codec admits it. Duplicate values, comma-joined values, padding, non-canonical
base64url, invalid UTF-8/JSON, or a codec mismatch are rejected. This namespace
is disjoint from Query input parameters and from credential headers.

For Mutation and Action POST, Context is the `context` member of the exact JSON
body described below. No request member or Context value can supply Principal or
Authority.

The fixed phase order is:

1. observe an already-aborted signal or expired deadline;
2. resolve credentials once; zero resolver produces the Accepted anonymous
   Principal without a provider call, while malformed or unavailable credentials
   never fall back to anonymous;
3. decode the compiler-derived Operation input and Context input through their
   canonical codecs;
4. resolve Context once from that decoded input;
5. execute admission/Policy and the existing handler.

Cancellation stops before the next phase. Resolver malformed/unavailable errors
precede request decode; provider unavailable is `RUNTIME_UNAVAILABLE`. Decode
precedes Context and Policy. Policy denial preserves Accepted nondisclosure. No
request member can supply Principal, Authority, or resolved Context facts.

The adapter owns transport decoding only. Direct and canonical network HTTP share
the Operation executor, handler, Policy, limits, result validation, declared
errors, cancellation, transaction, and observability path. There is no fallback,
parallel handler, or transport retry loop.

Generated CallOptions retain safe canonical carriers. Query and Action accept
at most one `Questpie-Call-Id`; Mutation derives `callId` only from required
`Idempotency-Key`. All kinds accept at most one
`Questpie-Timeout-Milliseconds`, an ASCII base-10 positive safe integer without
sign, whitespace, leading zero, exponent, or normalization. These headers are
framework metadata, never input, Context, Principal, or Authority. After Action
dispatch every untrusted transport failure remains correlated to the chosen
callId as `ACTION_OUTCOME_AMBIGUOUS`.

Call and Effect Identity header values are canonical UTF-8 percent encodings.
Unreserved ASCII therefore stays readable, while Unicode, comma, percent, and
other unsafe header bytes round-trip without first/last-wins ambiguity. Decode
occurs exactly once and re-encoding must reproduce the received bytes; lowercase
escapes, malformed UTF-8, raw comma-joining, normalization drift, and duplicate
header coalescing fail. This is transport encoding only and does not narrow the
Accepted identity value.

Generated clients send the reserved trio `Questpie-Application`,
`Questpie-Client-Contract`, and `Questpie-Wire-Digest`. If any is present, all
are required and must match before work. Ordinary OpenAPI callers omit all three.
This is stale-client detection, not another route or compatibility fallback.

The generated typed client is compiled from the same endpoint projection. Query
methods issue canonical GETs; Mutation and Action methods issue canonical POSTs.
It owns no private polymorphic transport. Browser Network tools therefore show
`query/tickets.detail`, `mutation/tickets.close`, or
`action/notifications.send` in the URL while generated types and runtime codecs
remain App Contract-derived.

### Query URL serialization

Query input must be the canonical top-level object codec. Each present top-level
member becomes one query pair whose key is the exact member name and whose value
uses one codec-driven lexical encoding, then UTF-8 percent encoding.

- pairs sort by ASCII member name;
- spaces are `%20`, never `+`; percent hex is uppercase;
- boolean, integer, bigint, numeric, text, UUID, date, timestamp, and cursor use
  their readable canonical lexical value; text beginning `~` is escaped as
  `~text:<value>`;
- optional absence omits the pair and nullable null is `~null`;
- bounded arrays, nested objects, tagged JSON, and discriminated unions use
  `~json:<canonical-json>`; there are no bracket, dot, or repeated-key dialects;
- duplicate keys, non-canonical percent escapes, invalid UTF-8, invalid JSON,
  unknown members, and first/last-wins parsing are rejected;
- decode percent exactly once, reverse the codec-selected lexical/`~` form, then
  apply the same member codec used by direct execution and the generated client.

The compiler admits GET only when every reachable text and array branch has a
static maximum and no reachable arbitrary JSON branch exists. Cursor is opaque
and has no authored bound, so the fixed whole-query bound below is its only HTTP
framing bound. An unsupported branch reports `queryHttpEncodingUnsupported`;
there is no POST fallback. The complete ASCII query after percent encoding is at
most 16,384 bytes; decoded canonical Context JSON is at most 65,536 UTF-8 bytes.
Both fixed HTTP framing bounds are checked before codec decode. They are not
Action's semantic `inputBytes` and are not author configuration.

### Mutation and Action JSON

Mutation and Action request body is exactly
`{ "input": <canonical-input>, "context": <canonical-context-input> }`.
Both member schemas are derived from their canonical codecs. Unknown or duplicate
JSON keys, invalid UTF-8/JSON, a missing member, or a codec mismatch fail before
Context and Policy. Duplicate keys are detected before ordinary object
materialization. Request `Content-Type` is exactly
`application/json` with optional case-insensitive `charset=utf-8` and no other
parameter.

Mutation automatically requires exactly one `Idempotency-Key` header. Header
name comparison is ASCII case-insensitive; differently cased duplicates,
comma-joining, and first/last-wins behavior are rejected. Its decoded canonical
UTF-8 percent-encoded value must satisfy the Accepted Call Identity contract:
1–256 Unicode scalar values, already NFC, no lone surrogate or U+0000. It is
rejected, never normalized, and becomes `callId` before body decode. Missing or
invalid identity is a
pre-correlation `PROTOCOL_UNSUPPORTED` 400. Exact key/input replay reaches the
receipt; changed input reaches existing `IDEMPOTENCY_CONFLICT`. No automatic
retry occurs.

Action automatically requires exactly one `Effect-Key` header. It satisfies the
Accepted Effect Identity input contract and binds the existing Action effect
identity; authors cannot rename, default, or read it. Missing/invalid/duplicate
values fail before dispatch. `Idempotency-Key` is rejected on Query and Action;
`Effect-Key` is rejected on Query and Mutation.

After successful request decode, Query and Action receive the validated optional
caller Call Identity or their existing framework-owned default.

### Exact responses, cancellation, and disclosure

Success is compiler-owned 200. Result and declared-error schemas are derived
only from canonical output/error codecs:

```ts
type Success<Output> = { callId: string; result: Output };
type DeclaredError<Code extends string, Payload> = {
	callId: string;
	error: { code: Code; payload: Payload };
};
type PreCorrelationFailure = {
	error: { code: PreCorrelationCode; retryable: boolean };
};
type CorrelatedFailure = {
	callId: string;
	error: { code: CorrelatedCode; retryable: boolean };
};
type CommittedResultUnavailable = {
	callId: string;
	error: {
		code: "COMMITTED_RESULT_UNAVAILABLE";
		retryable: true;
		transactionId: string;
	};
};
```

Declared-error member identity maps to its existing status; no HTTP-local error
schema exists. Applicable framework mapping is `PROTOCOL_UNSUPPORTED` 400,
`NOT_FOUND` 404, `DEADLINE_EXCEEDED` 408, `RESOURCE_LIMIT` 429,
`RUNTIME_UNAVAILABLE` 503, and sanitized `INTERNAL` 500. Deadline/resource/
unavailable are retryable; protocol/not-found/internal are not. Pre-correlation
failure omits `callId`; later outcomes are correlated. RPC-only
`APPLICATION_MISMATCH`/`CLIENT_OUTDATED` are impossible and absent from OpenAPI.

Action is outcome-sensitive: pre-dispatch `RESOURCE_LIMIT` follows the ordinary
classification, while ADR-0028's post-handler oversized settled result or
declared outcome is correlated and non-retryable because provider nonacceptance
is not proven.

Missing and Policy-invisible targets remain identical 404. PostgreSQL detail,
stack, cause, credential detail, Context, and Policy evidence never appear.
Response `Content-Type` is `application/json; charset=utf-8`; OpenAPI content key
is `application/json`. Every Query response, including failures, carries
`Cache-Control: private, no-store`; no cache entry may be reused across
Principal or Context, and `Vary` is not treated as authorization.

Pre-commit cancellation rolls back and uses `DEADLINE_EXCEEDED` 408. After
Mutation commit, cancellation/response loss is exact ADR-0023 HTTP 500 with
top-level `callId` and nested `{ code: "COMMITTED_RESULT_UNAVAILABLE",
retryable: true, transactionId }`. Retryability authorizes only caller replay
with the same Idempotency-Key. Action ambiguity preserves existing
`ACTION_OUTCOME_AMBIGUOUS`, `retryable: false`, and correlated `callId`; it never
becomes INTERNAL or automatic replay.

## Raw Route boundary: two candidates

### Route candidate A — keep explicit external protocols (recommended)

Raw Routes retain their Accepted explicit method/path and Request/Response
handler. Better Auth mounts, callbacks, webhooks, files, streams, redirects, and
custom media types remain untouched. Ordinary typed application work uses
canonical Operations; V1 adds no second "ordinary Route" mode.

Every canonical Operation path and raw Route enters the one existing routing
collision analysis. An exact/ambiguous overlap fails with both Origins. Any
Operation path that could intersect a raw wildcard subtree is conservatively
rejected; raw Route behavior is unchanged and no wildcard winner is chosen. Q63
remains deferred Kernel work.

### Route candidate B — canonical named Route default

`canonical: true` could derive `POST /_questpie/routes/<resource-name>`, but a raw
Route owns Request/Response semantics and provides no canonical codec for body,
result, errors, admission transport, or OpenAPI. The flag would create a shallow
second semantic endpoint. Candidate B is rejected pending a real typed Route
contract; external protocols keep explicit paths.

Raw Routes are omitted from V1 OpenAPI with Origin reason
`rawRouteUnsupported`. No Route schema is inferred. `security` and
`components.securitySchemes` are absent until credential description is
ratified.

## Registered diagnostics

This candidate allocates two unclaimed codes. Ratification appends them to the
closed composition registry/unions; both are severity `error`, blocking effect
`fatal`, exit 2:

| Code             | Class                     | Closed reasons                                                                                                |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `QP-COMPOSE-028` | `invalidHttpProjection`   | `queryHttpEncodingUnsupported`, `canonicalEndpointUnsupported`, `unexpectedHttpMember`                        |
| `QP-COMPOSE-029` | `httpProjectionCollision` | `exactPathCollision`, `ambiguousParameterCollision`, `rawWildcardIntersection`, `openApiOperationIdCollision` |

028 reports Operation Origin, exact member span, and rewrite. 029 reports both
identities/Origins and no precedence. Neither exposes values or Policy evidence.
ADR-0031's QP-COMPOSE-026/027 meanings remain untouched. Selector grammar uses
Accepted QP-COMPOSE-017 `invalidApplicationRoot`.

## Projection-neutral descriptive metadata

HTTP carries no documentation. Query/Mutation/Action Definitions may carry
literal `summary` and `description`; codec constructors may carry literal
`description` and codec-valid `examples` in their existing options object.
Stored Fields consume the same codec metadata through canonical Field codec
projection. Descriptions are non-empty NFC literals. Examples must be closed,
compile-time codec-valid, canonically encodable values; callbacks, environment
reads, and unprovable examples fail at the codec Origin.

The canonical codec/App Contract artifact and digest own this metadata.
Generated declaration JSDoc, public reference docs, generated client, OpenAPI,
and future MCP consume it and cannot override it. MCP stays outside this
candidate; this seam prevents an MCP/OpenAPI-specific schema or description
registry. Nullability, lists, discriminated unions, bounds, validation, output,
and error schemas always derive from codecs.

## OpenAPI selector, artifact, and exact fields

```json
{ "projections": { "openapi": true } }
```

Missing selection emits nothing. Exact true emits compiler-owned `openapi.json`;
false, object, string, array, null, unknown projection names, paths, URLs, and
environment placeholders fail application-v1. Absence is the only disabled
spelling. Selection emits documentation only and never exposes an Operation.

OpenAPI has exactly top-level `openapi: "3.1.0"`, `info`, `paths`, and
`components.schemas`; no servers, security, top-level tags, or inferred prose.
`info.title` is application identity; `info.version` is Client Contract digest.
Each network Operation produces one canonical path
with inferred method, exact Resource Identity `operationId`, derived Query
parameters or JSON body, and compiler-derived success/declared/framework/
post-commit schemas. Shared statuses use ASCII-sorted `oneOf`. Content key is
`application/json`. Paths, parameters, statuses, schemas, properties, omissions,
and Origins sort before canonical bytes.

The schema is exact where JSON Schema 2020-12 can express the Runtime value set.
Where it cannot express a constraint—currently NFC and lone-surrogate rules,
negative-zero rejection, PostgreSQL bigint bounds, or canonical calendar/time
semantics—the emitted standard schema is a conservative superset and carries
`x-questpie-runtime-validation: { exact: false, requirements: [...] }`. This is
an honest projection marker, not a validator keyword. The same canonical Runtime
codec remains the exact request/response validator, and authors cannot restate
or weaken it in OpenAPI metadata.

`operationId` is the full Qualified Resource Name without the kind prefix, as
directed for V1. Because Accepted Resource Identity permits equal names across
kinds, selecting OpenAPI with two included Operations of different kinds but the
same name fails `QP-COMPOSE-029 openApiOperationIdCollision` with both Origins;
the compiler never suffixes or silently chooses one. `tags` contains exactly one
inferred group: the first namespace segment for qualified names, or the
configured application name for an unqualified name. No OpenAPI/MCP-specific
group metadata is authored. A future projection-neutral `group` requires
evidence and focused ratification; later MCP must consume the same Operation and
codec metadata owner.

Artifact names, digest domains, checksum/Runtime Build membership, and exact
explain bytes are deferred to the production tracer. They are repository
mechanics, not part of this public protocol ratification. The V1 selector/output
contract frozen here is exact `projections.openapi: true` and compiler-owned
`openapi.json`; absence deletes a previous compiler-owned file on the next
successful atomic generation.

## Explain parity

Explain reports the same selected/included/omitted identities and Origins as
generation, writes nothing, and discloses no credentials, Context, Policy
evidence, handler source, values, or database detail. Its exact CLI record shape
is deferred to the production tracer rather than frozen without executable
evidence.

## Proof and hostile acceptance matrix

The isolated prototype retains the negative proof that the giant RPC envelope is
the wrong OpenAPI story. Its positive extension proves canonical per-Operation
paths and codec-owned GET serialization; it remains non-production evidence.

Implementation starts with hostiles for canonical method/path, kind/name
collisions, Query canonical lexical/structured encoding and unsupported unbounded
codecs, Mutation Idempotency-Key, Action Effect-Key/ambiguity, credential/
cancellation precedence, exact response envelopes, nondisclosure, raw wildcard
rejection without Q63, cross-Principal and cross-Context cache non-reuse,
selector/stale-output behavior, explain equality,
and deletion of the polymorphic RPC route, raw Route OpenAPI, security,
MCP/skills, custom
paths, duplicate schemas, handlers, or registries.

The candidate proof composes one generated-client request builder with one
canonical adapter and the shared Runtime codec implementation. It includes all
current scalar kinds, required/order/duplicate/percent hostiles, exact/parameter/
wildcard raw Route collisions with both Origins and `rawRouteUnsupported`
omission Origins, partial compatibility-header refusal before execution,
post-handler Action `RESOURCE_LIMIT`, malformed Action response ambiguity, and
Query `private, no-store` responses across different Principal and Context
values. No helper-only model is evidence for the transport claim.

The inherited `quality:full` release-checksum mismatch at this branch base is
recorded as unrelated baseline state. This docs/prototype candidate changes no
release input or checksum and claims no PASS for that gate; its focused gates
remain independently green.

## Supersession, ratification, and deletion boundary

The focused Kernel/public-protocol portion supersedes only ADR-0011's fixed
polymorphic `POST /_questpie/operation` dispatch path/method, the generated
client's use of that path, and the corresponding Operation Wire artifact
compatibility. It preserves Operation identity and exposure, codecs, Context,
Principal and Policy ownership, Call/Effect Identity, envelopes, limits,
Execution, transactions, receipts, errors, cancellation, nondisclosure,
observability, and direct/network semantic parity. OpenAPI selection, metadata,
and documentation remain a Product projection layered on that transport.

Ratify the narrow supersession through ADR-0027's focused formal acceptance
protocol. ADR-0036, SPEC, CONTEXT, ADR index, public docs, and HANDOFF must not
describe it as Accepted before a committed protocol-v2 PASS record. The later
tracer deletes the production polymorphic RPC route, the negative RPC prototype,
and any temporary duplicate codec switch in the same replacement vertical. No
compatibility handler, redirect, fallback, or parallel wire survives. This
Proposed commit changes no production compiler, Runtime, config, golden, or
Accepted authority.
