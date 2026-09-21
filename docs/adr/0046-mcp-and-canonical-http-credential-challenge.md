# ADR-0046: MCP and canonical HTTP credential challenge

- Status: Proposed
- Date: 2026-09-21 (revised same day after a security review; see
  "Revision" below)
- Owners: Product architecture, Runtime ingress, MCP projection

## Context

Board item "v4 rewrite 04: OAuth protection of the v4 MCP endpoint" asked
whether `POST /_questpie/mcp` and the canonical HTTP surfaces can carry a real
OAuth 2.1 / RFC 9728 `401` challenge on a missing or invalid credential. Prior
research (`docs/architecture/v4-mcp-oauth-seam-2026-09-21.md` in the Autopilot
repository, re-verified against source) found that everything an application
needs to validate an OAuth access token, mint a Principal, and serve
`.well-known/oauth-protected-resource` from a raw Route already works with
existing seams (ADR-0015 Route/credential-resolver composition). The gaps are
in response shape, owned by the framework, not the application:

- `createMcpOperationAdapter` always wraps a credential-resolver failure in a
  `200`/SSE JSON-RPC error frame — no HTTP status or header the app can shape.
  ADR-0038 explicitly accepted this shape, so it is not an oversight to
  silently reverse for every existing application.
- `tools/list`/`server/discover` never call `resolvePrincipal` (ADR-0038:
  "Listing evaluates neither Principal nor Policy"); the catalogue is fully
  public and static by design.
- Canonical HTTP already returns a real `401` for `UNAUTHENTICATED`, but has
  no header-injection seam for `WWW-Authenticate`.

Authorization (Policy) denials for an authenticated caller are a different,
unaffected code path and this decision does not touch them. ADR-0038 says a
future catalogue decision "must preserve one metadata/schema owner and cannot
silently change the basic default" — any change must be opt-in.

## Revision (same day): a security review found the first cut fail-open

The first committed version of this ADR gated the `401` short-circuit on
whether the app's `challenge(request)` function *returned a defined string
for this exact Request*. A cross-model security review (`FIX-THEN-MERGE`,
commit history same day) found this was fail-open in the common case:

- **F1 (critical):** an anonymous Principal (the normal shape of "no
  `Authorization` header, resolver returns `{ kind: "anonymous" }`") passed
  `principal.is()` and was treated as authenticated. An app that also serves
  public operations — i.e. most apps — got a protected catalogue that
  protected nothing and a `tools/call` gate that never fired for the single
  most common unauthenticated request shape.
- **F2 (high):** arming depended on the *return value* of `challenge`, not on
  a fixed, definition-time fact. `protectCatalog: true` without `challenge`
  configured armed nothing; a request-derived `challenge` function that
  returned `undefined` for a given Request (Host/query-influenced, i.e.
  attacker-influenced) silently turned the whole gate off for that request.
- **F3 (high):** a credential-provider outage
  (`RuntimeCredentialUnavailable`) was classified `"deferred"` and fell
  through to the public/unauthenticated path instead of failing closed.

This section documents the fix; the "Decision" section below describes the
corrected, shipped design directly (not the superseded one).

## Decision

Two independent, explicit, definition-time boolean flags on
`defineCredentialResolver` **arm** the real-`401`/`503`/`408` mechanism. A
`challenge` value, if configured, is attached to whatever the armed gate
already decided — it never decides anything itself.

```ts
defineCredentialResolver({
	name: "...",
	service: authService,
	resolve: async ({ request, service }) => {
		/* existing behavior, unchanged */
	},
	// Purely decorative. Never gates anything; a throwing function, a
	// non-string/empty/control-character return, or no configuration at all
	// all degrade to "no header", never to a thrown exception or a change in
	// status. See safeCredentialChallenge (F4).
	challenge: 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
	// Arms tools/list and server/discover: anonymous/malformed/no credential
	// -> 401; provider outage -> 503. Default false: today's public catalogue.
	protectCatalog: true,
	// Arms tools/call: an ANONYMOUS Principal now counts as unauthenticated
	// too (not just malformed/thrown credentials). Default false: today's
	// behavior — tools/call still always resolves a credential, but an
	// anonymous outcome is passed to each Operation's own admission/Policy,
	// exactly as it is on canonical HTTP (a public network:true Operation
	// stays callable anonymously over MCP).
	requireCredential: true,
});
```

### 1 & 3. `tools/call` and canonical HTTP credential-failure shape

`createMcpIngress` gains an `authenticate(request, signal)` preflight, called
**only** for an armed method. The classification
(`packages/runtime/src/application/mcp-authenticate.ts`,
`createMcpCredentialPreflight`, extracted specifically so it is unit-testable
independent of the ingress and the compiled wiring) is:

- resolved, non-anonymous Principal → `"authenticated"` (carries the
  Principal — see F5 below);
- `null`/invalid/**anonymous** Principal → `"unauthenticated"` (401 + optional
  challenge) — F1's fix: anonymous is deliberately not authenticated once
  armed;
- `RuntimeCredentialUnavailable` (provider outage) → `"unavailable"` (503) —
  F3's fix: never silently deferred;
- an aborted resolution → `"deadline"` (408);
- any other, unclassified resolver error → `"deferred"`: still falls through
  to today's `200`/SSE-wrapped `INTERNAL` frame, unchanged — nobody asked to
  change that case, so it is not touched.

`tools/call`'s gate is `requireCredential`; `tools/list`/`server/discover`'s
is `protectCatalog`. **Neither is ever armed by `challenge`'s presence or
return value** (F2's fix) — an unconfigured app (both flags absent/false)
never calls `authenticate` at all, so it is provably unchanged from
ADR-0038's shipped shape.

The `401`/`503`/`408` bodies are JSON-RPC error frames with framework-chosen,
non-colliding codes (`-32001`/`-32002`/`-32003`) and
`cache-control: private, no-store` (matching canonical HTTP's discipline —
F7). Canonical HTTP's status was already correct before this ADR; it only
gains the `wwwAuthenticate` header, unconditionally available (no arming
needed, since the status never changes there).

### 2. `tools/list` / `server/discover`

Gated by `protectCatalog`, independent of `requireCredential`. Default
`false` (ADR-0038's public catalogue), because ADR-0038 is Accepted and this
ADR is Proposed — it cannot supersede that default. Still not per-Principal
filtering: every credentialed caller sees the identical catalogue.

### 4. F4: challenge value safety

`safeCredentialChallenge` (`http-carrier.ts`, shared by canonical HTTP and,
via `mcp-authenticate.ts`, MCP) wraps every call to the app's `challenge`
function: a thrown exception, a non-string return, an empty string, or a
value containing control characters (CR/LF header injection, etc.) all
degrade to **no header** — chosen over a `500` because a misconfigured
`challenge` is an application authoring mistake, not a framework fault, and
degrading to a valid, still-denying `401`/`503` keeps the endpoint fail-closed
(the caller is still refused) without leaking an exception message or an
unobserved crash. The previous ADR draft's claim "there is no header-injection
seam" was itself the bug this revision fixes — this is now the seam, with
input validation.

### 5. F5: the credential is resolved exactly once

When `requireCredential` is armed, `tools/call`'s preflight already resolves
the Principal before deciding the response shape. `createMcpIngress` now
threads that resolved Principal into `execute`'s invocation (`principal?`),
and `createMcpOperationAdapter`
(`packages/runtime/src/application/mcp-operation.ts`) uses it directly when
present, skipping its own `resolvePrincipal` call entirely — this **does**
change `createMcpOperationAdapter`'s contract (additive: a new optional
`principal` field on the invocation), preserving every existing caller that
doesn't pass one (`tests/unit/mcp02-operation-adapter.test.ts` is unmodified
and still exercises the resolve-here path). When `requireCredential` is not
armed, there is only ever one resolution (inside `execute`, as always) — the
double-resolution this fixes only existed on the armed path.

### Ordering

Protocol-version/envelope/metadata checks precede the authentication
preflight, which precedes all method dispatch (including `tools/call`'s
"Unknown tool" lookup), so an unauthenticated caller never learns catalogue
membership. Unaffected by this revision.

### F7: raw Routes are explicitly out of scope

`execution/routes.ts` already lets an app-owned Route handler return any
`Response` it wants, including its own `WWW-Authenticate` header (ADR-0015:
"the bounded raw Fetch escape hatch... handler receives the exact
`Request`... returns a `Response`"). This ADR does not thread
`credentialChallenge` into the Route executor's own `401`/`503` failures
(`routes.ts:429,520`) — those are already fully app-controlled at the Route
authoring level, so adding a second, framework-owned header-injection path
there would be a redundant, competing mechanism, not a gap.

## Consequences

- Zero behavior change for an application that arms neither flag — the
  load-bearing compatibility property, covered by
  `tests/unit/mcp02-runtime-ingress.test.ts`,
  `tests/unit/http02-canonical-*-runtime.test.ts`, and both PostgreSQL
  regression suites (Team Support Desk, Collaboration), whose credential
  resolvers configure neither flag and pass unchanged.
- `requireCredential` is a blunt instrument: it rejects an anonymous caller
  for **every** `tools/call`, even one targeting a `network: true` Operation
  whose own Policy would admit an anonymous caller. An app that wants
  authentication required only for specific operations must keep doing that
  at the Operation/Policy level (out of scope here, per the board item) and
  leave `requireCredential` off.
- The framework still learns nothing about OAuth: `challenge` is an opaque,
  validated string the framework only forwards.
- Per-Principal catalogue filtering, per-operation MCP opt-out, curated
  descriptions, tool-name aliases, scope/Policy changes, and MCP sessions
  remain explicitly out of scope.
- The compiled composition contract for a credential resolver now captures
  `hasChallenge`/`protectCatalog`/`requireCredential` as booleans (not the
  function/value itself, which is unhashable and request-dependent) —
  `packages/compiler/src/composition/index.ts`, `compositionContract`. This
  closes F6(i): dropping any of these options anywhere in the
  discovery/codegen pipeline now changes the digested contract, caught by
  `tests/unit/credential-resolver-composition-contract.test.ts`.

## Open follow-up (F6(ii), not completed in this revision)

The reviewer asked for fixture-level tests "through the compiled
application" (Team Support Desk or a synthetic fixture) covering every
scenario in this ADR. This revision proves the mechanism at the unit level —
`createMcpCredentialPreflight` directly (`tests/unit/mcp-authenticate.test.ts`,
12 cases covering F1–F4), `createMcpIngress`'s gating/status/header/principal-
passthrough behavior directly (`tests/unit/mcp02-runtime-ingress.test.ts`),
`createMcpOperationAdapter`'s principal-passthrough directly
(`tests/unit/mcp02-operation-adapter.test.ts`) — and confirms via both
PostgreSQL regression suites, run alone, that a real compiled app with a
credential resolver that configures none of these options compiles and
behaves byte-identically. It does **not** include a fixture compiled with
`protectCatalog`/`requireCredential` actually turned on and exercised through
a live compile → migrate → HTTP call cycle. This is the one item from the
review not closed here; it is the top follow-up for the next session.

## Acceptance

Not yet accepted. Product-tier addition (ADR-0027 classification: no Kernel
guarantee changes) delivered under `docs/v4/DELIVERY-FLOW.md`
§implementation.md. See `docs/v4/implementation/mcp-credential-challenge.md`
for exact commands and results. Formal `review:accept` is not invoked for
this tier per `DELIVERY-FLOW.md` §3.
