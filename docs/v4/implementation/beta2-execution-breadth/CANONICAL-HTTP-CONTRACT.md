# Canonical Operation HTTP contract

- Status: Accepted Kernel/public protocol contract
- Owner: Kernel/public Operation Wire, compiler, Runtime, generated client
- Scope: canonical Query, Mutation, and Action network endpoints and transport
- Companion Product projection:
  [HTTP-OPENAPI-PROPOSAL.md](./HTTP-OPENAPI-PROPOSAL.md)

This document is the sole owner of the narrow supersession boundary. The
companion document projects this contract into OpenAPI without adding network
exposure, handlers, schemas, Policy, or another wire.

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

1. observe an already-aborted request signal or expired deadline;
2. resolve credentials once; zero resolver produces the Accepted anonymous
   Principal without a provider call, while typed malformed or unavailable
   credential failures never fall back to anonymous;
3. decode the compiler-derived Operation input and Context input through their
   canonical codecs;
4. resolve Context once from that decoded input;
5. execute admission/Policy and the existing handler;
6. validate and encode the semantic outcome.

The server captures one monotonic request-start instant and derives an immutable
deadline from the positive safe-integer timeout, saturating rather than wrapping.
One execution-owned `AbortSignal` combines caller cancellation and that deadline.
It and the immutable deadline reach the one Operation executor. The adapter
checks cancellation before credentials and after every awaited phase; once
cancelled it performs no later decode, Context, executor, validation, or encoding
phase and cleans up its request listener and deadline owner. Direct and network
calls share these semantics. A typed malformed-credential ingress failure is
correlated `UNAUTHENTICATED`, non-retryable HTTP 401, and value-free. A typed
provider outage is correlated retryable `RUNTIME_UNAVAILABLE` HTTP 503. Both
precede request decode, Context, and Policy and neither falls back to anonymous;
an untyped resolver fault is sanitized `INTERNAL`. Policy denial preserves
Accepted nondisclosure.

The adapter owns transport decoding only. Direct and canonical network HTTP share
the Operation executor, handler, Policy, limits, result validation, declared
errors, cancellation, transaction, and observability path. There is no fallback,
parallel handler, or transport retry loop.

Generated calls have disjoint exact option surfaces. Query accepts optional
`callId`, `signal`, and `timeoutMilliseconds`. Mutation accepts the same Call
options and maps `callId` only to `Idempotency-Key`. Action requires `effectKey`
and additionally accepts optional `callId`, `signal`, and
`timeoutMilliseconds`. Query and Mutation types cannot carry Effect Identity;
Action cannot be called without it. No universal option bag crosses the public
generated surface.

Query and Action accept at most one `Questpie-Call-Id`; Mutation derives
`callId` only from required `Idempotency-Key`. All kinds accept at most one
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
`action/notifications.send` while generated types and runtime codecs remain App
Contract-derived.

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
materialization. Request `Content-Type` is exactly `application/json` with
optional case-insensitive `charset=utf-8` and no other parameter.

Mutation requires exactly one `Idempotency-Key`. Differently cased duplicates,
comma-joining, and first/last-wins behavior are rejected. Its decoded canonical
UTF-8 percent-encoded value satisfies Accepted Call Identity: 1–256 Unicode
scalar values, already NFC, no lone surrogate or U+0000. It is rejected, never
normalized, and becomes `callId` before body decode. Missing or invalid identity
is pre-correlation `PROTOCOL_UNSUPPORTED` 400. Exact key/input replay reaches the
receipt; changed input reaches `IDEMPOTENCY_CONFLICT`. No retry occurs.

Action requires exactly one `Effect-Key`. It satisfies Accepted Effect Identity
input and binds the existing Action effect identity; authors cannot rename,
default, or read it. Missing/invalid/duplicate values fail before dispatch.
`Idempotency-Key` is rejected on Query and Action; `Effect-Key` is rejected on
Query and Mutation. After decode, Query and Action receive the validated optional
caller Call Identity or their existing framework-owned default.

### Exact responses, cancellation, and disclosure

Success is compiler-owned 200. Result and declared-error schemas derive only
from canonical output/error codecs. Success is `{ callId, result }`; declared
errors are `{ callId, error: { code, payload } }`; pre-correlation framework
failures omit `callId`; correlated failures include it. Committed Mutation
ambiguity additionally carries its sanitized `transactionId`.

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

Applicable framework mapping is `PROTOCOL_UNSUPPORTED` 400,
`UNAUTHENTICATED` 401, `NOT_FOUND` 404, `DEADLINE_EXCEEDED` 408,
`RESOURCE_LIMIT` 429, `RUNTIME_UNAVAILABLE` 503, and sanitized `INTERNAL` 500.
Deadline/resource/unavailable are retryable;
protocol/unauthenticated/not-found/internal are not. RPC-only
`APPLICATION_MISMATCH` and `CLIENT_OUTDATED` are absent.

Action is outcome-sensitive: pre-dispatch `RESOURCE_LIMIT` follows ordinary
classification, while ADR-0028's post-handler oversized settled result or
declared outcome is correlated and non-retryable because provider nonacceptance
is not proven.

Missing and Policy-invisible targets remain identical 404. PostgreSQL detail,
stack, cause, credential detail, Context, and Policy evidence never appear.
Response `Content-Type` is `application/json; charset=utf-8`. Every Query
response, including failures, carries `Cache-Control: private, no-store`; no
cache entry may be reused across Principal or Context, and `Vary` is not
authorization.

Pre-commit cancellation rolls back and uses `DEADLINE_EXCEEDED` 408. After
Mutation commit, cancellation/response loss is ADR-0023 HTTP 500 with top-level
`callId` and nested `COMMITTED_RESULT_UNAVAILABLE`, `retryable: true`, and
`transactionId`. Retryability authorizes only replay with the same
Idempotency-Key. Action ambiguity preserves `ACTION_OUTCOME_AMBIGUOUS`,
`retryable: false`, and correlated `callId`; it never becomes INTERNAL or replay.

## Raw Route boundary

Raw Routes retain their Accepted explicit method/path and Request/Response
handler. Better Auth mounts, callbacks, webhooks, files, streams, redirects, and
custom media types remain untouched. Ordinary typed work uses Operations; V1
adds no second ordinary Route mode.

Every canonical path and raw Route enters one collision analysis. Exact or
parameter overlap fails with both Origins. Any possible raw wildcard subtree
intersection is conservatively rejected; no precedence is chosen. Q63 remains
deferred Kernel work. The rejected
`canonical: true` Route alternative has no canonical codec for body, result,
errors, or admission and would create a shallow second endpoint.

Raw Routes are omitted from V1 OpenAPI with Origin reason
`rawRouteUnsupported`. No Route schema is inferred. Security schemes remain
outside this boundary.

## Registered diagnostics

Ratification appends two severity-error, fatal, exit-2 diagnostics:

| Code             | Class                     | Closed reasons                                                                                                |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `QP-COMPOSE-028` | `invalidHttpProjection`   | `queryHttpEncodingUnsupported`, `canonicalEndpointUnsupported`, `unexpectedHttpMember`                        |
| `QP-COMPOSE-029` | `httpProjectionCollision` | `exactPathCollision`, `ambiguousParameterCollision`, `rawWildcardIntersection`, `openApiOperationIdCollision` |

028 reports Operation Origin, exact member span, and rewrite. 029 reports both
identities/Origins and no precedence. Neither exposes values or Policy evidence.
ADR-0031's QP-COMPOSE-026/027 meanings remain untouched. Selector grammar uses
Accepted QP-COMPOSE-017 `invalidApplicationRoot`.

## Sole supersession and ratification boundary

This Kernel/public-protocol contract supersedes only ADR-0011's fixed
polymorphic `POST /_questpie/operation` dispatch path/method, the generated
client's use of that path, and corresponding Operation Wire artifact
compatibility. It preserves Operation identity and exposure, codecs, Context,
Principal and Policy ownership, Call/Effect Identity, envelopes, limits,
Execution, transactions, receipts, errors, cancellation, nondisclosure,
observability, and direct/network parity. OpenAPI is only the linked Product
projection.

The exact manifest-bound candidate received a committed protocol-v2 `PASS`.
The implementation tracer deletes the polymorphic RPC route, negative RPC
prototype, and temporary duplicate codec switch in one replacement vertical.
No compatibility handler, redirect, fallback, or parallel wire survives.
