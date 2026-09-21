# Public DB-backed test harness (`questpie/testing`)

- Status: implemented, ADR Proposed (docs/adr/0045-freeze-public-testing-surface.md)
- Ticket: v4 rewrite 03 — public DB-backed test harness in QUESTPIE v4 (testkit)

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
moved from `@questpie/testkit`, not rewritten) plus new PostgreSQL isolation
helpers (`createTestDatabase`, `runQuestpieCli`,
`createIsolatedApplicationDatabase`). `principal.user()`/`principal.service()`
needed no new export — they were already public from the `questpie` root and
already the seam the credential resolver and Context resolver trust. Generated
App Contract execution (`app.execution`, `app.fetch`, `app.durable`) needed no
new export either — it is emitted per application by the private compiler and
was never testkit-owned.

## Decisions

Full reasoning, rejected alternatives, and the exact export list are in
[ADR-0045](../../adr/0045-freeze-public-testing-surface.md) (Proposed). Key
points:

- Isolation unit is one PostgreSQL **database** per call, not a shared
  database with per-test schemas — avoids collisions across parallel test
  files without needing to know an application's configured `postgres.schema`.
- `createIsolatedApplicationDatabase` reads the application's own
  `questpie.json#postgres.databaseCollation`/`databaseCType` and creates the
  isolated database with `CREATE DATABASE ... TEMPLATE template0 LC_COLLATE
... LC_CTYPE ...` matching them. A bare `CREATE DATABASE` inherits the
  server's default collation, which QUESTPIE's `QP-SCHEMA-007` readiness check
  rejects when it does not match the application's declared collation — this
  was discovered empirically while proving the surface (see Evidence).
- Migrations/Seeds are applied by shelling out to the application's own
  installed `questpie` CLI (`questpie migration apply` / `questpie seed
apply`), resolved via `import.meta.resolve("questpie/package.json")` from
  the calling application's `node_modules`. The helper never reimplements
  migration/Seed application.
- `@questpie/testkit` stays private and is retained (not deleted); it now
  re-exports its three lifecycle helpers from `questpie/testing` instead of
  duplicating them, and depends on the `questpie` workspace package to do so.
- Framework-internal proof machinery (tracer hosts, Firefox journeys,
  MCP/OTLP wire clients, hostile multi-instance harnesses in
  `tests/support/*`) stays private; it has no stable external contract.

## Files changed

- `packages/questpie/src/testing/index.ts` — new. Public subpath source.
- `packages/questpie/package.json` — adds the `./testing` export entry.
- `packages/testkit/src/index.ts` — re-exports `CleanupStack`, `eventually`,
  `waitForOutputLine` from `questpie/testing` instead of a local copy.
- `packages/testkit/package.json` — adds a `questpie: workspace:*` dependency
  so Turborepo builds `questpie` before `@questpie/testkit`'s `types:check`.
- `scripts/package-contract.ts` — the packed-tarball and exact-exports checks
  now require `dist/testing/index.{d.ts,js}` and include `./testing` in the
  expected `questpie` export list.
- `tests/support/beta12-packed-questpie.ts` — the dev (non-tarball)
  `installQuestpieForTracer` path now also symlinks `./testing`, and gains a
  `bin.questpie` entry (symlinked to the built `dist/cli.js`) so
  `runQuestpieCli`'s CLI-binary resolution works against the same dev-mode
  fixture wiring existing tests already use. The tarball path needed no
  change: a real `bun pm pack` archive already contains the new subpath.
- `tests/integration/postgres/public-testing-surface-consumer.test.ts` — new.
  The external-consumer proof (see Evidence).
- `docs/adr/0045-freeze-public-testing-surface.md` — new, Proposed.
- `docs/adr/README.md` — indexes ADR-0045 under Proposed.

## Evidence

`tests/integration/postgres/public-testing-surface-consumer.test.ts` imports
only `questpie` and `questpie/testing` specifiers (resolved from a fixture
application's own `node_modules`, exactly as an external consumer would) plus
the fixture application's own source. Against the `fixtures/collaboration`
application it:

1. runs `questpie build` (the application's own build step);
2. calls `createIsolatedApplicationDatabase` to get an isolated, correctly
   collated PostgreSQL database with committed migrations and Seeds applied;
3. obtains a trusted `Principal` via `principal.user()` — the same seam
   `fixtures/collaboration/src/route-auth.ts`'s credential resolver uses;
4. calls a generated Query (`queries.channels.detail`) in-process;
5. calls a Route (`GET /api/whoami`) over `app.fetch`, authenticated through
   the fixture's own credential resolver;
6. accepts a Job (`mutations.message.requestDigest`) and drains it to a
   `succeeded` outcome via the generated Durable worker's `.poll()`, polled
   deterministically with the public `eventually` helper; and
7. disposes the isolated database and confirms (manually, once, during
   development) that PostgreSQL no longer lists it.

## Commands run and results

All commands ran from
`/home/drepkovsky/code/questpie-v4-worktrees/autopilot-rewrite-additions`
(branch `work/autopilot-rewrite-additions`) with `TMPDIR` set to a
disk-backed directory, against a disposable local `postgres:17` container
(`v4-testkit-proof-pg`, port 55599, `POSTGRES_INITDB_ARGS=--locale=C.UTF-8`)
started for this task and owned only by this task — not a shared/reused
container.

| Command                                                                                                             | Result                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                                     | Passed (`node_modules` did not exist in this fresh worktree checkout; installed clean, no lockfile drift after all edits — re-ran at the end, "no changes")       |
| `bun node_modules/typescript/bin/tsc -p packages/questpie/tsconfig.json --noEmit`                                   | Passed, no output                                                                                                                                                 |
| `bun node_modules/typescript/bin/tsc -p packages/testkit/tsconfig.json --noEmit`                                    | Passed, no output                                                                                                                                                 |
| `bun scripts/build-public-package.ts` (builds `questpie`, `runtime`, `compiler`)                                    | Passed                                                                                                                                                            |
| `bun run build` inside `packages/opentelemetry`                                                                     | Passed (needed once; unrelated to this change, but `package:check` also validates that package)                                                                   |
| `bun run package:check` (`scripts/package-contract.ts`)                                                             | Passed: `2 publishable package(s) valid`                                                                                                                          |
| `./node_modules/.bin/oxlint` over every changed/new file                                                            | Passed, no findings                                                                                                                                               |
| `./node_modules/.bin/oxfmt --check` over every changed/new file                                                     | Passed, all correctly formatted                                                                                                                                   |
| `git diff --check`                                                                                                  | Passed, no whitespace errors                                                                                                                                      |
| `bun test tests/integration/postgres/public-testing-surface-consumer.test.ts` (`PGHOST=127.0.0.1 PGPORT=55599 ...`) | Passed: 1 pass, 6 assertions                                                                                                                                      |
| `bun test tests/integration/postgres/collaboration-walking-skeleton.test.ts` (same env)                             | Passed: 1 pass, 398 assertions — proves `tests/support/beta12-packed-questpie.ts`'s dev-mode change does not regress the existing largest consumer of that helper |
| `bun test tests/integration/postgres/team-support-desk.test.ts` (same env, `FIREFOX_BIN=/usr/bin/firefox`)          | Passed: 1 pass, 111 assertions — same regression check, including the Firefox and Better Auth paths                                                               |

## Not run / not claimed

- `bun run quality:release`, `bun run scripts/release.ts --dry-run`, and the
  repository's broader `quality:full`/`test:load`/`test:soak` lanes were not
  run. `scripts/release.ts`'s declaration inventory and consumer-install
  proof are generic over `package.json#exports` (verified by reading
  `scripts/release.ts`, not by executing it), so they should pick up
  `./testing` without a code change, but that is not the same as an executed
  PASS. This is explicitly named as unverified in ADR-0045's Acceptance
  section.
- `turbo run types:check` (root `check-types`) was not run across the full
  monorepo; only the two directly-touched packages' own `tsc --noEmit` ran,
  per "run the narrowest relevant gates." `tests/` is not a declared
  workspace, so loose files under `tests/integration/postgres/*.test.ts` are
  not covered by that gate at all (existing repository convention, not
  introduced here).
- Hostile, multi-instance, load, and soak lanes for `questpie/testing` itself
  were not written or run — ADR-0045's Acceptance section lists what a full
  acceptance review would still need beyond this Proposed-status evidence.
- The disposable PostgreSQL container used for evidence was created and
  destroyed by this task and is not any shared/dogfood database; no
  production or another agent's PostgreSQL instance was touched.
