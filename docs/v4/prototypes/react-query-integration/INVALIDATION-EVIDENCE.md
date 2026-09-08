# Local commit invalidation evidence

Construction evidence on top of `14586421c`, dated 2026-09-08. The
[candidate](INVALIDATION-CANDIDATE.md) is implemented only in this isolated
prototype. Production extraction and architecture acceptance remain open.

One generated Query descriptor now carries its compiler-proven watchability.
Private projection v4 replaces v3; there is no compatibility branch. The
adapter derives one conservative family superset from the existing descriptors.
It emits no private dependency graph and requires no authored invalidation map.
This trades extra one-shot refetches for coverage without pretending to know an
arbitrary named Mutation's precise write-set.

## Falsification and repair

The generated transport/native observer seam exposed these failures in order:

- A successful Mutation left inactive results fresh: the first test failed,
  then binding-scoped invalidation passed it.
- Invalidating an older initial read joined that read instead of replacing it.
  Active and inactive variants failed. Cancelling matching reads before native
  invalidation made all three tests pass.
- A decoder-proven `COMMITTED_RESULT_UNAVAILABLE` did not invalidate. Six tests
  passed and that case failed before the commit notification was added to the
  existing Mutation lifetime owner. Declared, unknown and forged outcomes do
  not acquire that notification.

The final focused invalidation suite has ten tests and 34 assertions. It also
proves that Query refresh failure does not replace the Mutation outcome or
native application callback, and that retirement and a later commit fence an
older refresh. Another scoped owner is untouched.

Generated SSE tests establish that local commits do not reopen ordinary live
Queries or mark inactive hydrated live families stale. Server-mode ordinary
Queries remain one-shot targets. A full-source Support Desk consumer proves
that infinite mode refreshes after commit even when that Query's ordinary
browser mode is live.

The [native userland recipe](USERLAND-OPTIMISM-CANDIDATE.md) adds five tests and
41 assertions against a real loopback HTTP peer. It keeps pending intent apart
from the current result and never saves or restores a Query snapshot.

## Verification

Run from this prototype directory, with its generated clients present:

```sh
bun test live-options.test.ts generated-client.test.ts query-adapter.test.ts \
  generation.test.ts generated-live.test.ts hydration-identity.test.ts \
  infinite-query.test.ts pagination-source.test.ts renamed-pagination.test.ts \
  react-suspense.test.ts mutation-lifetime.test.ts invalidation.test.ts \
  userland-optimism.test.ts
bun test react-dom.test.ts
bun run types:generated
bun run types:infinite
bun run types:react-errors
bun run types:generation
bun run types:renamed
bun run types:check
```

Results: 75 tests / 311 assertions, then two DOM tests / 12 assertions, and all
six TypeScript projects pass. Full-source tests compile in isolated directories.
On this host generation uses task-owned writable `TMPDIR` because `/tmp` has
exhausted its quota.

The separate `start-app` consumer passes `bun run build`, `bun run types:check`,
`bun run test:browser` and `bun run test:browser:faults`: the actual Start/Firefox
baseline has 37 assertions; the four fault scenarios have 45. The expected
injected `TEST_SSR_CONNECTION_INTERRUPTED` is not an unexplained test failure.
These rerun existing hydration/lifetime coverage; they do not add a browser
credential-switch or PostgreSQL invalidation proof. Generation and Start builds
must not write the same generated client concurrently.

Independent Standards/Spec review found no invalidation blocker and ran an
additional eight-assertion concurrent-commit/retirement diagnostic. Independent
recipe review found no scope blocker; its malformed HTTP peer finding was
reproduced and corrected as recorded in the recipe. Changed-file formatting,
lint and `git diff --check` pass. These ordinary reviews are not a formal
architecture acceptance PASS.

## Remaining boundary

Invalidation completion does not prove observation of the commit. Native
disabled/static behavior is preserved. Remote writes, other scopes and later
Job effects use their existing live subscription or explicit refresh policy.
No ordered optimistic layers, rollback/rebase, receipt fence or Mutation retry
engine was added. Complete credential-switch consumers, remaining R5 hostiles,
production compiler/package extraction, public docs/skills and final combined
PostgreSQL/browser release evidence are still required.
