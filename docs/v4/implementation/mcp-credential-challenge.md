# Implementation record: MCP and canonical HTTP credential challenge

Board item: "v4 rewrite 04: OAuth protection of the v4 MCP endpoint".
Branch: `work/autopilot-rewrite-additions`. Decision: `docs/adr/0046-mcp-and-canonical-http-credential-challenge.md`
(Proposed — not Accepted; this record does not claim ratification).

This record covers two passes: the original implementation (commit
`e4e198ed4`), and a security-review-driven fix pass (this commit) that
corrected three fail-open bugs (F1/F2/F3) found in the first pass. ADR-0046
was rewritten in place to describe the corrected design directly; its
"Revision" section documents what was wrong and why.

## Scope delivered

1. `POST /_questpie/mcp` `tools/call` can return a real HTTP `401`/`503`/`408`
   on a missing/invalid credential, a credential-provider outage, or a missed
   deadline, carrying an app-supplied `WWW-Authenticate` header, instead of
   always the framework-fixed `200`/SSE JSON-RPC error frame.
2. The same `WWW-Authenticate` header on canonical HTTP `401`s.
3. `tools/list`/`server/discover` can require a valid credential via
   `protectCatalog: true`; `tools/call` can require one (rejecting anonymous
   too) via `requireCredential: true`. Both default `false` — ADR-0038's
   shipped default is unchanged unless an app opts in. No per-Principal
   filtering.

Out of scope, untouched: per-operation MCP opt-out, curated descriptions,
tool-name aliases, scopes/Policy changes, MCP sessions, any OAuth logic in the
framework.

## Security review findings and their fixes

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| F1 | Critical | Anonymous Principal treated as authenticated; the common "no `Authorization` header" shape defeated the gate entirely. | `createMcpCredentialPreflight` now treats `caller.kind === "anonymous"` as `"unauthenticated"` once armed. |
| F2 | High | Arming depended on `challenge(request)`'s per-request return value, not a fixed flag; `protectCatalog` without `challenge` protected nothing, and a request-derived challenge returning `undefined` silently disarmed the gate. | Arming is now two independent, definition-time booleans (`protectCatalog`, `requireCredential`); `challenge` is purely decorative and never gates anything. |
| F3 | High | `RuntimeCredentialUnavailable` (provider outage) fell through to the public/unauthenticated path — fail-open. | New `"unavailable"` outcome maps to a real `503`; `"deadline"` (aborted resolution) maps to `408`. Neither is ever deferred when armed. |
| F4 | Medium | `challenge` value never validated; a throwing function or CR/LF-bearing value could escape as an unobserved `500` or header injection. | `safeCredentialChallenge` (`http-carrier.ts`) wraps every call: thrown exceptions, non-strings, empty strings, and control characters all degrade to "no header", never a thrown error, never a leaked message, never a change in the already-decided status. Shared by canonical HTTP and MCP. |
| F5 | Medium | `tools/call` resolved the credential twice when armed (ingress preflight + `mcp-operation.ts`'s own resolution) — a TOCTOU risk for one-time tokens/rate counters. | The preflight's resolved Principal is threaded through `createMcpIngress`'s `execute` call and `createMcpOperationAdapter`'s invocation (`principal?` field, additive, backward compatible); `mcp-operation.ts` skips its own resolution when a Principal is already provided. Not armed → unchanged, single resolution as before. |
| F6 | Medium | (i) The compiled contract never captured `challenge`/`protectCatalog`/`requireCredential`, so the options could be silently dropped anywhere in discovery/codegen with no failing test. (ii) No test exercised `mcpAuthenticate`/the compiled wiring at all. | (i) `compositionContract("credentialResolver", ...)` now returns `hasChallenge`/`protectCatalog`/`requireCredential`, tested directly (`credential-resolver-composition-contract.test.ts`). (ii) The preflight was extracted to its own testable module (`mcp-authenticate.ts`) with 12 direct unit tests; `createMcpIngress`'s gating/status/header/principal-passthrough is exercised directly. **Not fully closed**: no fixture compiled with the flags turned on was exercised end-to-end — see "Open follow-up". |
| F7 | Low | MCP `401` lacked `cache-control: private, no-store`; raw-Route `401`s never got the challenge header. | Added `cache-control: private, no-store` to every MCP gate response (`gateFailure` helper). Route `401`s are explicitly left alone — Routes already own their raw `Response` (ADR-0015); documented in ADR-0046 §F7 rather than adding a second, competing header-injection path. |
| F8 | Low | Comment blocks restated the ADR instead of documenting the code. | Trimmed the `createMcpIngress`/`unauthorized` doc comments to the mechanism, not a copy of the ADR prose. |

## Seam (exact app-facing API, corrected)

```ts
defineCredentialResolver({
	name: "...",
	service: authService,
	resolve: async ({ request, service }) => {
		/* unchanged */
	},
	challenge: 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
	protectCatalog: true, // arms tools/list + server/discover
	requireCredential: true, // arms tools/call, including rejecting anonymous
});
```

`challenge` never arms anything by itself. See ADR-0046 for the full
decision record, including why `requireCredential` is a blunt "no anonymous
calls at all" instrument rather than per-operation.

## Files changed (this pass, on top of `e4e198ed4`)

- `packages/questpie/src/credential-resolver.ts` — `requireCredential` field.
- `packages/compiler/src/composition/index.ts` — `hasChallenge`,
  `protectCatalog`, `requireCredential` in the credential-resolver
  composition contract (F6i).
- `packages/compiler/src/runtime/application.ts` — generates
  `mcpCallsRequireCredential` alongside the existing `mcpCatalogRequiresCredential`.
- `packages/runtime/src/application/contract.ts` — `mcpCallsRequireCredential`
  on `RuntimeApplicationProgram`.
- `packages/runtime/src/application/http-carrier.ts` — `safeCredentialChallenge`
  (F4), used by `resolveHttpPrincipal`.
- `packages/runtime/src/application/mcp-authenticate.ts` — **new**:
  `createMcpCredentialPreflight`, the extracted, directly-testable preflight
  (F1/F3/F4/F6ii).
- `packages/runtime/src/application/mcp-operation.ts` — `principal?` on the
  invocation, skips `resolvePrincipal` when provided (F5).
- `packages/runtime/src/application/mcp/index.ts` — `requireCredential` input,
  `"unavailable"`/`"deadline"` outcomes → `503`/`408`, `cache-control` on
  every gate response (F7), `principal` passthrough to `execute`, trimmed
  comments (F8).
- `packages/runtime/src/application/index.ts` — uses
  `createMcpCredentialPreflight` instead of an inline closure; wires
  `requireCredential`.
- Tests: `tests/unit/mcp-authenticate.test.ts` (new, 12 cases — F1/F2/F3/F4
  directly against the extracted preflight), `tests/unit/mcp02-runtime-ingress.test.ts`
  (+9 cases: armed/unarmed routing, 503/408 mapping, cache-control, principal
  passthrough), `tests/unit/mcp02-operation-adapter.test.ts` (+2: principal
  passthrough skips resolution / still resolves without one — F5),
  `tests/unit/http02-canonical-query-runtime.test.ts` (+2: throwing/CRLF
  challenge — F4), `tests/unit/credential-resolver-challenge.test.ts` (+1:
  `requireCredential` normalization), `tests/unit/credential-resolver-composition-contract.test.ts`
  (new, 3 cases — F6i).
- Docs: `docs/adr/0046-mcp-and-canonical-http-credential-challenge.md`
  (rewritten in place with a "Revision" section), this file.

## Open follow-up (F6(ii), not completed)

No fixture (Team Support Desk / Collaboration, or a new synthetic one) was
compiled with `protectCatalog`/`requireCredential` actually turned on and
exercised through a live compile → migrate → HTTP call cycle. The mechanism
is proven at the unit level (`createMcpCredentialPreflight` directly,
`createMcpIngress`'s gating directly, `createMcpOperationAdapter`'s
passthrough directly — these are the exact functions the compiled wiring
calls, not stand-ins for them), and both PostgreSQL regression suites confirm
a real compiled app with neither flag set is unaffected. Closing this
requires either a new minimal Postgres-backed fixture or an additional
compiled variant of an existing one; not done here given the proof budget.

## Commands run and results (this pass)

All commands run from
`/home/drepkovsky/code/questpie-v4-worktrees/autopilot-rewrite-additions`
with `TMPDIR=/home/drepkovsky/.cache/v4-mcp-auth-tmp`, foreground only (no
background jobs left running).

- `bun run check:changed -- --typecheck @questpie/runtime` — PASS (oxfmt +
  oxlint + `tsc --noEmit` + `git diff --check`; one intermediate type error
  in `mcp-authenticate.ts`'s `resolvePrincipal` parameter type found and
  fixed — `Promise<Principal|null>` narrowed too tightly versus the
  program's `MaybePromise<Principal|null>`).
- `bun run check:changed -- --typecheck @questpie/compiler` — PASS.
- `bun run check:changed -- --typecheck questpie` — PASS.
- `bun run package:check` — PASS ("2 publishable package(s) valid").
- `bun test` across every touched/added unit test file (mcp01–mcp03,
  `mcp-authenticate.test.ts`, `http02-*`, `credential-resolver-*`,
  `beta05-runtime-application.test.ts`, `beta03-service-composition.test.ts`,
  `compiler-application-*`) — **109 pass, 0 fail, 598 assertions**.
- `bun test tests/integration/route-auth-runtime.test.ts` — 11 pass, 0 fail.
- PostgreSQL regressions, own disposable container (same recipe as the first
  pass), each run **alone**:
  - `collaboration-walking-skeleton.test.ts` — 1 pass, 398 assertions.
  - `team-support-desk.test.ts` (`FIREFOX_BIN=/usr/bin/firefox`) — 1 pass,
    111 assertions.
  - Container removed after (`docker stop v4-mcp-auth-pg`).
- Full `bun test tests/unit`, split into 8 foreground chunks (~25 files each,
  under the 120s tool timeout, no background run this time): all 8 chunks
  green — totals across chunks: 904 pass + 1 pre-existing skip (unrelated;
  same skip observed in the full-suite run from the first pass), 0 fail,
  4886 `expect()` calls, 18 snapshots.
- `quality:full`/`quality:release`: **not run**, same reasoning as the first
  pass (release checksum already red for an unrelated reason; out of scope
  per the brief to only confirm nothing *else* newly fails, which the above
  gates support but do not directly verify).
- `git diff --check` — clean on every `check:changed` invocation.

## Unverified / follow-up (carried forward)

- F6(ii): no fixture-level positive test with the flags turned on (see
  above).
- `quality:full`/`quality:release` not run.
- The `resolvePrincipal` duplication is now eliminated on the armed path
  (F5), so the previously-noted performance trade-off no longer applies;
  removed from this list.
- Public docs pages were not updated; ADR-0046 remains Proposed.
