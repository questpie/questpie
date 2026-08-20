# BETA-09 implementation records

Entry point for BETA-09 (#296), "Inspect the connected tracer through minimal
Studio." These records decide the slice before it is built. None of them opens
a slice branch, and none changes an ADR, a public projection, a gate, or
tracker state; those projections move only after the acceptance protocol
returns `PASS`.

Base for every record: `feat/v4` at
`8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## Reading order

1. **[design-context.md](./design-context.md)** — the boundary against BETA-08,
   the identities, what changed underneath the Studio research, and the
   evidence discipline. Start here.
2. **[studio-purpose.md](./studio-purpose.md)** — what Studio is for, decided
   by adversarial review. "Explain, then act": identity-first address space,
   decision-first destinations, one bounded run worklist as a panel.
3. **[inspection-contract.md](./inspection-contract.md)** — what the inspection
   Operations return, the disclosure finding in the shipped reads, and how the
   red test is driven and falsified.
4. **[maintenance-decisions.md](./maintenance-decisions.md)** — the reason
   contract, read versus maintenance Authority, retry safety, fence conflict
   disclosure, `drainRuntime`, and the design-system gap.
5. **[internal-protocol-v5.md](./internal-protocol-v5.md)** — the one schema
   change this slice owns, and the two edges that decide its shape.
6. **[freshness-and-provenance.md](./freshness-and-provenance.md)** — why the
   freshness tile cannot be built honestly, and what replaces it.
7. **[hostile-cases.md](./hostile-cases.md)** — the six hostile cases and the
   assertion each must fail on before it passes.
8. **[acceptance-shape.md](./acceptance-shape.md)** — the protocol v2 manifest
   shape and the acceptance criteria.
9. **[owner-decisions.md](./owner-decisions.md)** — the three decisions
   autonomous work could not settle, now answered, and the one consequence they
   share: the operator surface has no wire transport.

## What this slice decided

- **Three gaps against the accepted maintenance contract**, not the one BETA-08
  disclosed. Maintenance Authority is unevaluated; `drainRuntime` exists in the
  contract and not in the code; and the bounded reason has nowhere to live,
  which no BETA-08 review round surfaced.
- **The prescribed red test already passes on the shipped surface.**
  `inspect()` returns the Reaction result unfiltered and `effects()` returns
  the provider receipt raw. Both become presence rather than bytes.
- **`relational-nondisclosure.json` is byte-verified but never read.** It is in
  the build inventory, so startup fails if its bytes are tampered with — but no
  code consults its commitments. The operational lane gets an equivalent
  artifact; the relational one needs a reader, not a digest.
- **`drainRuntime` corrects the projection, not the code.** Its seven required
  properties are run-scoped and cannot apply to a process.
- **No global freshness header.** Per-answer provenance instead, because four
  of the handoff's five sources cannot honestly populate a staleness figure.
- **Purpose is job-first, address space is identity-first.** The operational
  lane has exactly one durable symptom source, so a symptom-first entrance
  would be a filtered view of one table.

## Records this slice corrects in place

Concurrent work ticks wrote these documents in parallel, and several findings
landed after the records they contradict. Rather than leave both versions
standing, the earlier record is corrected and points at the later authority:

- `design-context.md` no longer claims BETA-07 made Live Query reset history
  observable, and no longer claims keying durable views on Tenant is free —
  `tenant_id` is in no index.
- `maintenance-decisions.md` defers the v5 column shape to
  `internal-protocol-v5.md`, which shows the nullability is forced, and records
  that the rejection union gains two members rather than one.
- `inspection-contract.md` is itself a merge of two ticks that reached the same
  file; `freshness-and-provenance.md` absorbed a second freshness record
  written under a different name.

## Status

Nothing in these records is waiting on a decision. Three that were waiting are
answered in [owner-decisions.md](./owner-decisions.md), which also records the
finding those answers exposed: the operational reads and commands are in-process
methods on the compiled application and no route carries them to a browser, so
what this slice has built is a contract browser rather than an operational
control surface. Packaging cannot be settled before that transport is.

Implementation has begun on branch `feat/v4-beta-09`, worktree
`/home/drepkovsky/code/questpie-v4-beta-09`, which is not merged to `feat/v4`.
These records describe decisions; that branch carries the code and its tests.
Where the two disagree, the branch is the evidence and the record is corrected
— that already happened once, when the events projection here was found to
describe what `durable_run_events` stores rather than what `events()` returns.

What the branch still owes:

- The maintenance Authority evaluation itself.
- The `operational-nondisclosure.json` producer and the runtime verification
  that `relational-nondisclosure.json` joins.
- Internal protocol v5, and the local-database consequence that
  `ensureInternalProtocol` refuses a same-version different-checksum install.
- The Studio bundle, on the shadcn and Base UI primitives already in
  `apps/docs`, whose gaps `maintenance-decisions.md` names.
- A transport for the operator surface. The reads and commands exist and are
  tested; nothing carries them to a browser. See
  [owner-decisions.md](./owner-decisions.md).

## Merge hazard: largely resolved, and this note was stale

**`feat/v4-beta-09` has merged `feat/v4`.** The merge is `5066187a`, and the
merge base has advanced from `219758a4` to **`4078c057`**, leaving only seven
`feat/v4` commits unmerged at the time of writing.

Every defect this section previously warned about is gone from the branch,
verified rather than assumed: the four-command list attributed to ADR-0014 and
the exactly-once sentence quoted as ADR text both return **zero** hits. Two
patterns still match — "thirteen decisions" and the eleven-field events list —
but both are inside the _retraction_ text the merge carried over, which is what
the retracted-claim sweep recorded in this file predicts.

**An earlier version of this section is preserved in history rather than
restated.** It said the branch forked at `219758a4` and still carried four named
regressions, and it advised rebasing "while it is small". All of that was true
when written and none of it is now. A stale warning is worse than no warning: it
directs a merger's attention at defects that have already been resolved, and its
confidence is indistinguishable from a live one.

**What actually remains.** Seven `feat/v4` commits are unmerged, all of them
documentation corrections made after `4078c057` — including two that fix figures
this record set itself got wrong. The branch also carries five records with no
counterpart here (`acceptance-reconciliation.md`, `authority-mechanism.md`,
`narrower-claims.md`, `postgres-matrix.md`, `studio-interface.md`), which nothing
on `feat/v4` conflicts with. The useful action is no longer a rebase; it is a
second merge when those seven land.

## Implementation reconciliation

Checked read-only against `feat/v4-beta-09` at `b05bcbe7`. The branch is
implementing the decisions in this record set, and on the two checkable points
it matches them exactly rather than drifting.

- **D4, the projection narrower than the kernel read: built.**
  `packages/runtime/src/durable/inspection.ts` exposes
  `result: { present, bytes, digest }` and `receiptPresent: boolean` — presence,
  length and digest for the result, presence for the receipt, exactly as
  `inspection-contract.md` D4 decided. Its own comment reproduces the reasoning,
  including why the kernel keeps `resultBytes` while nothing Studio reaches
  returns it.
- **D1, the operational nondisclosure commitments: built.** The branch adds
  `tests/unit/beta09-operational-nondisclosure.test.ts` pinning absence and
  denial as indistinguishable and no count oracle.
- **D3, four reads plus one worklist: built.** An earlier revision of this
  section, written one tick earlier, said the worklist did not exist. It does, at
  `packages/runtime/src/durable/worklist.ts`, exported as `readDurableWorklist`.
  This note went stale inside a tick, which is worth recording rather than
  quietly overwriting.

It matches every constraint the decision set: it carries identities and codes and
nothing that could hold a result, its `hasMore` is found by reading one row past
the bound rather than by counting, its `first` is clamped to 100, it returns
`tenantId` for display, and its `WHERE application_name = $1 AND state = $2 ORDER
BY available_at, run_id` is exactly the prefix scan measured here at 0.13 ms
against 207,000 runs.

It also adds a reason the decision set did not have: the worklist is deliberately
**not** on `DurableKernel`, because the kernel is the claim, lease, fence and
transition state machine while this is an operator read that changes for
different reasons. That split was found by the architecture gate rather than
designed, which is a better provenance than a preference.

**One divergence, small and worth fixing at the source.** Its `hasMore` comment
gives two justifications — that a count is a scan, and that a total is an
existence oracle. Measurement killed the first: a count over the same indexed
predicate is an Index Only Scan at 0.47 ms for 2,000 failed runs, recorded in
`studio-purpose.md`. Only the disclosure reason survives, and it is sufficient on
its own. Two justifications where one is false is worse than one that holds,
because a reviewer who knocks over the weak one has grounds to doubt the
decision.

## A projection landed ahead of acceptance

Recorded because it is checkable and because a reviewer will check it.

`f092d618` added an **Operational Fact** entry to `CONTEXT.md`. Three facts,
each verified:

- The term appears in **no Accepted ADR and no public projection under
  `docs/v4/`**. It is new vocabulary, not a glossary catching up to something
  already frozen.
- The design branch is explicit: "Project ADR, **terms**, public docs, gates,
  and tracker state only after the proof branch's acceptance protocol returns
  `PASS`" (`.agents/skills/questpie-v4/references/design.md:17`).
- **BETA-09 has never been reviewed.** This directory contains no review record
  of any kind, so no `PASS` exists to have unlocked the projection.

So a term was projected before the gate that governs terms. The glossary edit
itself is defensible on its merits — the operational lane genuinely needed a
name, and this record set spent several documents talking around the absence of
one — but the ordering is what the rule constrains, and the rule was written
because a term that ships before its slice is accepted becomes authority nothing
reviewed.

**Not decided here, because it is not this record's to decide.** Either the
glossary entry is reverted until BETA-09 returns `PASS`, or the slice records
an explicit, argued exception. What must not happen is that it sits unremarked
and is later cited as accepted vocabulary on the strength of being in
`CONTEXT.md`.

### One attribution a reviewer must confirm

`owner-decisions.md` and its commit message state that "the owner answered all
three questions." That attribution cannot be verified from this repository, and
it is load-bearing: three decisions in that record rest on owner authority
rather than on evidence, and a reviewer reading them will treat them as settled
input rather than as autonomous judgment.

Two of the three are also grounded independently in the record — D1 in
`ADR-0010:41` and `CONTEXT.md:405`, D2 in `CONTEXT.md:400`–`:403` — so their
substance stands on citations regardless of who chose them. The attribution
still needs confirming before the record goes to review, because a decision
credited to an absent owner is worse than the same decision recorded honestly as
a judgment call with its reasoning attached.

## What is reachable, as distinct from what is built

Three findings in this set converge on one status that none of them states, and
a reader assessing the slice's four required artifacts needs it in one place.

- The Fetch router contains **no reference to `durable`**, verified on `feat/v4`.
- The Studio mount on `feat/v4-beta-09` serves a read-only asset surface at
  `/_questpie/studio` and says so in its own comment: "no Operation, no durable
  read, and no application data."
- `owner-decisions.md` D3 records that packaging **cannot be answered yet**, for
  exactly this reason.

So the same-origin Studio bundle — required artifact 2 — **exists and reaches
nothing operational**. The shell is served, the inspection projections are
built, the nondisclosure commitments are pinned, and there is no path by which
Studio obtains an Operational Fact.

**This is not a criticism of the mount**, which is deliberately scoped and
argues its separation well: disclosure is decided by what Studio may call, not
by how its bytes arrive, which keeps the nondisclosure contract in one place.
The gap is that the calling half does not exist yet.

**Why it matters for assessment rather than for blame.** Four of this slice's
required artifacts can be demonstrated in isolation and three of them are —
the projection producer, the inspection reads, the safe views. A reviewer
counting artifacts will find the bundle present. A reviewer asking whether the
slice's fixture is _demoable end to end_, which is its own acceptance
criterion, will not, and the honest answer is that it is not yet, for one
nameable reason.

The same reason expires the Q3 qualifier in `maintenance-decisions.md`, unblocks
D3, and makes the maintenance Authority hostile case fully drivable. One route
closes four open items, which is worth knowing when deciding what to build
next.

## How this set was verified

Three sections of working notes stood here and were compressed once the checks
they narrated had all come back. What they established, kept because a reviewer
can re-run any of it:

- **The branch plan and this set's constraints agree.** At `0181e2a4` no durable
  operation is marked `network: true`, and `studio-interface.md` fetches the
  static artifacts path rather than a durable read. Nothing has to be undone
  when a durable route eventually lands.
- **Citations were audited mechanically.** 131 `file:line` citations checked for
  existence and range; 125 resolved and six did not, all one defect — a
  branch-only path cited as though it were on `feat/v4`, since the packet builder
  reads `git show <reviewedHead>:<path>`. All six now carry the
  `feat/v4-beta-09:` prefix. Twenty load-bearing code citations and four doc
  citations were then checked for **content**, not just range. Zero mismatches.
- **Every retracted claim was searched for across the whole set**, after one
  correction was found applied in the place it was noticed and not where the
  claim was first written. Each retracted figure now appears only inside its own
  retraction.

The reusable part is the method, not the results. Reading finds candidates and
settles nothing: a claim about whether something is _enforced_ needs the thing
broken and the failure asserted, and a claim that something was _corrected_ needs
a search rather than a re-read.
