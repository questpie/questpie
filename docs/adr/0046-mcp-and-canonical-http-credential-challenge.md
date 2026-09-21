# ADR-0046: MCP and canonical HTTP credential challenge

- Status: Proposed
- Date: 2026-09-21
- Owners: Product architecture, Runtime ingress, MCP projection

## Context

Board item "v4 rewrite 04: OAuth protection of the v4 MCP endpoint" asked
whether `POST /_questpie/mcp` and the canonical HTTP surfaces can carry a real
OAuth 2.1 / RFC 9728 `401` challenge on a missing or invalid credential. Prior
research (`docs/architecture/v4-mcp-oauth-seam-2026-09-21.md` in the Autopilot
repository, re-verified against source in this session) found that everything
an application needs to validate an OAuth access token, mint a Principal, and
serve `.well-known/oauth-protected-resource` from a raw Route already works
with existing seams (ADR-0015 Route/credential-resolver composition). The one
genuine gap is response shape, owned by the framework, not the application:

- `createMcpOperationAdapter` (`packages/runtime/src/application/mcp-operation.ts`)
  turns a credential-resolver failure into `OperationFailure("UNAUTHENTICATED")`,
  which `createMcpIngress`'s `tools/call` handling always wraps in a `200`
  `text/event-stream` JSON-RPC error frame (`packages/runtime/src/application/mcp/index.ts`,
  `requestSse`). There is no HTTP status or header the application can shape.
  ADR-0038 explicitly accepted this shape ("Success and tool-execution errors
  return conforming `structuredContent`... errors set `isError: true`"), so
  this is not an oversight to silently reverse — every application that
  already ships against today's contract must keep working unchanged.
- `tools/list` and `server/discover` never call `resolvePrincipal` at all
  (ADR-0038: "Listing evaluates neither Principal nor Policy"); the catalogue
  is fully public and static.
- The canonical HTTP Query/Mutation/Action surfaces (`http-carrier.ts`,
  `http-query.ts`, `http-post.ts`) already return a real `401` for
  `UNAUTHENTICATED` (`canonicalOperationFailure`), but `httpJsonResponse` only
  ever sets `content-type`/`cache-control`; there is no header-injection seam
  for `WWW-Authenticate` there either.

Authorization (Policy) denials for an authenticated caller are a different,
unaffected code path: they are not `OperationFailure("UNAUTHENTICATED")` and
this decision does not touch them. `tools/list`/`server/discover` staying
public is itself an ADR-0038 default; ADR-0038 says a future decision here
"must preserve one metadata/schema owner and cannot silently change the basic
default" — so any change must be opt-in, not a new default forced onto every
application.

## Decision

Add one small, purely mechanical seam: the application declares an optional
`WWW-Authenticate` challenge next to its credential resolver. The framework
never constructs, validates, or interprets the value — it only forwards it as
a response header at the exact points a missing/invalid credential is about
to be reported, and only when the application has opted in by declaring one.

```ts
defineCredentialResolver({
	name: "...",
	service: authService,
	resolve: async ({ request, service }) => {
		/* existing behavior, unchanged */
	},
	// NEW, both optional:
	challenge: 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
	// or, varying per Request:
	// challenge: (request) => `Bearer resource_metadata="${resourceMetadataUrl(request)}"`,
	protectCatalog: true, // opt-in: also gate tools/list and server/discover
});
```

### 1. `tools/call` credential-failure shape

`createMcpIngress` gains an optional `authenticate(request, signal)` preflight
and the application wiring (`packages/runtime/src/application/index.ts`)
supplies one. It resolves the Principal once, before the SSE stream commits
its headers, and classifies the outcome exactly the way
`classifyOperationCredentialFailure` already does. **The 401 short-circuit
only fires when `credentialChallenge(request)` — the app's `challenge` —
actually returns a string for this exact Request.** If the application never
declared `challenge`, or its function returns `undefined` for this Request,
the outcome is `"deferred"`: the ingress falls through unchanged to
`mcpOperation`'s own resolution and today's `200`/SSE-wrapped
`{ error: { code: "UNAUTHENTICATED", retryable: false } }` frame, byte-for-byte.
This is the backward-compatibility hinge: an application that does not adopt
`challenge` sees zero behavior change, satisfying ADR-0038's frozen shape.

When the preflight does short-circuit, the response is a real `401`:

```json
{ "jsonrpc": "2.0", "id": "...", "error": { "code": -32001, "message": "Unauthorized" } }
```

with `WWW-Authenticate: <challenge>` when the application supplied one for
that Request. `-32001` is an implementation-defined code in the JSON-RPC
"Server error" reserved range (`-32000`..`-32099`), distinct from every
existing MCP ingress code in this file.

This preflight duplicates one `resolvePrincipal` call on the path that
ultimately succeeds or already errors for another reason — see "Consequences"
below.

### 2. `tools/list` / `server/discover` credential requirement

Gated by the independent `protectCatalog: true` opt-in. When absent (the
default), both methods keep ADR-0038's public, unauthenticated, Policy-free
shape exactly. When present, the same preflight runs before dispatch and, on
an `"unauthenticated"` outcome, returns the same `401` + challenge shape as
`tools/call`. This is **not** per-Principal filtering — every credentialed
caller still sees the identical static catalogue; the change is binary
(credentialed or not), matching ADR-0038's explicit boundary that a curated,
per-audience catalogue is a separate, larger decision this ADR does not make.

Default chosen: **stay public** (`protectCatalog` defaults to `false`/absent).
Justification: ADR-0038 is Accepted and explicitly forbids a silent default
change here; this ADR is Proposed and cannot supersede that default without
its own formal acceptance. An application that wants MCP OAuth discovery to
work from the very first, unauthenticated `tools/list` probe (a common MCP
client pattern: attempt a call, read the `401` + `resource_metadata` link,
then get a token) opts in explicitly with `protectCatalog: true` **and**
`challenge`; nothing changes for an application that does not.

### 3. Canonical HTTP `401` header

`httpJsonResponse`/`httpFailure`/`resolveHttpPrincipal`
(`packages/runtime/src/application/http-carrier.ts`) gain an optional
`wwwAuthenticate` parameter, threaded from the same `credentialChallenge`
through `createCanonicalQueryHttp`, `createCanonicalQueryApplicationHttp`, and
`createCanonicalPostHttp`. Unlike MCP, canonical HTTP's status code was
already `401` for `UNAUTHENTICATED`; this is a pure header addition with no
status-code or gating change, so there is no backward-compatibility hinge to
design here — an application with no `challenge` gets exactly today's headerless
`401` body.

### Ordering: protocol-version and metadata checks precede authentication

`createMcpIngress.fetch` validates JSON-RPC envelope shape, the fixed
`2026-07-28` protocol version and `_meta`/`Mcp-Method`/`Mcp-Name` header
agreement **before** the new authentication preflight, which itself runs
**before** any method-specific dispatch (`server/discover` body,
`tools/list` catalogue, or `tools/call`'s "Unknown tool" lookup). Rationale:
protocol/version/metadata checks are transport-level and identical for every
caller regardless of identity — they disclose nothing application-specific.
Authentication, by contrast, gates the first point where a response could
disclose something about the application (the catalogue, or whether a named
tool exists) to an untrusted caller. Running the preflight immediately before
dispatch — and, for `tools/call`, before the "Unknown tool" existence check —
means an unauthenticated caller never learns whether a requested tool exists.

## Consequences

- Zero behavior change for every application that does not declare
  `challenge` — this is the load-bearing compatibility property; it is
  covered by tests (`tests/unit/mcp02-runtime-ingress.test.ts`,
  `tests/unit/http02-canonical-*-runtime.test.ts`).
- An application that declares `challenge` pays one duplicate
  `resolvePrincipal` call per `tools/call` request on the
  authenticated/erroring path (the ingress preflight, plus `mcpOperation`'s
  own resolution once execution proceeds). This is a deliberate trade: it is
  the smallest change that lets the ingress commit the correct HTTP status
  before the SSE stream starts, without teaching the protocol layer
  (`mcp/index.ts`) anything about Principals, or teaching the operation layer
  (`mcp-operation.ts`) anything about HTTP status codes. A follow-up could
  thread the already-resolved Principal from the preflight into `execute` to
  remove the duplicate call; deferred because it would touch
  `createMcpOperationAdapter`'s well-tested contract
  (`tests/unit/mcp02-operation-adapter.test.ts`) for a performance win, not a
  new capability.
- The framework still learns nothing about OAuth: `challenge` is an opaque
  string (or a function producing one) that the framework only forwards. No
  scope, resource-indicator, or token-validation logic exists in
  `packages/runtime` or `packages/compiler` after this change.
- Per-Principal catalogue filtering, per-operation MCP opt-out, curated
  descriptions, tool-name aliases, scope/Policy changes, and MCP sessions
  remain explicitly out of scope, per the board item's framing.

## Acceptance

Not yet accepted. This ADR documents a Product-tier addition (ADR-0027
classification: projects an accepted Kernel through Route/application
credential and MCP ingress seams; no Kernel guarantee changes) delivered
under `docs/v4/DELIVERY-FLOW.md` §implementation.md with tracer-led TDD and
ordinary integration tests. See
`docs/v4/implementation/mcp-credential-challenge.md` for exact commands and
results. Formal `review:accept` is not invoked for this tier per
`DELIVERY-FLOW.md` §3.
