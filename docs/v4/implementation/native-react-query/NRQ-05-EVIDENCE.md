# NRQ-05 packed consumers, tutorials and deletion

This is ordinary production-delivery evidence under Accepted ADR-0044.
The combined gate and independent Standards/Spec review are complete.
This record does not establish aggregate beta.2 acceptance or publication readiness.

## One production entry

The migrated Desk imports `questpie/react-query`. The package no longer exports
`questpie/react`; its implementation and hook-only tests are removed without a
forwarding alias. Collaboration retains the framework-neutral Query Resource.
The public package inventory remains exactly `questpie` and
`questpie-opentelemetry`, both at the candidate version.

The package/export negative control failed while the old export existed, then
passed after deletion. The public skill admits the native subpath and native
React/TanStack imports, and rejects the retired hook. It links to the executed
guides rather than copying another component implementation.

Fifty-two executable files under the accepted React prototype were deleted:
duplicate adapters, render instrumentation, generated-consumer experiments and
the prototype Start hosts. Markdown evidence, acceptance manifest and review
record remain. `review:accept:verify` passes before and after deletion because
it verifies the committed reviewed tree. Git preserves the removed source; the
historical record is not a claim that a deleted benchmark runs on this head.

## Real installed package consumers

`scripts/release-native-query.ts` consumes an existing archive. It does not
rebuild shared output. The Archive fixture is copied unchanged, with one
additional source-authored structural Query for proven forward continuation.
The existing handler-shaped page does not acquire that capability.

The consumer installs actual React, ReactDOM and TanStack peers, compiles with
the packed CLI, checks generated positive and negative types, runs native
ordinary/Suspense/infinite/Mutation consumers, physically relocates the entire
installed application and repeats the checks. Core-only installation and browser
bundling reject optional UI/hash dependency resolution. The retired subpath
cannot be imported. No fake React package certifies these controls.

Missing React fails on actual native use. The unsupported-version control
installs real React 18 and TanStack 5.0 packages and compares those versions to
the declared supported ranges. Import/cache construction is not a complete
compatibility claim and does not fabricate a runtime version guard.

Ordinary quality selects the runtime consumer explicitly by default. Release
quality and release dry-run require the actual Firefox consumer. Missing Firefox
is a failure, not an availability-based skip or runtime substitute. The combined
two-package dry-run also installs real peers and renders through ReactDOM.

Independent cleanup review found missing owned child scratch and browser
acquisition outside cleanup. Both have executable negative controls: an inert
command recorder exposes inherited scratch, a missing browser exposes a leaked
profile, and a TERM-resistant process with an owned descendant exercises bounded
group termination. These are process-supervision controls, not React evidence.
The repairs confine scratch, enclose acquisition in `finally`, and escalate
TERM to KILL. Runtime passes 2 tests / 13 assertions; actual Firefox passes
2 tests / 12 assertions. An independent non-author confirmed both findings closed.

## Public basic tutorial

`react-query-basic.mdx` reuses the Barbershop ticket/Context/Policy source and
adds one Collection-derived named Mutation. Its exact public TypeScript config,
backend declarations and component/host fences are extracted into a clean
installed consumer. No generated descriptor or handwritten DTO replaces them.

Packed CLI generation, strict types and actual ReactDOM/JSDOM pass. The same
scenario passes in Firefox: 37 checks and five distinct Mutation calls. It
exercises decoded Dates, loading, separate pending intent, typed declared
failure, unknown outcome, disappearing authorized base, late settlement after
retirement, equal-Context fresh ownership and cleanup. Removing unmount produces
a real retained-DOM failure. Repeated cleanup initially returned different
Promises; the application host now returns one memoized cleanup Promise.

The browser peer is a controlled generated-protocol peer, not PostgreSQL.
Backend declarations are compiler/type evidence in this tutorial; the separate
golden PostgreSQL journey owns Runtime/Policy execution evidence. The guide
explicitly requires an existing authenticated backend and readable data, and
does not claim its simple Policy provides tenant isolation.

The DOM test host releases only demonstrated native five-minute GC timers after
the scenario. Unexpected remaining schedules fail the host check. It does not
force process exit, change the public `gcTime`, or pretend JSDOM is Firefox.

Three ordinary read-only Opus reviews covered facts, prose and examples. Verified
repairs add JSX/source-root prerequisites, distinguish watch delivery from
one-shot invalidation, describe terminal recovery and cleanup rejection, and
link both guides in navigation. A regression test pins navigation and beta.2
preview staging. The overview clarifies that the readiness barrier belongs to
SSR hydration, not a fresh browser-only mount.

## Start tutorial

`react-query-start.mdx` uses the same generated Barbershop contract with the
official Start Router Query integration. The first exact-fence verifier passes
packed generation, actual Start build and strict types, and checks that the
server-only configuration name is absent from browser JavaScript. That build
alone is not tutorial browser evidence.

Three ordinary Opus reviews verified the API and identified narrower setup,
dependency-coupling and evidence gaps. The prose now names the trusted server
origin, required browser same-origin proxy, Bun type prerequisite, build-before-
typecheck order and whole-document credential lifetime. Dependency install pins
are coupled to the guide, and the artifact controls check the actual server
guard and all emitted browser files rather than a generic `fetch` substring.

Independent owner-lifetime review found that disposal before the first browser
hydrate could leave an unbound owner reusable. Actual Firefox first failed with
`Pre-bootstrap retirement allowed late hydration`. The host now marks retirement
synchronously, fences API/bootstrap access and returns one disposal Promise.
This is application host ownership, not a new framework API or architecture
acceptance. Upstream Router Query already owns server cache cleanup.

Final default verification passes 1 test / 22 assertions: packed generation,
strict types, actual Start build and SSR. Explicit Firefox passes 1 test /
27 assertions, including hydrated Dates, live delivery, one-shot infinite mode,
pre-bootstrap retirement and missing-browser cleanup. The server sends a
process-only generated test cookie to the configured backend and refuses a
redirect; the redirected target receives no request. The value is neither
written nor logged.

A second independent review found two cancellation gaps in the tutorial worker:
SIGTERM during profile acquisition or during the final browser stop could still
allow later work or a success record. A copied-worker negative control injected
SIGTERM after that last awaited stop and initially observed false success. Abort
checks now fence both boundaries. The same reviewer confirmed closure after the
default and Firefox reruns; no finding remains in this Start delta.

This tutorial uses a controlled generated HTTP/SSE peer, not PostgreSQL. Its
browser host buffers a complete document and does not prove streamed-shell or
held-asset timing. The separate production Start tracer retains those controls.

## Release script failure cleanup

A bad-checksum manifest reproduced a leaked release scratch directory because
`process.exit(1)` bypassed `finally`. Throwing the existing failure instead keeps
the same rejection and publication restrictions while running cleanup. The
regression uses the real dry-run entry and checks the owned directory is empty.
Release/package/staging units pass 27 tests / 172 assertions, with the one
heavy contract deliberately selected only by release quality.

The expanded dry-run initially duplicated the Archive CLI build already owned
by the native packed consumer. Removing only the old duplicate preserves the
complete copied source and an explicit generated Runtime entrypoint assertion.
An independent reviewer confirmed that this does not remove the packed build
proof. The unchanged measured release budget is 15 seconds.

Actual nested release tests then stalled at the combined two-package install.
The minimized control uses the same archive bytes and real native peers. Shared
Bun cache repeatedly stalled for its 30-second diagnostic deadline; three fresh
owned-cache controls installed the same 40 packages in 1,688, 1,556 and 1,601 ms.
Executable identity, NODE_ENV and adding a shell did not explain the difference.
The combined release consumer now uses its own disposable `--cache-dir`; the
shared cache is neither changed nor purged. Async pipe draining alone did not
repair the stall and is not described as its cause.

The first full measured rerun completed the actual dry-run, but took 18,810 ms
while broad quality was running and failed the unchanged budget. After broad
quality finished, the isolated measured run passes 1 test / 9 assertions in
14,760 ms. Both are local measurements, not stable-runner evidence.

Independent process review also found that a Bun test timeout did not own its
async release child. Release tests now reuse the existing worker supervisor,
with a deadline before the outer test timeout, group termination, bounded
escalation and owned scratch cleanup. The helper is renamed for its two actual
consumers, with no forwarding wrapper. Review then exposed early root exit
discarding the termination grace before an independently piped browser host
could stop its detached child. The exact synthetic negative control first fails
on the missing cleanup witness. Preserving the already scheduled grace repairs
that control; successful workers gain no delay. Three timeout scenarios pass
18 assertions twice, including cooperative and TERM-resistant inherited-pipe
descendants. These are cleanup controls, not browser product evidence.

Two intermediate dry-runs pass both real packages, installed native peers and
the Firefox consumer, including after the cleanup repair. They initially use a
task-local tool-derived manifest. The canonical manifest is now regenerated
from the actual archives and declaration exports after the combined ordinary
performance test correctly rejected its stale checksum. Neither run is a
final-head forced build required by NRQ-06. No publication command reached a registry; the
publication unit test uses only an inert local command recorder.

## Repeated production checks

After the old export deletion, the owned PostgreSQL 17/Firefox Desk journey
passes again: 1 test / 111 assertions. The separate native PostgreSQL consumer
passes its live replacement and two-family refresh scenario. Both disposable
containers are gone after their runners return.

The complete existing Start runner also passes again: baseline 50 assertions,
four fault scenarios, credential retirement 26 assertions, and resume/cancel/
retire readiness controls. It remains distinct from the new tutorial's exact
bytes and from PostgreSQL Policy evidence.

The complete `quality:release` passes 1,227 ordinary tests, 198 gated skips and
zero failures; 18 snapshots / 6,637 assertions. It also passes nine workspace
typechecks, six builds, the isolated native Desk DOM entry (8 / 94), skill,
format/lint, Knip, docs and the exact two-package inventory. Explicit release
checks pass the real dry-run/manifest rejection contract (3 / 18), packed native
Firefox (2 / 13), basic tutorial Firefox (37 internal scenario checks), Start
tutorial Firefox (1 / 27), packed OTel isolation (1 / 2,384) and CLI (1 / 24).
The raw log is retained at
`/home/drepkovsky/code/questpie-native-nrq05-gate.L1tTbI/quality-release.log`.

That broad gate precedes the final timeout-grace and inert dispatch-recorder
repairs. Their affected tests, strict helper/script types and `check:changed`
pass afterward. This is not a frozen NRQ-06 gate. The accepted ADR-0044 review
record still verifies after prototype deletion. Six failed-diagnostic consumer
directories were removed after checking that none owned a live process; their
logs remain. Shared Bun cache and unrelated worktrees were not changed.

Independent non-author Standards and Spec reviews have no remaining finding.
The [review record](NRQ-05-REVIEW.md) separates package/deletion, public tutorial
and process-cleanup reviews from formal architecture acceptance. NRQ-05 is complete.
NRQ-06 still owns the final integrated PostgreSQL/load/soak/stable-runner gates,
two forced byte-identical builds/dry-runs, manual preview and aggregate ADR-0039
acceptance. No push, tag, publish, deployment or registry deprecation occurred.
