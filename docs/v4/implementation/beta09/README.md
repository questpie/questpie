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

Nothing in these records is waiting on a decision.

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

## Merge hazard: the implementation branch forked before these corrections

`feat/v4-beta-09` forked from `219758a4`, before the six commits below landed on
`feat/v4`. Both sides have since edited five of the same records, so a merge
will conflict in all five, and resolving toward the branch would silently
reintroduce defects that were found and verified against the tree.

Corrections on `feat/v4` that must survive any merge:

| Commit     | What it fixed                                                        |
| ---------- | -------------------------------------------------------------------- |
| `1c26b9bc` | reconciled the set, added this index                                 |
| `c8abf9ed` | nine defects from adversarial pre-review                             |
| `83dffe36` | four more, including a flagship job that cannot execute              |
| `538c16d1` | five, including the unauditable denial                               |
| `c2b24b74` | the fair-admission mechanism note                                    |
| `8e77abe6` | measured the worklist premise; dropped two claims measurement killed |

**Verified still present on the branch at the time of writing**, each of which
would come back if the branch's copy wins:

- `maintenance-decisions.md` attributing the four-command list to ADR-0014. No
  ADR names `drainRuntime`; it appears only in the projection and Gate 8.
- `inspection-contract.md`'s eleven-field `events(runId)` row. The shipped read
  returns five, so that row specifies a projection **wider** than the kernel
  read and falsifies `acceptance-shape.md` criterion 4 by itself.
- `design-context.md`'s "thirteen decisions" and "2,283 lines", both counting
  errors.
- `maintenance-decisions.md` quoting "QUESTPIE does not claim exactly-once
  effects" as ADR-0013 text. That string is a code comment in
  `packages/runtime/src/durable/postgres-effects.ts:38`.

**The cheap fix is to rebase the branch onto current `feat/v4` now**, while the
divergence is six files, rather than resolving it at merge time when the
implementation diff is large enough to hide a documentation regression.

The branch also carries a tenth record, `authority-mechanism.md`, which has no
counterpart here. Nothing on `feat/v4` conflicts with it; it should arrive
intact.
