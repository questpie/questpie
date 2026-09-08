# NRQ-01 production extraction — in progress

ADR-0044 is Accepted. This record tracks production implementation, not another
architecture review or beta.2 acceptance. NRQ-01 remains open until its exit
criteria and ordinary reviews pass.

## Implemented seam

The public `questpie/react-query` factory consumes a compiler-rendered, versioned
neutral capability on the generated scope. It works across independently built
client and factory bundles. There is no generated sibling adapter, descriptor
getter, post-generation instrumentation, authored endpoint registry or DTO map.
The optional build bundles its hashing implementation and license; core imports
do not resolve React, TanStack or hashing packages.

The existing generated decoder owns correlated Mutation failure provenance.
Public error constructors do not establish a known commit. Input capture uses
the existing codec transform with an explicit input-restoration direction, so
non-null input cursors remain valid without admitting cursors as output codecs.

The previous React hook remains only for current golden consumers. NRQ-04 owns
their migration; NRQ-05 removes the old export and tests without a forwarding
alias. Production PostgreSQL, browser readiness, pending Mutation retirement and
packed native-hook consumers are not established by the synthetic HTTP test.

## Red/green evidence

- The initial public-factory test failed because the production subpath did not
  exist. Its current focused run passes **3 tests / 10 assertions**, including
  a full-source Support Desk compile, strict positive and negative native types,
  independently bundled generated client, canonical Query/Mutation requests and
  Date decoding. The synthetic peer is a transport witness, not Policy proof.
- Full-source compilation exposed a missing internal type-subpath mapping in
  the compiler's temporary CurrentContract project. The mapping was repaired.
- Ordinary captured non-null cursors exposed incorrect use of the output
  decoder. The shared input-restoration direction repairs that failure while
  retaining the output rejection control.
- Existing detached generated-client fixtures now install their fixture-owned
  neutral package dependency. The combined capability, codec, canonical HTTP,
  live and neutral Query Resource controls pass **40 tests / 260 assertions**.
- Package validation from the repository root passes with **two publishable
  packages**. Source/declaration builds and changed-scope typechecks pass.

The synthetic peer initially omitted the protocol's exact JSON content type;
correcting the peer resolved `PROTOCOL_UNSUPPORTED` without changing the
decoder. GET and POST Context use their distinct existing carriers and decode
to the same Context value in the test. An accidental concurrent rebuild and
consumer run was discarded as setup evidence; subsequent build/consumer runs
were sequential. A package check invoked from a package directory did not
discover the repository packages and is not counted as a pass.

## First broader gate and repairs

The first `quality:full` run passed architecture, format ratchet, zero-warning
lint and workspace types, then ended with 1,183 passing tests and 22 failures
(including missing prototype dependencies/output). It was not green:

- Collaboration's generated public bytes are **127,929**, exceeding BETA-04's
  unchanged **125,000** limit. Reduce repeated implementation type annotations;
  do not raise the budget. BETA-01 measured 51,783 TypeScript instantiations and
  17,678 types, which does not excuse the separate byte failure.
- Generated-client bytes correctly changed the deterministic golden's client,
  checksum inventory and Runtime Build entries. Refresh these after the output
  stabilizes and rerun complete relocated equality.
- One detached generated-application type test still needs the neutral type
  subpath in its source-owned temporary TypeScript mapping.
- Release dry-run rejects the stale package checksum. Refresh the artifact and
  declaration inventory only after the final build for this slice. This is not
  a release-ready claim or permission to publish.

The size repair reuses the already generated Operation method types inside
call/watch/observe implementations, rather than printing the full codec-derived
shape repeatedly. The unchanged BETA-01/BETA-04 budgets and detached BETA-05
type control now pass **3 tests / 29 assertions**: 124,883 public bytes and
51,673 instantiations. Full Collaboration relocation/golden equality passes
**1 test / 31 assertions**. The native consumer measures 30,538 Types and
93,300 Instantiations; this measurement is not a newly invented budget.

The stronger Support Desk relocation test then exposed a pre-existing Bun split
bundle dependency on absolute application-source paths. A minimal lazy-import
reproduction failed with identical chunk contents but different chunk names;
setting Bun's `root` alone did not repair it. The compiler now gives local
application source root-relative module identities while reading physical files
and preserving actual Bun resolution. Its initial resolver failed relative
imports, then an independent import-versus-require control exposed conditional
export drift. Both were repaired before claiming success. The resulting controls
preserve inferred loaders/assets, nested lazy imports, activated Package entry
precedence, conditional exports and emitted-module `import.meta` identity:
**4 tests / 12 assertions**. The real Support Desk consumer, complete stale-output
relocation equality and loader control pass **4 tests / 22 assertions**. Existing
compiler hostiles plus the native lifetime runner pass **11 tests / 43 parent
assertions**. No server inventory filtering or chunk-name normalization occurs
in the test.

After rebuilding, the existing two-package release dry-run passes again. Its
old React-hook peer controls are still transitional; they do not certify native
React hooks. NRQ-05 owns that packed-consumer migration.

## Regression migration

The old prototype tests depended on manually prepared local output. Their
replacement tests compile actual current client output into owned temporary
directories and import the production factory. No blanket test exclusion was
added. Exact child test/assertion counts prevent an empty subprocess from
passing its parent test.

| Production witness                                                                | Executed child coverage                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Native generated client, live, Mutation lifetime, invalidation and pending intent | 52 tests / 243 assertions, strict generated types |
| Internal synchronous live-option races                                            | 10 tests / 32 assertions                          |
| Identity and Suspense                                                             | 7 tests / 25 assertions                           |
| Independently bundled client/factory                                              | 4 tests / 27 assertions                           |
| Native React DOM lifetime                                                         | 2 tests / 12 assertions                           |
| Native Router serialization and hydration                                         | 6 tests / 38 assertions                           |
| Forward infinite                                                                  | 7 cases plus strict inference controls            |
| Renamed cursor and compiler paging projection                                     | 2 tests / 13 assertions                           |

The equivalent old executable tests were removed only after their replacements
passed. The old renderer-instrumentation rejection is obsolete because production
does not instrument output; capability-version rejection and core browser-bundle
isolation are now production controls. Historical review/evidence records and
the separate accepted proof worktree remain available in git. Actual Start
browser scripts still need migration before deleting their prototype algorithm
dependencies; these are not shipped package compatibility paths.

Native test dependencies are explicit development dependencies. Router 1.170.33
was refused by the existing 72-hour package quarantine; these controls instead
use the already available Router 1.170.18 with SSR Query integration 1.167.2.
The native serializer tests exposed transitive seroval version skew. Aligning
the compatible dependency to 1.6.6 and forcing a frozen package-manager reinstall
repaired the installed tree; no serializer replacement or manual runtime patch
was added. React/ReactDOM are 19.2.8 and React Query is 5.102.8.

## Remaining before closing NRQ-01

The production disposable PostgreSQL runner now passes strict generated types
and **2 real scenarios / 39 assertions**. It starts the compiled app with its
complete original integrity inventory, then exercises the public factory's
two-family refresh, independent scope, live windows/inverse, response loss
without automatic retry, reconnect replacement, Policy omission/denial and
retirement. `bun run tests/support/native-react-query-postgres-run.ts` owns an
exact loopback PostgreSQL 17 container, honors `TMPDIR`, strips inherited database
targeting variables from the child and cleans its container/temporary files.
Its ordinary test is skipped without that owned runner, never counted as PG PASS.

The earlier combined focused native/code-generation suite passed **34 parent
tests / 138 assertions** with its then-current exact child counts. The subsequent
`quality:release` passed architecture, format ratchet, zero-warning lint and
workspace types/builds, then finished with **1,204 tests passing / 3 failing**
in 503 seconds. Two failures are the package checksum pin becoming stale after
the formatted-source rebuild. The remaining failure is complete Support Desk
relocation equality: shared CommonJS module ordering differs only in the broad
test process. Isolated equality and targeted predecessor groups pass, but do
not close this order-dependent defect. No equality assertion or inventory is
weakened; diagnostic bisection remains active.

Independent lifetime review added native disabled/static invalidation and
two-family correlated committed-result-failure controls, then exposed a real
cleanup defect. A throwing Query observer interrupted native notification and
left a same-key sibling and another owned Query holding data. The public-factory
test was red before the repair. A shared private cleanup routine now advances
all attached native observers, removes each owned Query and lets whole-scope
disposal finish all cleanup before reporting an aggregate subscriber failure.
Another generated-watch test reproduced the same defect on terminal denial.
That path now shares cleanup, retains the original authorization error in native
state and contains notification failures after cleanup; it adds no error ledger
to the opaque retired-key marker. Both red cases are green in the current strict
generated consumer suite: **52 tests / 243 assertions**. The internal synchronous
watch races remain **10 tests / 32 assertions**. A read-only independent review
found no remaining concrete blocker in this cleanup delta.

Exact focused command (with the task-owned writable `TMPDIR`):

```sh
bun test tests/integration/native-query-lifetime.test.ts --timeout=120000
```

The repository `check:changed` command for that lifetime test and the `questpie`
typecheck passes, including changed-file format, zero-warning lint and
`git diff --check`. After the completed build, the package artifact pin was
regenerated from `bun pm pack --ignore-scripts`. Both previously failing release
checksum controls now pass alongside identity, independent browser-bundle and
native React DOM controls: **7 parent tests / 32 assertions**. Their dry-run
package checks remain transitional, not NRQ-05's native packed-hook acceptance.
The order-dependent compiler bundle failure still prevents broad-gate closure.
The native PostgreSQL runner was rerun after both cleanup repairs and again
passed its exact two scenarios / 39 assertions; the parent completed in
11 seconds and no owned container remained. Diagnostic bisection also ran the
entire known pre-failure sequence (four hostile files and all integration
predecessors, including three public-package rebuilds): **139 pass / 2 skip /
0 fail, 843 assertions**. Complete generated-file equality remains unchanged.
This green prefix does not explain the two previously red repository-wide runs.

## Latest broad checkpoint

A third `quality:release` invocation passed its complete `full()` stage: ordinary
tests (including exact Support Desk relocation), the separate browser-hook
control, workspace/docs builds, skill validation and whitespace checks. It then
stopped at strict Knip: the optional React Query peer and bundled hash build
dependency were classified as unlisted production requirements. This invocation
is **not** recorded as an end-to-end release PASS.

The `questpie` workspace now names those two exact dependencies alongside its
existing optional React classification. No global dependency rule was disabled.
The package contract still requires the optional supported native peer, rejects
runtime UI/hash dependencies and verifies archive entries/license. A new red-first
test additionally enforces the exact audited hash build pin. Package contract
tests pass **6 / 32**; strict Knip, its deliberate unlisted-dependency/binary
negative control, package validation and changed-scope checks all pass.
The remaining release-stage commands were run explicitly: packed OTel isolation
**1 / 2,393**, packed CLI telemetry **1 / 24**, and **19** performance manifests.
These controls preserve the existing OTel behavior; this slice adds none.

Repository-wide discovery with only the native full-source test selected also
passed **1 / 13** across 317 discovered files. No source-backed explanation for
the earlier mismatches was established. Do not add a synchronous-read workaround,
normalize bundles, or call that history repaired merely because these runs are
green. Frozen-source repeated relocation and independent review remain required,
followed by one complete release invocation on the finished slice.

Independent Standards and Spec reviews remain pending. NRQ-02's complete
PostgreSQL/lifetime closure and NRQ-03's actual Start browser evidence are still
outstanding.
