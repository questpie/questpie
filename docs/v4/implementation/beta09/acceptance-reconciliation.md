# BETA-09: the seventeen criteria against what shipped

`acceptance-shape.md` fixed seventeen criteria before implementation. This
checks each one against the tree. It is written because the slice is not close
to acceptance and saying so precisely is worth more than saying so vaguely.

Verified by reading the tree, not from memory. Base: `feat/v4-beta-09` at the
`REASON_INVALID` repair.

## Met

| #   | Criterion                                                                                     | Evidence                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4   | The inspection projection is strictly narrower than the kernel read                           | `projectDurableRunInspection` and `projectDurableEffectInspection`; result becomes presence, length and digest, receipt becomes presence                           |
| 5   | The prescribed red test fails first, then passes                                              | falsified twice — once structurally, once materially with a Policy-governed body a `member` caller's Query omits                                                   |
| 11  | Internal protocol v5 adds the bounded reason                                                  | nullable column, CHECK, v4→v5 upgrade verified end to end on PostgreSQL 17                                                                                         |
| 12  | `REASON_INVALID` and `AUTHORITY_DENIED` are typed, enforced before the statement, and audited | both reachable and driven; the first was unreachable until the repair that produced this record                                                                    |
| 13  | A fenced loser receives the run's current version                                             | `version` on every outcome, read after the command settles so an applied command reports the number that exists now                                                |
| 17  | Every narrower claim is disclosed and the count matches                                       | `narrower-claims.md` carries fourteen, grouped by who owns the remainder, and states the count the recitation must match                                           |
| 6   | An operational nondisclosure commitment is compiled and digest-verified                       | pinned inside `durable-kernel.json`, which is already compiled, digested and semantically verified; a separate constant artifact would have been ceremony          |
| 8   | The surface is exactly four reads plus one worklist                                           | `worklist({state, first})` on the kernel and the published surface; no other read shape added                                                                      |
| 9   | The worklist is bounded and index-backed                                                      | bounded 1–100, ordered `available_at, run_id` against `durable_runs_claim_idx`, `hasMore` from one row past the bound and never a total                            |
| 7   | `relational-nondisclosure.json` joins the verified set                                        | already met, and the reconciliation was wrong about it. Verification walks the whole inventory rather than a name list, so tampering with one character is refused |
| 15  | A stale build is explained                                                                    | `explainRunExecutable` joins a run's pinned digest against the reaction projection; driven against a really-retired run whose history says only `accepted`         |

## Not met, and why

| #   | Criterion                                              | State                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Inspection Authority is evaluated                      | **blocked, and the recorded reason is stale.** Not an ADR-0010 amendment: `owner-decisions.md` D1 settled that operational facts get an operator surface carrying its own Authority. It is blocked on that surface having no transport |
| 2   | Maintenance Authority evaluated, typed denial, audited | **partial.** Driven against the runtime factory; the generated application supplies no `authorize`, so it never holds for the shipped surface                                                                                          |
| 3   | Denial specificity follows the missing Authority       | **not built.** Requires 1 and 2                                                                                                                                                                                                        |
| 10  | Every rendered fact carries its source                 | **partial.** Every contract fact now carries `source: artifact` and the artifact that declared it, in the producer and in the rendering. The Runtime Build identity the record also asks for is not servable — see below               |
| 14  | Retry is never offered as the remedy for ambiguity     | **not built.** This is an interface property and the interface has no run view                                                                                                                                                         |
| 16  | The Studio projection producer is independent          | **partial.** The producer exists, derives from bytes, and a mutated byte moves its digest. Byte parity against the compiler's own artifact is **not asserted**                                                                         |

## The honest count

Eleven of seventeen met. Two more partial. Four not built.

Three of the eleven are blocked on decisions that are not this slice's to make:
inspection Authority needs an ADR-0010 amendment, maintenance Authority needs
the same or an owner ruling, and the Studio asset packaging fork decides whether
the interface can be served at all.

Nothing ordinary remains. All four are behind one of the four prohibitions in
`narrower-claims.md` or behind the packaging fork.

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

## A correction this reconciliation earned

Criterion 7 was recorded as not built on the strength of a grep: the artifact is
named nowhere in `artifact-files.ts`. That was reading for a name instead of
reading the code. `verifyRuntimeArtifactFiles` walks `build.inventory` and
refuses any file whose sha256 does not match, so coverage is a property of being
in the build rather than of being mentioned.

Settled by tampering rather than by reading a second time, since reading was the
mistake. The artifact is verified and unconsumed — checked for integrity, and
read by nothing — which is a weaker and different problem than being unverified.

## Criterion 10, and the half of it that is not servable

`freshness-and-provenance.md` asks a contract fact to carry two things: the
source that produced it, and the Runtime Build identity — "not a timestamp,
because the identity is the stronger statement".

The first half is built. Every fact in `projectStudioCatalog` and
`projectStudioExplain` carries `provenance: { source: "artifact", artifact }`,
naming the file it was read from, and the interface renders it — per resource
group, and per counted fact in the header, which is the one place the view joins
three artifacts into a single line.

Provenance sits on the fact rather than on the catalog deliberately. Studio
lifts facts out of the catalog into detail views, so container-level provenance
would satisfy the criterion as written and lose the property it exists for.

**The second half cannot be served at this base.** The Runtime Build identity is
`runtime-build.json`'s `digest`, and that artifact is not in
`studioArtifactAllowListed` — for a reason that survives inspection. It carries
`bundleExport`, and `beta09-inspection-nondisclosure.test.ts` asserts the served
payload contains no such string. Adding the artifact to the allow-list would
serve the executable inventory to any browser that can reach Studio, defeating
a guard this slice wrote on purpose.

So the identity needs a narrowed projection of `runtime-build.json` — digest and
compiler identity, without `inventory`, `slots` or `executableSlots` — either as
a new compiled artifact or as a narrowing in the mount. That is a real, small,
well-scoped piece of work, and it is **not** blocked by the transport question:
it is contract metadata on the path Studio already fetches.

It is left undone here rather than guessed at, because which of the two shapes
is right depends on whether the operator surface arrives as Operations, and that
is the open question in `owner-decisions.md`. A narrowing in the mount is wasted
if the artifact set is about to gain a served projection anyway.
