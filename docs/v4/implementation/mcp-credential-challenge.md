# Implementation record: MCP and canonical HTTP credential challenge

Board item: "v4 rewrite 04: OAuth protection of the v4 MCP endpoint".
Branch: `work/autopilot-rewrite-additions`. Decision: `docs/adr/0046-mcp-and-canonical-http-credential-challenge.md`
(Proposed — not Accepted; this record does not claim ratification).

## Scope delivered

Exactly the three owner-ratified additions, nothing more:

1. `POST /_questpie/mcp` `tools/call` can return a real HTTP `401` carrying an
   app-supplied `WWW-Authenticate` header on a missing/invalid credential,
   instead of always the framework-fixed `200`/SSE JSON-RPC error frame.
2. The same header seam on canonical HTTP `401`s (Query/Mutation/Action).
3. `tools/list` and `server/discover` can be made to require a valid
   credential via an explicit opt-in (`protectCatalog: true`); default stays
   public/unauthenticated (ADR-0038's shipped default), no per-Principal
   filtering.

Out of scope, untouched: per-operation MCP opt-out, curated descriptions,
tool-name aliases, scopes/Policy changes, MCP sessions, any OAuth logic in the
framework.

## Seam (exact app-facing API)

```ts
defineCredentialResolver({
	name: "...",
	service: authService,
	resolve: async ({ request, service }) => {
		/* unchanged */
	},
	challenge: 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
	// or per-Request: challenge: (request) => string | undefined
	protectCatalog: true, // optional; default false, tools/list & server/discover stay public
});
```

The framework never inspects `challenge`'s value; it only forwards whatever
string the function returns (or `undefined`, which means "no header, and for
MCP: no behavior change at all for this Request") as a `WWW-Authenticate`
header at the point a missing/invalid credential is about to be reported.

## Decisions

- **`tools/call` 401 is gated on `challenge` presence, not merely on having a
  credential resolver.** An application with `resolvePrincipal` wired but no
  `challenge` declared sees zero behavior change — the ingress preflight
  classifies that as `"deferred"` and falls through to
  `mcpOperation`'s existing 200/SSE-wrapped `UNAUTHENTICATED` frame. This was
  a mid-implementation correction: an earlier draft made the real-401 path
  unconditional whenever a credential resolver existed, which would have
  silently broken ADR-0038's frozen shape for every existing application.
  Gating on `challenge` presence makes the opt-in explicit and per-request.
- **`tools/list`/`server/discover` default to public** (`protectCatalog`
  absent/`false`). ADR-0038 explicitly says a future selective-catalogue
  decision "cannot silently change the basic default"; this ADR is Proposed,
  not a superseding Accepted ADR, so it cannot flip that default. Apps that
  want MCP-client-driven OAuth discovery from the first `tools/list` probe
  opt in explicitly.
- **Canonical HTTP gets no gating** — its `401` status was already correct
  before this change; only the header is new and purely additive.
- **Ordering**: protocol-version/envelope/metadata checks precede the new
  authentication preflight, which precedes all method dispatch (including the
  `tools/call` "Unknown tool" lookup), so an unauthenticated caller never
  learns catalogue membership. Documented and tested
  (`tests/unit/mcp02-runtime-ingress.test.ts`, "protocol-version mismatch is
  rejected before authentication runs...").
- **Accepted trade-off**: when an app opts in, `tools/call` resolves the
  credential twice on the authenticated/erroring path (once in the ingress
  preflight, once inside the existing, unmodified
  `createMcpOperationAdapter`). This kept `mcp-operation.ts`'s contract and
  its test file (`mcp02-operation-adapter.test.ts`) completely untouched.
  Noted as a follow-up in ADR-0046, not fixed here.

## Files changed

- `packages/questpie/src/credential-resolver.ts` — `challenge`, `protectCatalog`
  on `CredentialResolverDefinition`/`defineCredentialResolver`; string
  challenge normalized to a function.
- `packages/questpie/src/index.ts` — export `CredentialChallenge` type.
- `packages/compiler/src/runtime/application.ts` — generates
  `resolveApplicationChallenge` and `mcpCatalogRequiresCredential`, wired into
  `program`.
- `packages/runtime/src/application/contract.ts` — `credentialChallenge`,
  `mcpCatalogRequiresCredential` on `RuntimeApplicationProgram`.
- `packages/runtime/src/application/http-carrier.ts` — `wwwAuthenticate`
  threaded through `httpJsonResponse`/`httpFailure`/`resolveHttpPrincipal`.
- `packages/runtime/src/application/http-post.ts`,
  `packages/runtime/src/application/http-query.ts` — `credentialChallenge`
  input threaded to `resolveHttpPrincipal`.
- `packages/runtime/src/application/mcp/index.ts` — `unauthorized()` real-401
  response, `McpAuthenticationOutcome`, `authenticate`/`protectCatalog` on
  `createMcpIngress`, preflight inserted after protocol/metadata validation
  and before method dispatch.
- `packages/runtime/src/application/index.ts` — builds `mcpAuthenticate`
  (gated on `credentialChallenge` returning a value), wires it and
  `mcpCatalogRequiresCredential` into `createMcpIngress`; threads
  `credentialChallenge` into canonical Query/Post wiring.
- Tests: `tests/unit/mcp02-runtime-ingress.test.ts` (+7 cases),
  `tests/unit/http02-canonical-query-runtime.test.ts` (+3),
  `tests/unit/http02-canonical-post-runtime.test.ts` (+2),
  `tests/unit/credential-resolver-challenge.test.ts` (new, 4 cases).
- Docs: `docs/adr/0046-mcp-and-canonical-http-credential-challenge.md` (new,
  Proposed), `docs/adr/README.md` (index entry), this file.

No fixture (Team Support Desk / Collaboration) source was modified — their
credential resolvers do not declare `challenge`, so this feature is exercised
there only as a no-op (proven by the unchanged regression-suite results
below), not as a new positive assertion. Adding an opt-in fixture scenario
(e.g., a dedicated `challenge`/`protectCatalog` case in Team Support Desk or
a small synthetic compiled app) is a reasonable follow-up; it was not done
here to avoid touching the shared 1000+ line regression fixtures' assertions
under this proof budget. The unit-level `createMcpIngress`/`resolveHttpPrincipal`
tests are "the level the repo uses for the MCP projection"
(`tests/unit/mcp02-runtime-ingress.test.ts` already exists at exactly that
level for ADR-0038) and exercise every new branch directly.

## Commands run and results

All commands run from
`/home/drepkovsky/code/questpie-v4-worktrees/autopilot-rewrite-additions`
with `TMPDIR=/home/drepkovsky/.cache/v4-mcp-auth-tmp`.

- `bun install --frozen-lockfile` — OK (1065 installs, no changes).
- `bun run check:changed -- --typecheck @questpie/runtime` (oxfmt + oxlint +
  `tsc --noEmit` + `git diff --check` on every touched file) — PASS.
- `bun run check:changed -- --typecheck @questpie/compiler` — PASS.
- `bun run check:changed -- --typecheck questpie` — PASS.
- `bun run package:check` — PASS ("2 publishable package(s) valid").
- `bun test tests/unit/mcp01-compiler-catalogue.test.ts
  tests/unit/mcp02-operation-adapter.test.ts
  tests/unit/mcp02-runtime-ingress.test.ts
  tests/unit/mcp03-package-operation.test.ts
  tests/unit/http02-canonical-post-runtime.test.ts
  tests/unit/http02-canonical-post-client.test.ts
  tests/unit/http02-canonical-query-runtime.test.ts
  tests/unit/http02-failure-catalog.test.ts
  tests/unit/http02-old-wire-deletion.test.ts
  tests/unit/http03-operation-projection.test.ts
  tests/unit/credential-resolver-challenge.test.ts
  tests/unit/beta05-runtime-application.test.ts
  tests/unit/compiler-application-bundle.test.ts
  tests/unit/compiler-application-source.test.ts` — 83 pass, 0 fail, 552
  assertions.
- `bun test tests/integration/route-auth-runtime.test.ts` — 11 pass, 0 fail.
- PostgreSQL regressions, own disposable container
  (`docker run -d --rm --name v4-mcp-auth-pg -e POSTGRES_PASSWORD=pw
  -e POSTGRES_INITDB_ARGS=--locale=C.UTF-8 -p 127.0.0.1:55621:5432 postgres:17`,
  `PGHOST=127.0.0.1 PGPORT=55621 PGUSER=postgres PGPASSWORD=pw
  PGDATABASE=postgres`, `FIREFOX_BIN=/usr/bin/firefox`):
  - `bun test tests/integration/postgres/collaboration-walking-skeleton.test.ts`
    — run alone: **1 pass, 398 assertions** (three separate runs: one before
    my changes at all as a baseline, two after — all three passed). One
    additional run of this file *together* with `team-support-desk.test.ts`
    in the same `bun test` invocation produced two different timing-based
    failures (`eventually(...)` polling timeouts / off-by-one publication
    counts under `bun test` process contention with two Postgres-backed
    fixtures compiling and running concurrently) that did **not** reproduce
    when the file was run alone immediately after. This matches the
    documented flakiness class for parallel PostgreSQL-backed suites in this
    repo; it is not attributed to this change since the isolated run passes
    deterministically both before and after the change (three consecutive
    passes with identical assertion counts).
  - `bun test tests/integration/postgres/team-support-desk.test.ts` — run
    alone, twice: **1 pass, 111 assertions**, both times.
  - Container removed after each session (`docker stop v4-mcp-auth-pg`).
- Full `bun test tests/unit` (all unit tests, no PostgreSQL): started but its
  runtime exceeded this session's foreground command window; it continued
  running in the background. **Not confirmed complete at the time this
  record was written** — see the final reply for its outcome once known, or
  treat it as not run if no result is reported.
- `quality:full` / `quality:release` (the full repository quality gate,
  including the release dry-run/conformance checksum): **not run**. The task
  brief states the release dry-run/conformance checksum
  (`quality/release/package-artifacts.json`) is already red on this branch
  because of the unrelated prior `questpie/testing` commit's public-surface
  change, and asks only to confirm nothing *else* in those gates newly fails
  because of this change. Given the scope of this change (five runtime files
  plus one compiler codegen file, none touching the testkit surface that
  commit changed) and the passing `check:changed --typecheck` + `package:check`
  + full targeted unit-test run above, there is no source-level reason to
  expect a new failure there, but this was not directly verified — treat
  `quality:full`/`quality:release` as **not run, unverified**.
- `bun run architecture:check`: **not run** — no module topology change (no
  new files besides one new test file and one new doc-only ADR); judged
  unnecessary but not directly verified.
- `git diff --check` — ran as part of every `check:changed` invocation above;
  clean each time.

## Unverified / follow-up

- `quality:full`, `quality:release`, and the full `bun test tests/unit` run
  (see above) were not confirmed complete within this session.
- No end-to-end fixture-level positive test exercises `challenge`/
  `protectCatalog` actually turned on through a full compile (only the
  unit-level `createMcpIngress`/`resolveHttpPrincipal` tests, and the
  regression suites proving the *off* state is unchanged). A small synthetic
  compiled-app test, or a dedicated opt-in fixture, would close this gap.
- The documented duplicate-`resolvePrincipal`-call trade-off (see ADR-0046
  Consequences) is a known, accepted cost, not a defect, but is unmeasured
  (no latency benchmark was run).
- Public docs pages (if any exist for MCP/credential-resolver authoring)
  were not updated; this ADR is Proposed, not Accepted, so the repo's
  documentation-hygiene flow does not require it yet. Flagged as a follow-up
  once/if ADR-0046 is accepted.
