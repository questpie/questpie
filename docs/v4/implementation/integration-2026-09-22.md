# Integration: Collection delete kernel + database-level immutability — 2026-09-22

- Branch: `work/v4-integration-20260921`, worktree
  `/home/drepkovsky/code/questpie-v4-worktrees/integration`.
- Base for this pass: `e1261780b` (already contains `feat/v4`, the
  docs-onboarding CLI, `questpie/testing` (ADR-0045), and the MCP credential
  gate (ADR-0046); see
  [integration-2026-09-21.md](./integration-2026-09-21.md) for that history).
- Merged, one at a time, each followed by its own focused Postgres tests
  before the next:
  1. `work/collection-delete-kernel` — `ctx.data.<collection>.delete({ key })`
     for named Mutations, **ADR-0047, Proposed**
     ([record](./collection-delete-kernel.md)).
  2. `work/collection-db-immutability` — `defineCollection({ appendOnly: true
})` and `field.*({ immutable: "database" })`, compiler-owned `ENABLE
ALWAYS` guard triggers, **ADR-0048, Proposed**
     ([record](./collection-db-immutability.md)).
- Both branched from `a2c8e4a08`.
- Nothing pushed, tagged, or published. No npm registry write ran.

## Merge A: `work/collection-delete-kernel`

`git merge --no-ff work/collection-delete-kernel` (commit `4df36c49c`) —
**zero conflicts**. 27 files, +3741/-241. Ran all six `adr0047-*.test.ts`
Postgres suites one at a time before merging B; all green (below). The
first run of `adr0047-collection-delete-kernel.test.ts` failed with a
QP-COMPOSE-013-shaped confusion because `packages/questpie/dist/cli.js` was
still the pre-merge artifact — rebuilt `questpie` and `questpie-opentelemetry`
from their own directories (`cd packages/questpie && bun run build`; same for
`packages/opentelemetry`), then it passed.

## Merge B: `work/collection-db-immutability`

`git merge --no-ff work/collection-db-immutability` (commit `478065780`) —
**two conflicts**, exactly where the task predicted:

### `docs/adr/README.md`

Both branches added a line to the "Proposed" list. Resolved by keeping both:
ADR-0045/0046 (already on this branch) and ADR-0048 (new), alongside the
already-merged ADR-0047 entry.

### `packages/compiler/src/mutation/kernel.ts`

Branch A's `projectCollectionMutationKernels` iterated `["create", "update",
"delete"]` and emitted a kernel whenever the Policy declared that operation.
Branch B's version (which predates the delete kernel) iterated only
`["create", "update"]` and threw `QP-COMPOSE-013` when a Policy declared
`update` on an append-only Collection. Resolved by keeping A's three-member
loop and B's refusal, **and extending the refusal to `delete`** — the
cross-feature rule this task asked for (see below). `operation-set.ts`
(branch B) auto-merged with no conflict: its generic `member === "update" ||
member === "delete"` refusal already named `"delete"` as a member even
though no delete kernel existed on that branch yet, so it needed no change
to also cover the Operation-Set-authored `delete` case.

No other file conflicted, including `packages/runtime/src/postgres/errors.ts`
and `packages/compiler/src/mutation/operation-set.ts`, which the task flagged
as possible collision points — both auto-merged cleanly because the two
branches touched disjoint lines.

After resolving, `packages/questpie/dist/cli.js` again needed a rebuild
(branch B's `appendOnly` public type wasn't in the stale artifact); the first
run of the new cross-feature unit test failed with `TS2353: Object literal
may only specify known properties, and 'appendOnly' does not exist`, fixed by
rebuilding `questpie`.

## The cross-feature rule, as built

Neither branch could know about the other. `work/collection-db-immutability`
refused the auto-generated `update` kernel for an append-only Collection at
compose time (`QP-COMPOSE-013` in `kernel.ts`). After merging in
`work/collection-delete-kernel`'s new `delete` kernel, the same discipline
now holds for `delete`:

- `packages/compiler/src/mutation/kernel.ts`'s
  `projectCollectionMutationKernels` throws `QP-COMPOSE-013` when a Policy
  declares a `delete` operation on a Collection with `appendOnly: true` —
  mirrors the existing `update` check, same diagnostic code, one new `if`
  block.
- `packages/compiler/src/mutation/operation-set.ts`'s generic
  `appendOnly && (member === "update" || member === "delete")` refusal for an
  authored Operation Set member already covered `delete` before this merge
  (it was written generically even though no delete kernel existed yet on
  that branch) — confirmed unchanged and still passing
  (`tests/unit/adr0048-immutability-guards.test.ts`'s "refuses a delete
  Mutation member on an append-only Collection as a compiler diagnostic").
- A Mutation cannot reach `ctx.data.<collection>.delete` for an append-only
  Collection because no delete kernel identity
  (`mutation:__collectionKernel.<name>.delete`) is ever projected into
  `collection-operation-programs.json` for it — proven directly in the new
  tests below, not by a type-level exclusion (neither branch added one for
  `update` either; `appendOnly` is a plain `boolean` in the public contract,
  not a literal used in a conditional type).

### Tests added

- `tests/unit/adr0047-adr0048-delete-append-only-refusal.test.ts` (new,
  mirrors `adr0048-immutability-guards.test.ts`'s existing update-refusal
  kernel tests):
  - "refuses a Policy delete operation on an append-only Collection even
    without an explicit Operation Set (the auto-generated Collection Mutation
    Kernel)" — expects `compileApplication` to reject with `QP-COMPOSE-013`.
  - "a create-only Policy on an append-only Collection compiles and generates
    no delete kernel" — asserts the `create` kernel identity is present and
    no `.delete`/`.update` identity exists in the generated operation
    programs.
- `tests/integration/postgres/adr0047-adr0048-delete-append-only-refusal.test.ts`
  (new): builds a fixture app with an append-only, create-only Collection,
  confirms (compiler-level, in-process) no delete/update kernel is projected,
  then runs the real CLI (`build` → `migration apply` → `migration plan` →
  `migration create` → `migration apply`) against the disposable PostgreSQL
  container, inserts a row, and asserts a direct SQL `DELETE` against the
  applied table is refused with `QP001` (`APPEND_ONLY_SQLSTATE`) and the row
  is still present afterward. This is the Postgres assertion the task
  required: the database-level guard from ADR-0048, not the missing kernel
  alone, is what actually enforces the refusal at runtime.

Both new tests pass; see gate results below.

### ADR cross-references made concrete

- ADR-0047 ("Consequences", F5 bullet) previously said "See the separate
  Proposed ADR-0048 ... not present on this branch, tracked elsewhere." Now
  states the concrete post-merge mechanism (kernel refusal code path,
  diagnostic, and the two new test files) since both ADRs are integrated.
- ADR-0048 already described the generic `update`/`delete` Operation Set
  refusal in `operation-set.ts` accurately (written before the delete kernel
  existed, but phrased generically); left unchanged — it was already correct
  and did not need a concrete update the way ADR-0047 did.
- Both ADRs remain **Proposed**, per instruction — this task did not flip
  either to Accepted.

## Branch B's deferred LOW item

ADR-0048's "Open items for owner sign-off" #2: whether to additionally
`REVOKE UPDATE, DELETE ON <table> FROM <application_role>` as defense in
depth, given the kernel is already compile-time incapable of emitting those
statements. Supervisor decision on that branch was explicitly "no, left as
optional future defense in depth... needs its own review, separate from this
slice." Checked whether the delete-kernel merge makes this trivial now: it
does not — extending it would mean generating `REVOKE ... DELETE` alongside
the existing (declined) `REVOKE ... UPDATE`, still changes the privilege
model for shared roles (the generated kernel typically connects as the table
owner), and still needs its own review per the original ADR text. **Left
as-is, not carried over.**

## Gates — commands and real results

All commands run from
`/home/drepkovsky/code/questpie-v4-worktrees/integration` with
`TMPDIR=/home/drepkovsky/.cache/v4-integration-tmp`.

**Install**: `bun install --frozen-lockfile` — no changes to `bun.lock`.

**Changed-scope gate** (`QUESTPIE_DIFF_BASE=a2c8e4a08`, the common ancestor
of both feature branches):

```
bun run scripts/quality.ts changed \
  --typecheck questpie --typecheck @questpie/runtime \
  --typecheck @questpie/compiler --typecheck @questpie/testkit
```

Format (oxfmt --check), lint (oxlint --deny-warnings), four `types:check`
runs, `git diff --check` — pass. First run found 4 oxfmt-unclean files: two
pre-existing on `work/collection-delete-kernel`
(`docs/adr/0047-collection-delete-kernel-operation.md`,
`docs/v4/implementation/collection-delete-kernel.md` — markdown italics style
and one wrapped parameter list) and two from this task's own new test files;
reformatted with `bunx oxfmt` (no content change) and reran clean. Committed
separately from the merges (`294a7816e`).

**Package contract**: `bun run package:check` →
`package-contract: 2 publishable package(s) valid` — pass (run twice, before
and after the manifest repack).

**Architecture ratchet**: `bun run architecture:check` →
`architecture: PASS (439 production TypeScript files)` — pass. All flagged
files are advisory ("review", under the 800-line ratchet); none over budget.

**Unit tests** (full `tests/unit`, split into 4 chunks by file count to keep
each run inside a reasonable window):

| Chunk   | Files   | Tests    | Pass     | Skip  | Fail  | Expect() | Snapshots | Time        |
| ------- | ------- | -------- | -------- | ----- | ----- | -------- | --------- | ----------- |
| 1       | 52      | 334      | 334      | 0     | 0     | 1314     | 17        | 158.35s     |
| 2       | 50      | 235      | 234      | 1     | 0     | 1658     | 0         | 92.57s      |
| 3       | 51      | 229      | 229      | 0     | 0     | 1129     | 1         | 68.90s      |
| 4       | 46      | 231      | 231      | 0     | 0     | 1236     | 0         | 42.35s      |
| **Sum** | **199** | **1029** | **1028** | **1** | **0** | **5337** | **18**    | **362.17s** |

**PostgreSQL integration suites** — disposable container
(`docker run -d --rm --name v4-integration-pg -e POSTGRES_PASSWORD=pw
-e POSTGRES_INITDB_ARGS=--locale=C.UTF-8 -p 127.0.0.1:55651:5432 postgres:17
-c max_prepared_transactions=10`), `PGHOST=127.0.0.1 PGPORT=55651
PGUSER=postgres PGPASSWORD=pw PGDATABASE=postgres`, run **one at a time**:

| Suite                                                                                             | Result                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adr0047-collection-delete-kernel.test.ts`                                                        | 1 pass, 16 expect() — [13.30s] (red before rebuild, then green)                                                                                                                                                                                                                                                                   |
| `adr0047-concurrent-delete.test.ts`                                                               | 2 pass, 222 expect() — [26.63s]                                                                                                                                                                                                                                                                                                   |
| `adr0047-f1f2-delete-validate.test.ts`                                                            | 1 pass, 12 expect() — [14.88s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-f3-transaction-abort.test.ts`                                                            | 1 pass, 11 expect() — [15.32s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-f4-tenancy.test.ts`                                                                      | 1 pass, 10 expect() — [14.48s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-live-query-delete.test.ts`                                                               | 1 pass, 14 expect() — [16.70s]                                                                                                                                                                                                                                                                                                    |
| (merge B lands here)                                                                              |                                                                                                                                                                                                                                                                                                                                   |
| `adr0048-immutability-guards-postgres.test.ts`                                                    | 6 pass, 78 expect() — [69.79s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-collection-delete-kernel.test.ts` (regression)                                           | 1 pass, 16 expect() — [15.79s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-concurrent-delete.test.ts` (regression)                                                  | 2 pass, 230 expect() — [35.15s]                                                                                                                                                                                                                                                                                                   |
| `adr0047-f1f2-delete-validate.test.ts` (regression)                                               | 1 pass, 12 expect() — [15.61s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-f3-transaction-abort.test.ts` (regression)                                               | 1 pass, 11 expect() — [17.61s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-f4-tenancy.test.ts` (regression)                                                         | 1 pass, 10 expect() — [15.75s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-live-query-delete.test.ts` (regression)                                                  | 1 pass, 14 expect() — [16.75s]                                                                                                                                                                                                                                                                                                    |
| `adr0047-adr0048-delete-append-only-refusal.test.ts` (new, cross-feature)                         | 1 pass, 14 expect() — [16.89s]                                                                                                                                                                                                                                                                                                    |
| `public-testing-surface-consumer.test.ts` (dev mode)                                              | 1 pass, 3 expect() — [5.45s]                                                                                                                                                                                                                                                                                                      |
| `public-testing-surface-consumer.test.ts` (`QUESTPIE_PACKED_TARBALL=` real `bun pm pack` tarball) | 1 pass, 3 expect() — [5.29s]                                                                                                                                                                                                                                                                                                      |
| `questpie-testing-internals.test.ts`                                                              | 6 pass, 17 expect() — [11.58s]                                                                                                                                                                                                                                                                                                    |
| `mcp-credential-gate.test.ts`                                                                     | 1 pass, 36 expect() — [21.06s]                                                                                                                                                                                                                                                                                                    |
| `cli-onboarding-packed.test.ts`                                                                   | 1 pass, 55 expect() — [62.37s]                                                                                                                                                                                                                                                                                                    |
| `collaboration-walking-skeleton.test.ts`                                                          | 1 pass, 398 expect() — [18.32s]                                                                                                                                                                                                                                                                                                   |
| `team-support-desk.test.ts` (`FIREFOX_BIN=/usr/bin/firefox`)                                      | **1 fail** on first run — Firefox journey timed out waiting to observe a UI phase ("desk-error"); **1 pass, 111 expect()** on immediate retry [33.83s]. Treated as environment flakiness (browser/host contention after a long run of prior Postgres suites), not a code defect — no source change was made between the two runs. |
| `beta12-release-conformance.test.ts`                                                              | **1 fail** before the manifest repack (stale archive sha256, expected); **1 pass, 9 expect()** [23.70s] after `quality/release/package-artifacts.json` was updated                                                                                                                                                                |
| `tests/integration/postgres/route-auth-runtime.test.ts` (no Postgres needed)                      | 11 pass, 73 expect() — [77ms]                                                                                                                                                                                                                                                                                                     |

Container removed after the run (`docker stop v4-integration-pg`, `--rm` took
care of removal).

**Release dry-run**:

```
bun run scripts/release.ts --dry-run
```

```
release dry-run: questpie@4.0.0-beta.2 questpie-4.0.0-beta.2.tgz sha256=601434ecd1349ace8518a445492a438dcc47d439636bbd96cf951b84c4a8c5af retry-stable isolated-import negative-imports native-react-query peer-boundary packed-build
release dry-run: questpie-opentelemetry@4.0.0-beta.2 questpie-opentelemetry-4.0.0-beta.2.tgz sha256=0c84e8b805a65058efb31e28bac9a143a8390d8780132fced3ff9b7c29c4861f retry-stable isolated-import negative-imports exact-peers peer-mismatch
release dry-run: exact-two-package combined-import
```

Pass, `process.exit(0)`. Read the script first (`scripts/release.ts`): the
`npm publish --provenance ...` branch is gated behind `!dryRun` and a
`GITHUB_ACTIONS`/`GITHUB_REF_TYPE=tag` check that fails outside CI, so
`--dry-run` never reaches it. No push, tag, or publish ran.

## Release-artifact manifest — exact entries changed and why

`quality/release/package-artifacts.json`, package `questpie`:

| Field                          | Old         | New         | Why                                                                                                                                                                                                                                         |
| ------------------------------ | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sha256` (archive)             | `9ebf3842…` | `601434ec…` | Real content change: `dist/cli.js` and the package bundle now include the `delete` kernel (ADR-0047) and the database-immutability compiler additions (ADR-0048, `appendOnly`, `immutable: "database"`, the QP-COMPOSE-013 delete refusal). |
| `.` declaration sha256         | `06ed6232…` | `fc9d4712…` | `dist/index.d.ts` now re-exports the ADR-0047/0048 public surface (`appendOnly` on `defineCollection`, `immutable: "database"` on `field.*`, the `delete` member shape on `ctx.data.<collection>`).                                         |
| `./internal/client-projection` | `121df02f…` | unchanged   | Not touched by either branch.                                                                                                                                                                                                               |
| `./internal/observability`     | `8aa857e7…` | unchanged   | Not touched by either branch.                                                                                                                                                                                                               |
| `./react-query`                | `8b846c4f…` | unchanged   | Not touched by either branch.                                                                                                                                                                                                               |
| `./testing`                    | `a27df1ae…` | unchanged   | Not touched by either branch.                                                                                                                                                                                                               |

Package `questpie-opentelemetry`: **no entries changed** — archive
`0c84e8b8…` and its sole `.` declaration `279a667e…` are byte-identical to
the pre-merge manifest, confirmed by two independent forced rebuilds and
packs.

Both packages were rebuilt from a clean `dist/` twice independently (`rm -rf
dist && bun run build`, run from each package's own directory) and packed
twice each (`bun pm pack --ignore-scripts --quiet`); every pair was
byte-identical.

## Commits

1. `4df36c49c` — merge `work/collection-delete-kernel` (no conflicts).
2. `478065780` — merge `work/collection-db-immutability` (resolves
   `docs/adr/README.md` and `packages/compiler/src/mutation/kernel.ts`).
3. `fcb90899e` — the cross-feature rule: extend the delete-kernel refusal to
   append-only Collections, plus its unit and Postgres tests, plus the
   ADR-0047 cross-reference update.
4. `3d524c015` — repack and update the manifest.
5. `294a7816e` — oxfmt fixes surfaced by the changed-scope gate.

## Not run / out of scope

Same exclusions as the 2026-09-21 integration: `quality:full`/`quality:release`
as one aggregate invocation, load/soak lanes, and a formal
`review:accept:v2` acceptance review (ADR-0047/0048 remain Proposed, no new
Kernel-tier acceptance was requested).

## Status

Both feature lines are merged, the cross-feature delete/append-only rule is
built and proven at the compiler and Postgres level, every enumerated gate
passed with real commands and results above (one Postgres suite flaked once
on Firefox timing and passed on immediate retry with no code change; one
suite was red before the manifest repack, as expected, then green after),
and nothing was pushed, tagged, or published.
`work/v4-integration-20260921` at commit `294a7816e` is a release-candidate
base for further beta.2 acceptance work, subject to the same
HANDOFF.md manual-release-continuation steps as before (fresh aggregate
acceptance manifest, owner's manual reference-app inspection, explicit
publish authorization) — none of which this task was authorized to perform.
