# Implementation record: MCP and canonical HTTP credential challenge

Board item: "v4 rewrite 04: OAuth protection of the v4 MCP endpoint".
Branch: `work/autopilot-rewrite-additions`. Decision: `docs/adr/0046-mcp-and-canonical-http-credential-challenge.md`
(Proposed — not Accepted; this record does not claim ratification).

This record covers three passes: the original implementation (`e4e198ed4`), a
security-review-driven fix pass (`63573fc7f`) that corrected three fail-open
bugs (F1/F2/F3), and a follow-up pass (this commit) that closes F6(ii) — a
compiled-application-level test the second pass left open — and corrects an
addition error in that pass's reported unit-test total. ADR-0046 was
rewritten in place to describe the corrected design directly; its "Revision"
section documents what was wrong and why.

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

| #   | Sev      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Critical | Anonymous Principal treated as authenticated; the common "no `Authorization` header" shape defeated the gate entirely.                                                                                                                                                                                                                                                                                                  | `createMcpCredentialPreflight` now treats `caller.kind === "anonymous"` as `"unauthenticated"` once armed.                                                                                                                                                                                                                                                                                                                                                        |
| F2  | High     | Arming depended on `challenge(request)`'s per-request return value, not a fixed flag; `protectCatalog` without `challenge` protected nothing, and a request-derived challenge returning `undefined` silently disarmed the gate.                                                                                                                                                                                         | Arming is now two independent, definition-time booleans (`protectCatalog`, `requireCredential`); `challenge` is purely decorative and never gates anything.                                                                                                                                                                                                                                                                                                       |
| F3  | High     | `RuntimeCredentialUnavailable` (provider outage) fell through to the public/unauthenticated path — fail-open.                                                                                                                                                                                                                                                                                                           | New `"unavailable"` outcome maps to a real `503`; `"deadline"` (aborted resolution) maps to `408`. Neither is ever deferred when armed.                                                                                                                                                                                                                                                                                                                           |
| F4  | Medium   | `challenge` value never validated; a throwing function or CR/LF-bearing value could escape as an unobserved `500` or header injection.                                                                                                                                                                                                                                                                                  | `safeCredentialChallenge` (`http-carrier.ts`) wraps every call: thrown exceptions, non-strings, empty strings, and control characters all degrade to "no header", never a thrown error, never a leaked message, never a change in the already-decided status. Shared by canonical HTTP and MCP.                                                                                                                                                                   |
| F5  | Medium   | `tools/call` resolved the credential twice when armed (ingress preflight + `mcp-operation.ts`'s own resolution) — a TOCTOU risk for one-time tokens/rate counters.                                                                                                                                                                                                                                                      | The preflight's resolved Principal is threaded through `createMcpIngress`'s `execute` call and `createMcpOperationAdapter`'s invocation (`principal?` field, additive, backward compatible); `mcp-operation.ts` skips its own resolution when a Principal is already provided. Not armed → unchanged, single resolution as before.                                                                                                                                |
| F6  | Medium   | (i) The compiled contract never captured `challenge`/`protectCatalog`/`requireCredential`, so the options could be silently dropped anywhere in discovery/codegen with no failing test. (ii) No test crossed the compiler → manifest → runtime boundary at all — a dropped option between `defineCredentialResolver` and the runtime could not be caught by unit tests against the extracted preflight by construction. | (i) `compositionContract("credentialResolver", ...)` now returns `hasChallenge`/`protectCatalog`/`requireCredential`, tested directly. (ii) **Closed in the follow-up pass**: `tests/integration/postgres/mcp-credential-gate.test.ts` compiles two real variants of the Team Support Desk fixture with the real CLI (`bun cli.js build`), boots each with the real runtime (`createApp`), and drives `/_questpie/mcp` over the real `fetch` handler — see below. |
| F7  | Low      | MCP `401` lacked `cache-control: private, no-store`; raw-Route `401`s never got the challenge header.                                                                                                                                                                                                                                                                                                                   | Added `cache-control: private, no-store` to every MCP gate response (`gateFailure` helper). Route `401`s are explicitly left alone — Routes already own their raw `Response` (ADR-0015); documented in ADR-0046 §F7 rather than adding a second, competing header-injection path.                                                                                                                                                                                 |
| F8  | Low      | Comment blocks restated the ADR instead of documenting the code.                                                                                                                                                                                                                                                                                                                                                        | Trimmed the `createMcpIngress`/`unauthorized` doc comments to the mechanism, not a copy of the ADR prose.                                                                                                                                                                                                                                                                                                                                                         |

## Seam (exact app-facing API, corrected)

```ts
defineCredentialResolver({
	name: "...",
	service: authService,
	resolve: async ({ request, service }) => {
		/* unchanged */
	},
	challenge:
		'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
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

## F6(ii) closure: `tests/integration/postgres/mcp-credential-gate.test.ts`

**What crosses the compile boundary.** The test copies the real Team Support
Desk fixture into two separate temp directories (two distinct absolute
paths — see "why two directories" below):

- `unarmedRoot`: the pristine, unmodified fixture — byte-identical to what
  every other Team Support Desk test compiles.
- `armedRoot`: the same fixture with `src/auth/credentials.ts` **overwritten**
  (`armCredentialResolver`) to add `challenge`, `protectCatalog: true`,
  `requireCredential: true` to the exact same `defineCredentialResolver` call,
  as static literals — not an environment-variable branch. The compiler
  rejects `process` references inside structural source
  (`QP-COMPOSE-010 impureStructuralGraph`, discovered while building this
  test — an env-gated resolver was the first design and it failed compilation
  immediately, which is itself evidence the compiler enforces determinism
  here), so an env-driven single fixture was not an option.

Each directory is compiled with the **real CLI** (`bun packages/questpie/dist/cli.js build`,
the same binary `runCli` invokes in `team-support-desk.test.ts`), migrated
and seeded against a real disposable PostgreSQL 17 container, and booted with
the **real runtime** (`createApp` from the generated `.questpie/generated/app.ts`,
i.e. `application.createApplication`). Both apps are then driven over their
real `fetch(request)` handler — no test double anywhere in the request path.
`compositionContract` (the same function `packages/compiler/src/composition/index.ts`
uses during discovery) is additionally called directly against each
directory's freshly-imported `credentials.ts` module to compare the compiled
contracts.

**Why two directories, not one rebuilt in place.** The first attempt reused
one temp directory, rebuilding it in place for the armed pass. It
deterministically failed: re-importing the same absolute module path with
changed file content, within the same Bun process, did not observe the
change — `compositionContract` kept reporting the pristine (unarmed) shape
even after the file was overwritten and rebuilt. This matches a known,
already-documented Bun defect in this repository's own harness notes ("Bun
test-host resolution and shared installer-cache defects have reproductions
in the native evidence" — `HANDOFF.md`); per that same note, it is not a
reason to add framework-side resolution fallbacks. Two distinct directories
route around it cleanly.

**The six assertions and their results** (all in one 180s test, `1 pass, 0
fail, 36 expect() calls`):

1. No credential → `401`, exact `WWW-Authenticate`, `cache-control: private, no-store`, on `tools/list`, `server/discover`, and `tools/call` — **passes**.
2. An invalid/garbage session cookie (this resolver's own definition of "attempted a credential and got `anonymous` back") → the same `401` — **passes**.
3. A valid credential (real better-auth sign-in) → the catalogue (`tools/list`) is byte-identical to the unarmed catalogue, and `tools/call` succeeds with a normal result frame — **passes**.
4. Authenticated (valid credential) but denied at the Context/Policy layer (a real membership-ownership mismatch, reusing the fixture's own `supportContext` nondisclosure check) → status `200`, `content-type: text/event-stream`, `isError: true`, no `WWW-Authenticate` header, and the error code is explicitly asserted **not** `UNAUTHENTICATED` — **passes**.
5. The same fixture compiled **without** the flags → `tools/list` public, contains the known tool, no `WWW-Authenticate` header — **passes**.
6. The compiled contract differs between the two variants in exactly `hasChallenge`/`protectCatalog`/`requireCredential` (name/service/executableSlots/format/version equal) — **passes**.

The committed fixture on disk (`fixtures/team-support-desk/src/auth/credentials.ts`)
is never modified — only the two temp copies are. No other Team Support Desk
test is affected (confirmed by rerunning it standalone below).

## Commands run and results

### Second pass (`63573fc7f`, F1–F5/F7/F8)

- `bun run check:changed -- --typecheck @questpie/runtime` — PASS (one
  intermediate type error in `mcp-authenticate.ts`'s `resolvePrincipal`
  parameter found and fixed).
- `bun run check:changed -- --typecheck @questpie/compiler` — PASS.
- `bun run check:changed -- --typecheck questpie` — PASS.
- `bun run package:check` — PASS.
- Touched/added unit test files — 109 pass, 0 fail, 598 assertions.
- `bun test tests/integration/route-auth-runtime.test.ts` — 11 pass, 0 fail.
- Both PostgreSQL regressions, run alone — 398 and 111 assertions, 1 pass
  each.
- `quality:full`/`quality:release` — not run (see below).

### Third pass (this commit, F6(ii) + unit-count correction)

All commands run from
`/home/drepkovsky/code/questpie-v4-worktrees/autopilot-rewrite-additions`
with `TMPDIR=/home/drepkovsky/.cache/v4-mcp-auth-tmp`, foreground only.

- `bunx oxfmt --check` / `bunx oxlint --deny-warnings` on
  `tests/integration/postgres/mcp-credential-gate.test.ts` — PASS.
- `git diff --check` — clean.
- Own disposable PostgreSQL 17 container
  (`docker run -d --rm --name v4-mcp-auth-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_INITDB_ARGS=--locale=C.UTF-8 -p 127.0.0.1:55621:5432 postgres:17`):
  - `tests/integration/postgres/mcp-credential-gate.test.ts` — **1 pass, 0
    fail, 36 `expect()` calls** (see the six-assertion breakdown above).
    First attempt (single rebuilt-in-place directory) failed on a real Bun
    import-cache defect, documented and routed around — see above.
  - `tests/integration/postgres/collaboration-walking-skeleton.test.ts`,
    run alone — 1 pass, 398 assertions (unaffected).
  - `tests/integration/postgres/team-support-desk.test.ts`, run alone
    (`FIREFOX_BIN=/usr/bin/firefox`) — 1 pass, 111 assertions (unaffected;
    the committed fixture source was never modified by this pass).
  - Container stopped after (`docker stop v4-mcp-auth-pg`); no leftover temp
    directories or processes (checked with `ls /tmp | grep questpie-mcp-gate`
    and `ps aux | grep questpie/dist/cli.js`).
- Full `bun test tests/unit`, split into the same 8 foreground chunks as the
  second pass, re-run and summed correctly this time:

  | chunk     | files   | pass     | skip  | fail  |
  | --------- | ------- | -------- | ----- | ----- |
  | 1         | 25      | 209      | 0     | 0     |
  | 2         | 26      | 134      | 0     | 0     |
  | 3         | 23      | 106      | 0     | 0     |
  | 4         | 25      | 105      | 1     | 0     |
  | 5         | 25      | 134      | 0     | 0     |
  | 6         | 25      | 90       | 0     | 0     |
  | 7         | 20      | 113      | 0     | 0     |
  | 8         | 24      | 113      | 0     | 0     |
  | **total** | **193** | **1004** | **1** | **0** |

  193 files matches `ls tests/unit/*.test.ts | wc -l` exactly (`tests/unit`
  has 194 entries; the 194th is the `__snapshots__` directory, not a test
  file) — **no files were skipped**. The second pass's reported "904 pass"
  was an addition error made while summarizing the same eight numbers, not a
  missing-file problem; the correct sum is **1004 pass + 1 pre-existing,
  unrelated skip = 1005 of 1005 tests, 0 fail**. This also reconciles against
  the first pass's 981 pass / 191 files: two new files
  (`mcp-authenticate.test.ts`, `credential-resolver-composition-contract.test.ts`)
  and roughly two dozen new assertions added across the second pass account
  for the increase.

- `quality:full`/`quality:release`: **not run**, same reasoning as the prior
  two passes (release checksum already red for an unrelated reason; out of
  scope per the brief to only confirm nothing _else_ newly fails).

## Unverified / follow-up

- `quality:full`/`quality:release` not run (all three passes).
- Public docs pages were not updated; ADR-0046 remains Proposed.
- F6(ii) is now closed; no further fixture-level gap is known.
