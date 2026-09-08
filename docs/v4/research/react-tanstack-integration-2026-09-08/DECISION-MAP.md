# React integration: bounded continuation

Status: research planning, 2026-09-08. No ticket claims implementation or formal
acceptance. Read [the recommendation](RECOMMENDATION.md) first. Existing release
work and dirty Autopilot migration remain separate.

## Ratification delta

Already requested: real TanStack Query integration; generated/inferred contracts;
useful invalidation and optimism; investigate TanStack DB. Do not re-grill these.

Resolve only the guarantees that research could not establish:

1. Choose and prove the initial observation boundary: fresh post-commit watch
   generation first; new opaque wire receipt only if the cost or correctness
   evidence rejects that candidate. Specify committed-but-unobserved, unknown
   outcome, cancellation, retry and protected-state retirement independently.
2. Set the release cut: include the bounded Query integration in beta 2 or make
   it the next beta. Do not imply that optional DB or complete SSR is already
   requested as a beta-2 blocker.

The framework should pick safe reversible implementation details autonomously.
Escalate only a changed public guarantee or release scope, with evidence.

## Proposed tracer slices and explicit blockers

| Slice                                               | Depends on                                      | Falsifiable exit                                                                                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: Descriptor and ordinary Query/Mutation vertical | Focused public-surface decision                 | Compiler emits one reusable descriptor; native options infer input, output and declared errors; direct/generated transport behavior unchanged; no repeated schema/key registry                                 |
| R2: Live Task detail and terminal scope lifetime    | R1                                              | First fetch resolves; active observers share one watch; disabled observer/prefetch/GC behavior explicit; browser credential switch, denied result and old references cannot restore protected state            |
| R3: Task detail + board transition                  | R2 and chosen observation semantics             | Known commit distinguished from observed snapshot; no-op/delete/filter cases; overlapping A/B optimistic layers; expectedVersion conflict; cancellation/lost ack; separate Query views never advertised atomic |
| R4: Conservative inferred invalidation              | R1; integrates with R3                          | Policy/Context/relation/lifecycle/cascade cases have no false negatives; opaque dependencies handled explicitly; no private write-set disclosure; active live recompute not duplicated by blanket HTTP refresh |
| R5: Conversation and Library counterexamples        | R3 + R4                                         | Nonce duplication, replay gap, composite windows, membership revocation and multi-family writes preserve behavior; mechanical logic removed without deleting domain semantics                                  |
| R6: Public adapter and consumer migration           | R2–R5 + applicable acceptance                   | Recommended exports/docs/skills agree; current consumers migrated; obsolete paths deleted only once unused; browser/PostgreSQL and Standards/Spec evidence on exact candidate                                  |
| DB1: Optional keyed Query collection proof          | R1 + R2; independent of R3–R6 release inclusion | Full snapshots remove omitted fields; keys proved or explicitly supplied; pending/cleanup/late completion safe; no queued-commit deadlock; no universal normalized Collection authority claim                  |
| SSR1: Server prefetch and hydration                 | R1 + R2; separate scope decision                | Per-request cache/identity and codec-safe serialized values; no cross-user hydration; finite prefetch and single live handoff                                                                                  |

Tests precede implementation within each slice. Start with one generated
reference app, then prove the Autopilot Task behavior before broad migration.
Actual Autopilot port remains subject to its released-artifact gate; source
inspection here did not waive it.

R3 and DB1 must also test an authorized replacement which removes a formerly
visible field or row while an older optimistic write is pending. The pending
layer must not restore removed protected data. This is not covered by terminal
scope disposal, a denied response, or testing full replacement without optimism.

## Supersession ledger to carry into the focused ADR

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
