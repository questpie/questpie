# BETA-09: the seventeen criteria against what shipped

`acceptance-shape.md` fixed seventeen criteria before implementation. This
checks each one against the tree. It is written because the slice is not close
to acceptance and saying so precisely is worth more than saying so vaguely.

Verified by reading the tree, not from memory. Base: `feat/v4-beta-09` at the
`REASON_INVALID` repair.

## Met

| #   | Criterion                                                                                     | Evidence                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | The inspection projection is strictly narrower than the kernel read                           | `projectDurableRunInspection` and `projectDurableEffectInspection`; result becomes presence, length and digest, receipt becomes presence |
| 5   | The prescribed red test fails first, then passes                                              | falsified twice — once structurally, once materially with a Policy-governed body a `member` caller's Query omits                         |
| 11  | Internal protocol v5 adds the bounded reason                                                  | nullable column, CHECK, v4→v5 upgrade verified end to end on PostgreSQL 17                                                               |
| 12  | `REASON_INVALID` and `AUTHORITY_DENIED` are typed, enforced before the statement, and audited | both reachable and driven; the first was unreachable until the repair that produced this record                                          |

## Not met, and why

| #   | Criterion                                                     | State                                                                                                                                                          |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Inspection Authority is evaluated                             | **unbuildable.** A Query has no admission Policy; operational facts are not Collection rows                                                                    |
| 2   | Maintenance Authority evaluated, typed denial, audited        | **partial.** Driven against the runtime factory; the generated application supplies no `authorize`, so it never holds for the shipped surface                  |
| 3   | Denial specificity follows the missing Authority              | **not built.** Requires 1 and 2                                                                                                                                |
| 6   | `operational-nondisclosure.json` compiled and digest-verified | **not built.** No such artifact exists                                                                                                                         |
| 7   | `relational-nondisclosure.json` joins the verified set        | **not built.** It appears zero times in `artifact-files.ts`; still compiled and consumed by nothing                                                            |
| 8   | The surface is exactly four reads plus one worklist           | **not built.** The worklist does not exist                                                                                                                     |
| 9   | The worklist is bounded and index-backed                      | **not built.** Requires 8                                                                                                                                      |
| 10  | Every rendered fact carries its source                        | **not built.** The interface renders a catalog and no provenance                                                                                               |
| 13  | A fenced loser receives the run's current version             | **not built.** The outcome still omits it                                                                                                                      |
| 14  | Retry is never offered as the remedy for ambiguity            | **not built.** This is an interface property and the interface has no run view                                                                                 |
| 15  | A stale build is explained                                    | **not built.** `EXECUTABLE_RETIRED` still writes nothing and nothing joins the contract to explain it                                                          |
| 16  | The Studio projection producer is independent                 | **partial.** The producer exists, derives from bytes, and a mutated byte moves its digest. Byte parity against the compiler's own artifact is **not asserted** |
| 17  | Every narrower claim is disclosed and the count matches       | **cannot be closed yet.** The claim set is still moving                                                                                                        |

## The honest count

Four of seventeen met. Two more partial. Eleven not built.

Three of the eleven are blocked on decisions that are not this slice's to make:
inspection Authority needs an ADR-0010 amendment, maintenance Authority needs
the same or an owner ruling, and the Studio asset packaging fork decides whether
the interface can be served at all.

The remaining eight are ordinary unbuilt work: the operational nondisclosure
artifact, the relational one joining the verified set, the run worklist and its
bound, provenance in the interface, the version on a fenced loser, the retry
disclosure, and the stale-build explanation.

## What this changes

`acceptance-shape.md` is not wrong; it is unmet. The criteria were written as
targets and remain the right ones. Two need restating rather than rebuilding —
criterion 1 is unbuildable as written and must either name the ADR amendment or
be dropped, and criterion 16 must say byte parity against the compiler artifact
rather than internal consistency, because the current tests prove the producer
is a function of its input and not that it agrees with anything.

No manifest is instantiated. Protocol v2 requires a reviewed head and pinned
digests, and a manifest asserting seventeen criteria while meeting four would be
the failure this slice has spent its whole length avoiding.
