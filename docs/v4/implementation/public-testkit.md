# Public DB-backed test harness (`questpie/testing`)

- Status: implemented, ADR Proposed (docs/adr/0045-freeze-public-testing-surface.md)
- Ticket: v4 rewrite 03 — public DB-backed test harness in QUESTPIE v4 (testkit)
- Revision: adversarial review (FIX-THEN-MERGE on the first commit) addressed
  in a second commit; see "Adversarial review follow-ups" below.

## Scope

An application outside this repository (Autopilot: 144 DB-backed scenario
tests, "nothing is pushed without real-Postgres proof") could not test
against QUESTPIE v4 through published exports only: `@questpie/testkit` is
`private: true`, and `questpie`'s exports exposed only `.`, `./react-query`,
and two internal subpaths.

This slice adds one new public subpath, `questpie/testing`, to the existing
`questpie` npm package — not a third public package (ADR-0042's "exactly two
public npm packages" stays intact). It exports the three existing generic
test-lifecycle helpers (`CleanupStack`, `eventually`, `waitForOutputLine`,
moved from `@questpie/testkit`, not rewritten) plus PostgreSQL isolation
helpers: `createTestDatabase`, `createIsolatedApplicationDatabase`,
`createMigratedTemplateDatabase`, `createTestDatabaseFromTemplate`,
`reapTestDatabases`, `runQuestpieCli`. `principal.user()`/`principal.service()`
needed no new export — they were already public from the `questpie` root and
already the seam the credential resolver and Context resolver trust. Generated
App Contract execution (`app.execution`, `app.fetch`, `app.durable`) needed no
new export either — it is emitted per application by the private compiler and
was never testkit-owned.

## Decisions

Full reasoning, rejected alternatives, and the exact export list are in
[ADR-0045](../../adr/0045-freeze-public-testing-surface.md) (Proposed, revised
after adversarial review). Key points:

- Isolation unit is one PostgreSQL **database** per call, not a shared
  database with per-test schemas.
- `createIsolatedApplicationDatabase` reads the application's own
  `questpie.json#postgres.databaseCollation`/`databaseCType` and creates the
  isolated database with matching `LC_COLLATE`/`LC_CTYPE`. QUESTPIE's
  `QP-SCHEMA-007` readiness check fails closed against a mismatched collation.
- Database names embed a creation timestamp and are validated for both
  charset and PostgreSQL's 63-byte identifier limit before any connection
  opens (PostgreSQL silently truncates an oversized identifier instead of
  rejecting it).
- Teardown uses `DROP DATABASE ... WITH (FORCE)` and only marks itself
  disposed after the drop actually succeeds.
- `reapTestDatabases` recovers databases leaked by a killed process, matching
  only its own `namePrefix`-shaped names.
- `createMigratedTemplateDatabase`/`createTestDatabaseFromTemplate` clone a
  once-migrated database via PostgreSQL's native `CREATE DATABASE ...
TEMPLATE`, avoiding a full migration replay per test file.
- `runQuestpieCli` is non-blocking with a timeout, uses an explicit
  environment allowlist (not the full parent `process.env`), and redacts any
  PostgreSQL credential from its captured output before it can reach a
  thrown error.
- The module is runtime-neutral (`node:child_process`, `setTimeout`), not
  Bun-only like `questpie/react-query`.
- Migrations/Seeds are applied by shelling out to the application's own
  installed `questpie` CLI, resolved via
  `import.meta.resolve("questpie/package.json")` — which required adding a
  `"./package.json"` export so the resolution also works under Node, not
  only Bun's more lenient resolver.
- `@questpie/testkit` stays private and is retained; it re-exports its three
  lifecycle helpers from `packages/questpie/src/testing/index.ts` **by
  relative source path**, not the built `questpie/testing` package specifier
  — see "Adversarial review follow-ups" item (g).
- Framework-internal proof machinery (tracer hosts, Firefox journeys,
  MCP/OTLP wire clients, hostile multi-instance harnesses in
  `tests/support/*`) stays private; it has no stable external contract.
- Deterministic **Reaction** draining is explicitly _not_ provided; only
  **Job** draining is, via the generated `app.durable.worker().poll()` paired
  with the public `eventually`. See ADR-0045 "Reaction draining is not
  provided".

## Files changed (both commits)

- `packages/questpie/src/testing/index.ts` — public subpath source.
- `packages/questpie/src/testing/internal.ts` — new. Pure, unpublished
  helpers (identifier quoting, name generation/parsing, credential
  redaction, CLI environment building) split out for direct unit testing.
- `packages/questpie/package.json` — adds `./testing` and `./package.json`
  export entries.
- `packages/testkit/src/index.ts` — re-exports `CleanupStack`, `eventually`,
  `waitForOutputLine` from `../../questpie/src/testing/index` (relative
  source path).
- `packages/testkit/tsconfig.json` — `rootDir` widened to `..` so that
  cross-package relative import typechecks; no runtime effect (testkit's
  own `dist/` is unused by any consumer).
- `scripts/package-contract.ts` — packed-tarball and exact-exports checks
  require `dist/testing/index.{d.ts,js}` and include `./testing` and
  `./package.json` in the expected `questpie` export list.
- `scripts/release.ts` — the core-package, react-query, and combined-consumer
  install proofs now also `import("questpie/testing")` and assert its
  functions exist, so a broken subpath fails the dry-run.
- `tests/support/beta12-packed-questpie.ts` — the dev (non-tarball)
  `installQuestpieForTracer` path also symlinks `./testing` and gains a
  `bin.questpie` entry.
- `tests/integration/postgres/public-testing-surface-consumer.test.ts` —
  rewritten as a thin orchestrator (build via the installed CLI bin, no
  admin `DATABASE_URL` for `build`, `node_modules`/`.questpie` excluded from
  the fixture copy) that spawns the actual proof as its own process.
- `tests/support/public-testing-cases/collaboration-consumer.case.ts` — new.
  The actual external-consumer proof, run **inside** the fixture copy's own
  process so its `questpie`/`questpie/testing` imports resolve through that
  copy's own `node_modules` (dev symlink or real packed tarball).
- `tests/integration/postgres/beta12-release-conformance.test.ts` — adds the
  consumer test to the packed-tarball re-run set.
- `tests/integration/postgres/questpie-testing-internals.test.ts` — new.
  White-box PostgreSQL-gated coverage: FORCE-drop teardown and retry, the
  reaper, the template-clone path, `runQuestpieCli`'s timeout, collation
  matching.
- `tests/unit/questpie-testing-database-naming.test.ts` — new. Pure-function
  coverage: name validation/length, redaction, CLI environment allowlist,
  connection URL rewriting — no PostgreSQL required.
- `docs/adr/0045-freeze-public-testing-surface.md` — Proposed, substantially
  revised after review (full export list, runtime-neutrality, Reaction gap,
  template-database rationale, stale signatures fixed).
- `docs/adr/README.md` — indexes ADR-0045 under Proposed.

## Adversarial review follow-ups

The reviewer returned FIX-THEN-MERGE on the first commit with eight items;
each is addressed here.

- **(a) Consumer proof never touched the published artifact — CRITICAL.**
  Fixed. The proof now runs as its own `bun test` process spawned _inside_ a
  compiled fixture copy
  (`tests/support/public-testing-cases/collaboration-consumer.case.ts`), so
  its `import ... from "questpie"` / `"questpie/testing"` resolve through
  that copy's own `node_modules` — a dev symlink to workspace source, or,
  under `QUESTPIE_PACKED_TARBALL`, a real extracted `bun pm pack` tarball.
  Verified directly in both modes (Evidence below) and added to
  `beta12-release-conformance.test.ts`'s packed re-run set. `questpie build`
  is now invoked through the CLI binary declared in the installed copy's own
  `package.json#bin`, never a repo-relative `packages/questpie/dist/cli.js`
  path. `scripts/release.ts`'s three consumer-install proofs (core package,
  react-query/native combined check, combined consumer) now also import
  `questpie/testing` and assert its exports are functions.
- **(b) `import.meta.resolve("questpie/package.json")` needs a
  `"./package.json"` export for Node; module used `Bun.sleep`/`Bun.spawnSync`.**
  Fixed. Added the export (and to `scripts/package-contract.ts`'s expected
  list). Replaced `Bun.sleep` with a `setTimeout`-based `delay` and
  `Bun.spawnSync` with `node:child_process.spawn`; the module is now
  runtime-neutral. ADR-0045 states this explicitly and does not extend
  `questpie/react-query`'s Bun-only contract to this module.
- **(c) Database name truncation past 63 bytes; identifier quoting.** Fixed.
  `namePrefix` is validated against `/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/`, and the
  full generated name (`<prefix>_<createdAt base36>_<16 hex>`) is checked
  against PostgreSQL's 63-byte limit before any connection opens, throwing a
  clear error. Every database/template identifier goes through
  `quoteIdentifier`; `LC_COLLATE`/`LC_CTYPE` (string literals, not
  identifiers) go through `pg`'s `Client#escapeLiteral`. Unit-tested in
  `tests/unit/questpie-testing-database-naming.test.ts`.
- **(d) `DROP DATABASE ... WITH (FORCE)`; disposed-latch-after-success;
  reaper.** Fixed. `dispose()` uses `WITH (FORCE)` (PostgreSQL 13+) instead
  of a separate `pg_terminate_backend` step, and only sets its internal
  `disposed` flag after the drop succeeds. `CleanupStack`'s doc comment
  explicitly recommends it over a bare `try`/`finally` so a failing
  `dispose()` cannot silently replace an earlier test failure (it aggregates
  instead). Added `reapTestDatabases({ adminConnectionUrl, namePrefix,
olderThanMinutes })`, which matches only its own prefix's generated-shape
  names. Both are covered in `questpie-testing-internals.test.ts`, including
  a forced real `DROP DATABASE` failure (via a prepared two-phase-commit
  transaction) and successful retry on the same handle.
- **(e) `runQuestpieCli` timeout, env allowlist, credential redaction.**
  Fixed. Spawns non-blocking via `node:child_process.spawn`, kills the child
  and throws if it runs past `timeoutMilliseconds` (default 60 s). The child
  environment is built by the pure `buildCliEnvironment` (allowlist
  `PATH`/`HOME`/`TMPDIR`/`TEMP`/`TMP` plus explicit `env` overrides plus
  `DATABASE_URL`) — never the caller's full `process.env`. Any
  `postgres://`/`postgresql://` credential in the captured stdout/stderr is
  redacted before a thrown error is built. Redaction and the environment
  allowlist are unit-tested directly.
- **(f) ADR/doc: Reaction gap, template-database option, stale signature.**
  Fixed. ADR-0045 and this record both state plainly that deterministic
  Reaction draining is not provided, name the existing public Job-draining
  seam, and describe what an application must do for Reactions today (poll
  its own observable effect with `eventually`). The template-database option
  was judged small enough to implement rather than defer (ADR-0045 "Cost of
  one full migration replay per test file" estimates ~10–15 minutes across
  144 files without it) and is implemented as
  `createMigratedTemplateDatabase`/`createTestDatabaseFromTemplate`, proven
  in `questpie-testing-internals.test.ts`. The stale `createTestDatabase`
  signature and `<namePrefix>_<uuid>` name-shape claim in the ADR are
  corrected to match the implementation.
- **(g) `@questpie/testkit` resolving through gitignored `dist`.** Fixed.
  `packages/testkit/src/index.ts` now imports from
  `../../questpie/src/testing/index` (source), not the `questpie/testing`
  package specifier; `packages/testkit/tsconfig.json`'s `rootDir` was widened
  so the cross-package relative import typechecks (`testkit`'s own `dist/`
  output is not consumed by anything, so this has no runtime effect). Both
  named affected tests were run against a self-owned, self-destroyed
  PostgreSQL container (`bun tests/support/native-react-query-postgres-run.ts`,
  which starts and `--rm`-removes its own `postgres:17` container) — see
  Evidence: `tests/integration/postgres/native-react-query.test.ts` passed,
  and its spawned `tests/support/native-query-cases/collaboration-postgres.case.ts`
  (which imports `@questpie/testkit`'s `CleanupStack`) is asserted by that
  same test to report `2 pass` / `39 expect() calls`, which it did.
- **(h) Slop: unused `adminDatabase` pool, duplicate `runCli`, admin
  `DATABASE_URL` for `build`, missing `.questpie`/`node_modules` cp filter.**
  Fixed by the consumer-test rewrite in (a): no `SQL` pool is opened in the
  outer orchestrator at all; there is exactly one CLI-invocation helper
  (`resolveInstalledCliPath` + `run`); `build` is invoked with no
  `DATABASE_URL`; the fixture `cp` excludes `node_modules` and `.questpie`,
  matching `tests/integration/native-react-query.test.ts`'s existing filter.

## Evidence

`tests/support/public-testing-cases/collaboration-consumer.case.ts`, run as
its own process inside a compiled `fixtures/collaboration` copy, imports only
`questpie` and `questpie/testing` specifiers (resolved through that copy's
own `node_modules`) plus the fixture's own source. It:

1. calls `createIsolatedApplicationDatabase` to get an isolated, correctly
   collated PostgreSQL database with committed migrations and Seeds applied;
2. obtains a trusted `Principal` via `principal.user()` — the same seam
   `fixtures/collaboration/src/route-auth.ts`'s credential resolver uses;
3. calls a generated Query (`queries.channels.detail`) in-process;
4. calls a Route (`GET /api/whoami`) over `app.fetch`, authenticated through
   the fixture's own credential resolver;
5. accepts a Job (`mutations.message.requestDigest`) and drains it to a
   `succeeded` outcome via the generated Durable worker's `.poll()`, polled
   deterministically with the public `eventually` helper; and
6. disposes the isolated database.

The outer `public-testing-surface-consumer.test.ts` builds the fixture copy
(through the installed CLI bin), spawns the case file as `bun test`, and
asserts its output contains `1 pass`, `0 fail`, `5 expect() calls`.

## Commands run and results

All commands ran from
`/home/drepkovsky/code/questpie-v4-worktrees/autopilot-rewrite-additions`
(branch `work/autopilot-rewrite-additions`) with `TMPDIR` set to a
disk-backed directory. Two disposable, self-owned, self-destroyed PostgreSQL
containers were used across the two commits (`v4-testkit-proof-pg` for the
first, later removed; `v4-testkit-proof-pg2`, port 55601, `postgres:17`,
`POSTGRES_INITDB_ARGS=--locale=C.UTF-8`, and — to exercise the forced-`DROP
DATABASE`-failure test branch — `-c max_prepared_transactions=10`, for this
revision). `tests/support/native-react-query-postgres-run.ts` starts and
`--rm`-removes an additional, fully self-contained container per invocation.
No shared or another agent's container was reused or touched.

| Command                                                                                                                                      | Result                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                                                              | Passed, "no changes" (re-run after every edit)                                                                                                                                          |
| `bun node_modules/typescript/bin/tsc -p packages/questpie/tsconfig.json --noEmit`                                                            | Passed, no output                                                                                                                                                                       |
| `bun node_modules/typescript/bin/tsc -p packages/testkit/tsconfig.json --noEmit`                                                             | Passed, no output                                                                                                                                                                       |
| `bun scripts/build-public-package.ts`                                                                                                        | Passed                                                                                                                                                                                  |
| `bun run package:check`                                                                                                                      | Passed: `2 publishable package(s) valid`                                                                                                                                                |
| `./node_modules/.bin/oxlint` over every changed/new `.ts` file                                                                               | Passed, no findings                                                                                                                                                                     |
| `./node_modules/.bin/oxfmt --check` over every changed/new file                                                                              | Passed, all correctly formatted                                                                                                                                                         |
| `bun test tests/unit/questpie-testing-database-naming.test.ts`                                                                               | Passed: 13 pass, 29 assertions                                                                                                                                                          |
| `bun test tests/integration/postgres/questpie-testing-internals.test.ts` (PG env)                                                            | Passed: 6 pass, 17 assertions (forced-failure branch exercised: container started with `max_prepared_transactions=10`)                                                                  |
| `bun test tests/integration/postgres/public-testing-surface-consumer.test.ts` (dev mode, PG env)                                             | Passed: 1 pass, 3 assertions                                                                                                                                                            |
| `bun test tests/integration/postgres/public-testing-surface-consumer.test.ts` (`QUESTPIE_PACKED_TARBALL=<real bun pm pack tarball>`, PG env) | Passed: 1 pass, 3 assertions — the CRITICAL item (a) proof, against a real extracted npm archive                                                                                        |
| `bun tests/support/native-react-query-postgres-run.ts` (self-owned container)                                                                | Passed: 1 pass, 2 assertions; asserts the inner spawned `collaboration-postgres.case.ts` (imports `@questpie/testkit`) reported `2 pass` / `39 expect() calls`, which it did — item (g) |
| `bun test tests/integration/postgres/collaboration-walking-skeleton.test.ts` (PG env)                                                        | Passed: 1 pass, 398 assertions — regression check                                                                                                                                       |
| `bun test tests/integration/postgres/team-support-desk.test.ts` (PG env, `FIREFOX_BIN=/usr/bin/firefox`)                                     | Passed: 1 pass, 111 assertions — regression check                                                                                                                                       |
| `bun test tests/integration/postgres/beta12-release-conformance.test.ts` (PG env)                                                            | **Failed** — see "Not run / not claimed"                                                                                                                                                |
| `bun run scripts/release.ts --dry-run`                                                                                                       | **Failed** — see "Not run / not claimed"                                                                                                                                                |

## Not run / not claimed

- **`bun run scripts/release.ts --dry-run` fails, and so does
  `beta12-release-conformance.test.ts`** (which re-packs and checks against
  the same manifest): both compare a freshly packed `questpie` tarball's
  SHA-256 against the digest pinned in `quality/release/package-artifacts.json`
  at the last beta.2 candidate. Adding `./testing` and `./package.json`
  necessarily changes the packed bytes, so the digest no longer matches. The
  exact observed failure:
  `expect(received).toBe(expected)` / `Expected: "f49598c08533b2f90c89a9c195c8793bab619e8dce2c0ded5635d9c97a8f75d7"` /
  `Received: "a9af35e42bfbc3c41303c0df146d867e4caa319eb2a2872bd10e4e64d22cc2ba"`.
  Regenerating that pinned manifest is a release-authority action — it
  re-pins the exact bytes ADR-0042's formal acceptance process certifies —
  and is out of scope for this ticket and this ADR (still Proposed). This is
  not claimed green; ADR-0045's Release contract section names it explicitly.
- `turbo run types:check` (root `check-types`) was not run across the full
  monorepo; only the two directly-touched packages' own `tsc --noEmit` ran.
  `tests/` is not a declared workspace, so loose files there are not covered
  by that gate at all regardless (existing repository convention).
- `bun run quality:release` and the broader `quality:full`/`test:load`/
  `test:soak` lanes were not run.
- The forced-`DROP DATABASE`-failure branch in
  `questpie-testing-internals.test.ts` only exercises against a server with
  `max_prepared_transactions > 0`; a server with the common `= 0` default
  silently falls back to only proving the happy path (the test detects this
  and does not fail, but also does not exercise the failure branch in that
  case — this run used a container configured with
  `max_prepared_transactions=10` specifically so the failure branch ran).
- Hostile, multi-instance, load, and soak lanes for `questpie/testing` were
  not written or run — ADR-0045's Acceptance section names what a full
  acceptance review would still need beyond this Proposed-status evidence.
