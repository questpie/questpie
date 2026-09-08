# React integration: bounded continuation

Status: research planning, 2026-09-08. No ticket claims implementation or formal
acceptance. Read [the recommendation](RECOMMENDATION.md) first. Existing release
work and dirty Autopilot migration remain separate.

## Ratification delta

Already requested: real TanStack Query integration; generated/inferred contracts;
useful invalidation and native userland optimism; investigate TanStack DB. The
later [owner-confirmed scope decision](BETA2-SCOPE-DECISION.md) defers framework
optimistic layers and a no-flicker commit-to-observation guarantee. Do not
re-grill these choices.

Resolve only the guarantees that research could not establish:

1. Keep commit outcome separate from Query freshness. A causal observation
   fence, fresh-watch confirmation and new observation receipt are not beta.2
   blockers after the owner-confirmed scope reduction. Preserve known commit,
   unknown outcome, cancellation, retry and protected-state retirement rules.
2. The owner settled the release cut on 2026-09-08: native React Query,
   Suspense, forward infinite Queries, safe scope lifetime **and TanStack Start
   SSR/hydration are required before beta.2**. Use the standard TanStack
   integration; do not build another hydration system. Optional TanStack DB,
   live infinite lists and offline/persistence remain outside this beta.

The framework should pick safe reversible implementation details autonomously.
Escalate only a changed public guarantee or release scope, with evidence.

## Proposed tracer slices and explicit blockers

The owner approved continuing the recommended narrow proof. An initial native
Query/watch seam now has [executable evidence](../../prototypes/react-query-integration/EVIDENCE.md):
10 tests / 32 assertions with an external watch peer and an isolated pinned
install. This settles neither R1's generated descriptor nor R2's browser and
generated-transport contract. It adds no release-scope or acceptance authority.

The next [R1 construction checkpoint](../../prototypes/react-query-integration/GENERATED-EVIDENCE.md)
adds nine tests / 38 assertions through production-rendered Query/Mutation
transport and native options, plus strict generated-consumer inference and a
browser bundle without React/TanStack imports in the core client. The input is
normalized IR, not full application compilation. Capture reclamation, reserved
overrides, pending Mutation retirement and live integration remain open; R1 is
not marked complete.

The [generated watch checkpoint](../../prototypes/react-query-integration/GENERATED-LIVE-EVIDENCE.md)
connects the existing SSE renderer and adds first-result, prefetch cleanup and
denial coverage. A separate-bundle regression exposed and repaired colliding
adapter namespaces. The combined prototype has 23 tests / 86 assertions. Local
25/200-operation TypeScript measurements are recorded, without claiming a
release budget. Next: render-pure computed identity and native-cache-owned work;
then actual React/browser and PostgreSQL observation evidence. R2 is still open.

The owner's follow-up asks about infinite/suspense Queries, Start and current
package skills. The [compatibility audit](../../prototypes/react-query-integration/TANSTACK-COMPATIBILITY.md)
records exact upstream versions and a reproduced native hydration key miss.
Before selecting computed identity, reconcile server/browser lifetime; do not
accidentally lock the general adapter to a browser-only fingerprint. Add explicit
ordinary/suspense, infinite pagination and Start loader/SSR/streaming consumers.
None is supported merely because Query Core tests pass. This refines the design
evidence required before selecting the interface; it does not silently expand
the beta-2 release cut or declare SSR1 complete.

The [native React checkpoint](../../prototypes/react-query-integration/REACT-HOOK-EVIDENCE.md)
repairs the options type through failing native-hook consumers and adds four
React tests. The combined suite now has 27 tests / 102 assertions. Server
Suspense streams a shell and decoded results; jsdom StrictMode exercises native
Query/Mutation hooks and Query retirement. A completed Mutation result still
survives scope disposal. Actual browser transport was unavailable. Start key
identity, full Mutation retirement and infinite pagination remain open; no
slice or release gate is marked complete by these narrower results.

A follow-up [pending-Mutation diagnostic](../../prototypes/react-query-integration/REACT-HOOK-EVIDENCE.md#pending-mutation-counterexample)
proves that removing native Mutation cache entries does not fence a late result.
Resetting the observer prevents its publication but still runs the options
callback and resolves the original Promise with the result. R2 must separate
UI publication lifetime from committed/unknown write outcome before R3 optimism;
cache removal alone cannot close that edge.

The [pagination source audit](../../prototypes/react-query-integration/PAGINATION-RESEARCH.md)
finds existing exact forward cursor/page-size metadata for direct structural
Queries. Project it without new authored DTOs or cursor mappings; keep arbitrary
handler results ineligible until their paging relationship is established.
The next finite consumer must include a nonempty terminal page, renamed cursor
parameter, native infinite/Suspense type inference and ordinary/infinite cache
separation. Independent page watches do not establish contiguous live lists.
The first full-source Support Desk compilation consumer now passes one test
with five assertions for the positive root mapping and negative handler case.
The total at that checkpoint was 28 tests / 107 assertions alongside the
27 native/generated tests. The [infinite checkpoint](../../prototypes/react-query-integration/INFINITE-EVIDENCE.md)
now adds generated native page execution and strict ordinary/Suspense infinite
consumers. A copied full-source fixture proves renamed cursor injection and
rejects page-shaped handler inference. Identity/lifetime remains R1/R2 work.

The owner subsequently made SSR1 a beta.2 blocker. The
[Start candidate](../../prototypes/react-query-integration/SSR-CANDIDATE.md)
reuses the official Router Query integration and selects a computed-identity
experiment; it does not introduce another hydration owner.

The [identity checkpoint](../../prototypes/react-query-integration/IDENTITY-EVIDENCE.md)
now replaces ordinal capture slots with computed keys and explicit request-local
bootstrap. Native Router serialization and an actual Start production build
with Firefox prove Date-preserving hydration and streamed Suspense without a
duplicate browser one-shot fetch. Watchable hydration handover and complete
Mutation retirement remain open. The prototype rejects its replaced v1 contract;
there is no compatibility identity path or production authority projection.

| Slice                                               | Depends on                                      | Falsifiable exit                                                                                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: Descriptor and ordinary Query/Mutation vertical | Focused public-surface decision                 | Compiler emits one reusable descriptor; native options infer input, output and declared errors; direct/generated transport behavior unchanged; no repeated schema/key registry                                 |
| R2: Live Task detail and terminal scope lifetime    | R1                                              | First fetch resolves; active observers share one watch; disabled observer/prefetch/GC behavior explicit; browser credential switch, denied result and old references cannot restore protected state            |
| R3: Native userland optimism recipe                 | R1 + R2                                         | Generated native callback/state types; pending intent separate from authorized base; error and disposal limits; no blind whole-cache rollback or framework-owned layers                                        |
| R4: Conservative inferred invalidation              | R1; integrates with R3                          | Policy/Context/relation/lifecycle/cascade cases have no false negatives; opaque dependencies handled explicitly; no private write-set disclosure; active live recompute not duplicated by blanket HTTP refresh |
| R5: Conversation and Library counterexamples        | R2 + R4                                         | Nonce duplication, replay gap, composite windows, membership revocation and multi-family writes preserve generated/live behavior; no automatic optimistic reconciliation claim                                 |
| R6: Public adapter and consumer migration           | R2–R5 + applicable acceptance                   | Recommended exports/docs/skills agree; current consumers migrated; obsolete paths deleted only once unused; browser/PostgreSQL and Standards/Spec evidence on exact candidate                                  |
| DB1: Optional keyed Query collection proof          | R1 + R2; independent of R3–R6 release inclusion | Full snapshots remove omitted fields; keys proved or explicitly supplied; pending/cleanup/late completion safe; no queued-commit deadlock; no universal normalized Collection authority claim                  |
| SSR1: Server prefetch and hydration                 | R1 + R2; required for beta.2                    | Per-request cache/identity and codec-safe serialized values; no cross-user hydration; finite prefetch and single live handoff                                                                                  |

Tests precede implementation within each slice. Start with one generated
reference app, then prove the Autopilot Task behavior before broad migration.
Actual Autopilot port remains subject to its released-artifact gate; source
inspection here did not waive it.

R3 must demonstrate that its recommended pending-UI recipe does not restore
old authorized rows/Fields through a whole-cache rollback. Arbitrary application
cache mutation remains user-owned. The stronger ordered-layer omission/rebase
proof remains a requirement for any future framework optimism or optional DB
claim, not permission to reintroduce that engine into beta.2.

## Supersession ledger to carry into the focused ADR

Current construction follow-up: [Start readiness and fault evidence](../../prototypes/react-query-integration/SSR-LIFETIME-EVIDENCE.md)
covers native hydration/live handover, interrupted streams, failed JavaScript,
navigation and ordinary/infinite readiness races. The
[Mutation lifetime evidence](../../prototypes/react-query-integration/MUTATION-LIFETIME-EVIDENCE.md)
closes attached observer cleanup and fences pending decoded outcomes without
claiming rollback or cancellation of already-started native callbacks. Private
projection v3 replaced v1/v2 without compatibility. The subsequent
[invalidation checkpoint](../../prototypes/react-query-integration/INVALIDATION-EVIDENCE.md)
uses v4 to add compiler-owned watchability and a conservative public-family
superset, not a precise write-set claim. Native userland pending-intent types
and HTTP tests pass without a framework optimistic engine. The combined suite
has 75 tests / 311 assertions, two DOM tests / 12 assertions, six TypeScript
projects and the existing Start/Firefox baseline and fault scenarios passing.
The [credential-switch consumer](../../prototypes/react-query-integration/start-app/CREDENTIAL-SWITCH-EVIDENCE.md)
subsequently exposed late native hydration restoring retired cache data. The
targeted readiness-bound guard closes that defect: 76 parent tests / 315
assertions, two DOM tests / 12 assertions, six type projects and 26 actual
credential-switch browser assertions pass alongside the 37/45 baseline/fault
checks. The [Collaboration PostgreSQL consumer](../../prototypes/react-query-integration/collaboration-native-EVIDENCE.md)
adds two tests / 39 assertions for distinct families/windows, reconnect,
no automatic write retry, real Policy omission and membership retirement.
The [public-factory proof](../../prototypes/react-query-integration/factory-seam-evidence.md)
adds four tests / 27 assertions and strict native type inference without a
generated sibling import. None of these checkpoints ships production exports.
[ADR-0044](../../../adr/0044-native-react-query-integration.md) remains Proposed;
its acceptance, production extraction, golden-consumer/docs/skills migration
and final combined release gates are the active frontier. Earlier counts and
counterexamples above remain historical evidence, not current blockers.

| Existing authority                                      | Candidate change                                                                                                        | Remains unchanged                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| ADR-0035 React recommendation / excluded TanStack scope | Add native TanStack Query integration; decide how the thin React export is retired after consumer migration             | Existing `.watch` transport, Query Resource consumers unless explicitly migrated; no duplicate cache owner for one result |
| ADR-0042 public export contract                         | Add approved optional `questpie/react-query` subpath and dependency boundaries; optional DB spelling only when proved   | Public package identities; no invented scoped packages                                                                    |
| ADR-0023 operation outcome                              | Document integration handling; supersede only if a new public receipt is actually selected                              | Stable call identity, opaque XID, commit semantics, nondisclosure                                                         |
| ADR-0012 live Query guarantees                          | No proposed change for descriptor/options projection; add a narrow decision only for a genuinely new coverage guarantee | Policy-before-window, complete results, server dependency tracking, independent Query snapshots                           |

New architecture/Kernel guarantees follow repository proof and acceptance before
authority projection. Ordinary Product adapter slices use deterministic evidence
and normal review. Neither Fable design consultation nor the upstream probe run
is an acceptance PASS.
