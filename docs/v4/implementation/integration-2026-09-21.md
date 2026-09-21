# Integration: docs/onboarding CLI + testkit/MCP credential gate — 2026-09-21

- Branch: `work/v4-integration-20260921`, worktree
  `/home/drepkovsky/code/questpie-v4-worktrees/integration`.
- Base: `a2c8e4a08` (`work/docs-onboarding-cli` = `feat/v4` 6ed23151d + the
  docs rewrite/onboarding CLI record,
  [docs/v4/implementation/docs-onboarding-cli.md](./docs-onboarding-cli.md)).
- Merged: `work/autopilot-rewrite-additions` (6 commits on 6ed23151d) — the
  public `questpie/testing` DB-backed test harness
  ([ADR-0045](../../adr/0045-freeze-public-testing-surface.md), Proposed;
  [record](./public-testkit.md)) and the MCP/canonical-HTTP credential
  challenge gate ([ADR-0046](../../adr/0046-mcp-and-canonical-http-credential-challenge.md),
  Proposed; [record](./mcp-credential-challenge.md)).
- Nothing pushed, tagged, or published. No npm registry write ran.

## Merge

`git merge --no-ff work/autopilot-rewrite-additions` (commit `a58211666`)
produced **zero textual conflicts** — the two branches touched disjoint
regions of every shared file except `packages/questpie/package.json` and
`scripts/release.ts`/`scripts/package-contract.ts`, where `git`'s three-way
merge resolved cleanly because the additions branch's edits (new `./testing`
and `./package.json` exports, new packed-tarball assertions) landed in
different lines than the onboarding branch's edits. `quality/release/package-artifacts.json`
did **not** conflict either: the additions branch never touched that file (it
only added the `./testing` export and the CLI/build-time bytes it produces;
it never re-ran `bun run scripts/release.ts --dry-run` far enough to hit the
manifest-update step — see "Release dry-run" below), so the merge kept the
onboarding branch's already-updated `questpie` hash unchanged. That hash was
stale the moment the merge landed the additions branch's source changes, so
it needed updating in a follow-up commit regardless of the clean merge.

## What was NOT a clean merge: three real gaps found after merging

The merge itself was clean, but exercising the combined tree surfaced three
real defects — two in code shipped by `work/autopilot-rewrite-additions`
that had never been run to completion on that branch (its own release
dry-run and architecture check were red from the stale manifest before they
could reach these), and one pre-existing bug in `work/docs-onboarding-cli`'s
own test that the merge didn't touch but this task's gate list required
green.

### 1. `scripts/release.ts`: `declarationInventory()` failed on the new `./package.json` export

`packages/questpie/package.json` gained `"./package.json": "./package.json"`
(needed so `runQuestpieCli`'s `import.meta.resolve("questpie/package.json")`
works under Node, not just Bun — see [public-testkit.md](./public-testkit.md)).
`declarationInventory()` in `scripts/release.ts` iterates every export and
calls `fail()` if it can't resolve a `.d.ts` target — it had no exception for
a bare self-referencing string export. Fixed by treating a bare non-`.d.ts`
string export as intentionally outside the manifest (no declaration to bind)
instead of aborting. Commit `dd4cebda7`.

### 2. `scripts/release.ts`: the isolated single-package consumer never installed `questpie`'s own dependencies

The `core`-profile per-package verification step in the release dry-run
extracts the packed tarball into a throwaway consumer directory and then
`import()`s it directly, without running `bun install` for that consumer.
Before this branch, `questpie`'s root import never touched a real dependency
at runtime, so this went unnoticed. `questpie/testing` imports `pg` (a real
`dependencies` entry in `packages/questpie/package.json`), so
`import("questpie/testing")` failed there with
`Cannot find package 'pg'`. Fixed by linking the packed package's own
production dependencies into the consumer's `node_modules` the same way
`questpie-opentelemetry`'s dependencies already are (`linkPackageDependencies`,
generalized to take an `owner` label instead of a hardcoded message).
Commit `dd4cebda7`.

### 3. `packages/compiler/src/runtime/application.ts` crossed the 800-line architecture ratchet

The MCP credential-gate template additions (the `resolveApplicationChallenge`,
`mcpCatalogRequiresCredential`, `mcpCallsRequireCredential` block) pushed the
file from 789 to 809 lines — already true on `work/autopilot-rewrite-additions`
alone; `architecture:check` had never been run to a passing state on that
branch because the release dry-run failure (see above two gaps, plus the
stale manifest) blocked it first in whatever order that branch's own gates
ran. Fixed by extracting the new block into
`packages/compiler/src/runtime/application-mcp-credential.ts`
(`renderApplicationCredentialChallenge`), following the file's existing
per-segment render-helper convention (`application-schedules.ts`,
`application-jobs.ts`, `application-durable.ts`). No behavior change — the
generated application template text is byte-identical to what the inline
version produced. `application.ts` is now 794 lines. Commit `62c7cb6d2`.

### 4. `tests/integration/postgres/cli-onboarding-packed.test.ts`: missing `QUESTPIE_REALTIME_HMAC_KEY`

Pre-existing on `work/docs-onboarding-cli` (not touched by the merge, not
caused by it). `schema-lifecycle.mdx` documents
`export QUESTPIE_REALTIME_HMAC_KEY=$(openssl rand -hex 32)` as a required
step before `scripts/try-ticket.ts`/`questpie start` will run, and
`packages/questpie/cli/questpie.ts` enforces it (>=32 bytes hex). The test's
hand-built child-process `env` object set `DATABASE_URL`,
`SUMMARY_WEBHOOK_URL`, and `BETTER_AUTH_*` but never this var, so the very
first `scripts/try-ticket.ts` invocation failed deterministically with `Set
DATABASE_URL and a hex QUESTPIE_REALTIME_HMAC_KEY`. Fixed by pinning a fixed
valid 64-hex-char key, the same way `BETTER_AUTH_SECRET` is already pinned.
Commit `56c1e30bf`.

## Release-artifact manifest — exact entries changed and why

`quality/release/package-artifacts.json`, package `questpie`:

| Field                          | Old                                           | New         | Why                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sha256` (archive)             | `8f8321d0…` (from `work/docs-onboarding-cli`) | `9ebf3842…` | Real content change: the merge adds the `./testing` subpath and its CLI-bundled dependency on the credential-gate compiler additions; the architecture-ratchet fix (gap 3) then changed `dist/cli.js`'s bundled bytes again (same generated _text_, different module boundary), so the archive was repacked and reconfirmed after that fix, not before. |
| `.` declaration sha256         | `89cc806c…`                                   | `06ed6232…` | `dist/index.d.ts` now re-exports the credential-gate additions (`challenge`, `protectCatalog`, `requireCredential` on `defineCredentialResolver`).                                                                                                                                                                                                      |
| `./internal/client-projection` | `121df02f…`                                   | unchanged   | Not touched by either branch.                                                                                                                                                                                                                                                                                                                           |
| `./internal/observability`     | `8aa857e7…`                                   | unchanged   | Not touched by either branch.                                                                                                                                                                                                                                                                                                                           |
| `./react-query`                | `8b846c4f…`                                   | unchanged   | Not touched by either branch.                                                                                                                                                                                                                                                                                                                           |
| `./testing` declaration        | (new)                                         | `a27df1ae…` | New public subpath from ADR-0045; `dist/testing/index.d.ts` sha256 recorded for the first time.                                                                                                                                                                                                                                                         |

Package `questpie-opentelemetry`: **no entries changed** — archive
`0c84e8b8…` and its sole `.` declaration `279a667e…` are byte-identical to
the pre-merge manifest, confirmed by packing twice after the full rebuild.

Both packages were packed twice independently after every rebuild (`bun pm
pack --ignore-scripts --quiet` into separate destination directories,
`sha256sum` compared); each pair was byte-identical every time this was
checked (three separate rebuild/pack rounds across the three fix commits).

## Testing-surface / onboarding-CLI consistency check

`questpie/testing`'s `runQuestpieCli` was written before `migration
plan`/`migration create`/`seed create` existed; checked whether anything
needed to change. Finding: no code change needed.
`createMigratedTemplateDatabase`/`createTestDatabaseFromTemplate` (the only
testkit callers of `runQuestpieCli`) only ever run `migration apply`/`seed
apply` — the pre-existing commit-time commands — against already-committed
migrations and Seeds; template cloning is a test-isolation concern, not an
authoring one, so it has no reason to invoke `plan`/`create`.
`runQuestpieCli` itself forwards whatever `arguments` a caller supplies with
no subcommand allowlist, so nothing blocks a future caller from driving the
authoring commands if it needs to. Added one clarifying paragraph to
[public-testkit.md](./public-testkit.md) noting this distinction; no design
change.

## Gates — commands and real results

All commands run from
`/home/drepkovsky/code/questpie-v4-worktrees/integration` with
`TMPDIR=/home/drepkovsky/.cache/v4-integration-tmp`.

**Install**

```
bun install --frozen-lockfile
```

1044 packages installed, no changes to `bun.lock`.

**Changed-scope gate** (`QUESTPIE_DIFF_BASE=6ed23151d`, covering the full
merged diff from both branches plus every fix commit in this integration):

```
bun run scripts/quality.ts changed \
  --typecheck questpie --typecheck @questpie/runtime \
  --typecheck @questpie/compiler --typecheck @questpie/testkit
```

Format (oxfmt --check), lint (oxlint --deny-warnings), four workspace
`types:check` runs (questpie, @questpie/runtime, @questpie/compiler,
@questpie/testkit), and `git diff --check` — all pass. (First run found 3
files oxfmt-unclean from the additions branch plus one from this task's own
edit; reformatted and reran clean.)

**Package contract**

```
bun run package:check
```

`package-contract: 2 publishable package(s) valid` — pass.

**Architecture ratchet**

```
bun run architecture:check
```

`architecture: PASS (434 production TypeScript files)` — pass (after gap 3
fix above; first run failed on `application.ts` at 809 lines).

**Unit tests** (full `tests/unit`, run twice — once right after the merge +
release/manifest fixes, once again after the architecture-ratchet fix to
confirm the compiler refactor changed no behavior):

```
bun test tests/unit --timeout=15000
```

Both runs: **1006 pass, 1 skip, 0 fail, 18 snapshots, 5251 expect() calls.
Ran 1007 tests across 195 files.** (~327–329s each.)

**PostgreSQL integration suites** — disposable container
(`docker run -d --rm --name v4-integration-pg -e POSTGRES_PASSWORD=pw
-e POSTGRES_INITDB_ARGS=--locale=C.UTF-8 -p 127.0.0.1:55651:5432 postgres:17
-c max_prepared_transactions=10`), `PGHOST=127.0.0.1 PGPORT=55651
PGUSER=postgres PGPASSWORD=pw PGDATABASE=postgres`, run **one at a time**:

| Suite                                                                                             | Result                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `public-testing-surface-consumer.test.ts` (dev mode)                                              | 1 pass, 3 expect() — [4.86s]                                        |
| `public-testing-surface-consumer.test.ts` (`QUESTPIE_PACKED_TARBALL=` real `bun pm pack` tarball) | 1 pass, 3 expect() — [4.16s]                                        |
| `questpie-testing-internals.test.ts`                                                              | 6 pass, 17 expect() — [8.96s]                                       |
| `mcp-credential-gate.test.ts`                                                                     | 1 pass, 36 expect() — [15.44s]                                      |
| `cli-onboarding-packed.test.ts`                                                                   | 1 pass, 55 expect() — [63.92s] (red before gap-4 fix, then green)   |
| `collaboration-walking-skeleton.test.ts`                                                          | 1 pass, 398 expect() — [25.72s]                                     |
| `team-support-desk.test.ts` (`FIREFOX_BIN=/usr/bin/firefox`)                                      | 1 pass, 111 expect() — [53.86s]                                     |
| `beta12-release-conformance.test.ts`                                                              | 1 pass, 9 expect() — [45.18s] (red before manifest fix, then green) |
| `tests/integration/route-auth-runtime.test.ts` (no Postgres needed)                               | 11 pass, 73 expect() — [179ms]                                      |

Container removed after the run (`docker stop v4-integration-pg`, `--rm` took
care of removal).

**Release dry-run**

```
bun run scripts/release.ts --dry-run
```

```
release dry-run: questpie@4.0.0-beta.2 questpie-4.0.0-beta.2.tgz sha256=9ebf38425f8ac9c879940d2531dbaa1ba5b5a7bd2f4b1fe8192db722824c5838 retry-stable isolated-import negative-imports native-react-query peer-boundary packed-build
release dry-run: questpie-opentelemetry@4.0.0-beta.2 questpie-opentelemetry-4.0.0-beta.2.tgz sha256=0c84e8b805a65058efb31e28bac9a143a8390d8780132fced3ff9b7c29c4861f retry-stable isolated-import negative-imports exact-peers peer-mismatch
release dry-run: exact-two-package combined-import
```

Pass, `process.exit(0)`. Confirmed by reading the script: the publish branch
(`npm publish --provenance ...`) is gated behind `!dryRun` and a
`GITHUB_ACTIONS`/`GITHUB_REF_TYPE=tag` check that fails outside CI, so
`--dry-run` never reaches it. No push, tag, or publish ran.

## Not run / out of scope

- `quality:full` / `quality:release` (the full aggregate pipeline including
  performance manifests, OTel CLI ownership, native-browser/tutorial lanes
  beyond `team-support-desk`) was not run as one invocation — the task's gate
  list enumerates the specific suites above instead, all of which passed
  individually.
- Load/soak lanes (`test:load`, `test:soak`) were not run — not in the gate
  list and this integration made no Kernel-tier change (Product-tier: CLI
  env var, release-script bookkeeping, compiler-template file split).
- No formal `review:accept:v2` acceptance review — not requested for this
  integration task, and per `docs/v4/DELIVERY-FLOW.md` it applies only to a
  new/superseding Kernel ADR or exceptional release boundary; ADR-0045/0046
  remain Proposed here, unchanged by this task.

## Status

The merge is complete, both feature lines are present, every enumerated gate
passed with real commands and results above, and nothing was pushed, tagged,
or published. `work/v4-integration-20260921` at commit `56c1e30bf` is a
release-candidate base for further beta.2 acceptance work, subject to the
existing HANDOFF.md manual-release-continuation steps (fresh aggregate
acceptance manifest, owner's manual reference-app inspection, explicit
publish authorization) — none of which this task was authorized to perform.
