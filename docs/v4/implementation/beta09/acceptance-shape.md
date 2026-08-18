# BETA-09: the acceptance manifest shape and its criteria

The manifest itself cannot be written yet. Protocol v2 requires a `diffBase`, a
reviewed head, and pinned `sha256` digests of every authority document, and
those exist only once an implementation branch does. What can be fixed now is
the shape and the criteria, so the implementing slice instantiates rather than
invents them.

BETA-08's manifest is the model: exactly nine keys, 16 criteria, 10 verification
entries, 10 authority documents
(`docs/v4/implementation/beta08/acceptance-manifest.json`).

This record decides. It opens no slice branch and writes no production code.

**Scope note.** Implementation for this slice lives on branch
`feat/v4-beta-09` (worktree `/home/drepkovsky/code/questpie-v4-beta-09`), which
is not merged to `feat/v4`. The commit carrying this record touches only
`docs/`; the branch is where the code and its tests are. Where the two
disagree, the branch is the evidence.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## The nine keys, and what BETA-09 puts in each

`acceptanceCriteria`, `authorityDocuments`, `authorityHeads`, `diffBase`,
`proof`, `protocolVersion`, `reviewOutput`, `ticket`, `verification`. Exactly
these — the validator rejects any other set.

- **`protocolVersion`** `2`. **`ticket`** `#296`.
- **`diffBase`** the accepted `feat/v4` head the slice branches from.
- **`authorityHeads`** must be **ancestors of the reviewed head**. BETA-08 hit
  this: heads that are not ancestors fail the packet build. Include the
  accepted base and the BETA-08 evidence head
  `78e81b67dfc41f612b0b36cf4cf5e0bafb0995ce`, since this slice's boundary is
  defined against it.
- **`authorityDocuments`** ADR-0003, ADR-0014, ADR-0021,
  `docs/v4/implementation-gates.md`,
  `docs/v4/runtime-client-envelope-and-studio.md`, and **every BETA-09 design
  record in this directory**. At the time of writing that is nine files, the
  eight `README.md` enumerates plus `README.md` itself; an earlier revision said
  seven, which predated two of them. Pin the list by enumerating the directory
  at manifest time rather than by carrying a count, and give each a `sha256`.
- **`reviewOutput`** the round's record path. Preserve every review record
  byte-identically and add each to `quality/format-baseline.txt`.
- **`proof`** one paragraph: what the slice demonstrates end to end.
- **`verification`** every gate command with its result, including the
  PostgreSQL matrix and the pinned tsc gate over changed test files.

## The criteria

Each is falsifiable and each maps to a decision already recorded. The record
that owns it is named, so a reviewer can check the criterion against the
reasoning rather than against the prose.

1. **Inspection Authority is evaluated, not assumed.** Every operational read
   evaluates an inspection Authority decision; a caller without it receives the
   same value a missing run produces. Falsifiable: today no read evaluates
   anything. → `maintenance-decisions.md` Q3, `inspection-contract.md` D3.
2. **Maintenance Authority is evaluated and distinct.** Holding inspection
   Authority does not confer it. A caller lacking it is refused with a typed
   `AUTHORITY_DENIED`, and the attempt is recorded in the append-only audit.
   Falsifiable: `actorOf` today checks only a brand
   (`packages/runtime/src/durable/postgres-maintenance.ts:130`). →
   `maintenance-decisions.md` Q3, `hostile-cases.md` case 5.
3. **Denial specificity follows the missing Authority.** A caller without
   inspection Authority cannot distinguish denial from absence; a caller with
   inspection but not maintenance Authority receives a specific denial. →
   `maintenance-decisions.md` Q3.
4. **The inspection projection is strictly narrower than the kernel read.**
   Nothing Studio can reach returns `result_bytes` or a raw provider receipt.
   Result is presence, length, and digest; receipt is presence. Falsifiable:
   `inspect(runId)` returns `result_bytes` unfiltered today. →
   `inspection-contract.md`.
5. **The prescribed red test fails first, then passes.** A caller denied the
   equivalent generated Operation for a Message learns nothing about it —
   body, or existence — through any operational read for a run that touched it.
   The failing assertion against unrepaired code is recorded. →
   `hostile-cases.md` cases 1 and the red test.
6. **`operational-nondisclosure.json` is compiled and digest-verified**, and
   asserts the absence of result and receipt explicitly, so a later widening is
   a visible diff in a digested artifact. → `inspection-contract.md` D1.
7. **`relational-nondisclosure.json` joins the verified set.** It is compiled
   today, byte-verified through the build inventory, and read by nothing. →
   `inspection-contract.md` D2.
8. **The surface is exactly four reads plus one worklist.** No additional read
   shapes, no raw SQL, no internal-table CRUD. → `inspection-contract.md` D3.
9. **The worklist is bounded and index-backed.** Keyed on
   `(application_name, state)` against the existing `durable_runs_claim_idx`,
   returning first-N with `hasMore` and never a count, and disclosing no run the
   caller could not `inspect` individually. → `studio-purpose.md`,
   `inspection-contract.md` D1.
10. **Every rendered fact carries its source**, and a fact with no source is not
    rendered. Absence is stated rather than drawn as an empty list. There is no
    global freshness header. → `freshness-and-provenance.md`.
11. **Internal protocol v5 adds the bounded reason.** Nullable column, CHECK
    bounding non-null to 1–256, required by the runtime on all three commands,
    upgrading from v4 in one pinned transaction with its own catalog
    verification. → `internal-protocol-v5.md`.
12. **`REASON_INVALID` and `AUTHORITY_DENIED` are typed rejections**, admitted
    by the CHECK, enforced before the statement rather than surfacing as a raw
    PostgreSQL error, and audited — the first with a null reason, because there
    is no valid reason to record. → `internal-protocol-v5.md`.
13. **A fenced loser receives the run's current version.** Two concurrent
    commands elect one winner through Studio's surface, and the loser can
    re-issue without a second `inspect()`. Falsifiable: the outcome does not
    return the version today. → `maintenance-decisions.md` Q14,
    `hostile-cases.md` case 6.
14. **Retry is never offered as the remedy for ambiguity**, and retry copy
    states that no exactly-once guarantee is created. →
    `maintenance-decisions.md` Q12.
15. **A stale build is explained.** A run pinned to a retired executable digest
    is not presented as healthy. Falsifiable: `EXECUTABLE_RETIRED` writes
    nothing, so the history says only `accepted`. → `hostile-cases.md` case 4.
16. **The Studio projection producer is independent.** Given the same compiled
    input it emits bytes identical to the compiler's artifact, and mutating the
    artifact bytes alone makes the parity test fail. → `hostile-cases.md`
    case 3.
17. **The slice discloses every claim narrower than the accepted contract**,
    and the count in the record matches the count in the recitation. BETA-08's
    fourth round caught a recitation saying five where the record carried nine.

## The narrower claims this slice already owes

Fixed now so the implementing slice does not have to rediscover them:

- **`questpie explain` is not built.** Accepted authority names it in ADR-0014,
  ADR-0019, and `docs/v4/implementation-gates.md`. The byte-parity hostile case
  is reframed onto the two producers that exist.
- **`drainRuntime` is corrected in the projection, not implemented as a
  command.** The accepted list of four becomes three.
- **The Execution Envelope has no store**, so no Execution history lane exists
  and its absence is stated rather than drawn.
- **The receipt lane is unreachable.** `mutation_call_receipts.committed_at` is
  durable and never pruned, and no public read exists.
- **Live Query reset history is not retained.**
- **The maintenance audit is not globally listable** at acceptable cost;
  `run_id` precedes `requested_at` in its index.
- **The redacted-envelope hostile case is structurally satisfied already** and
  is the weakest of the six.

## Judgment call

Seventeen criteria against BETA-08's sixteen, with criterion 3 (denial
specificity) the one most likely to be judged as belonging inside criterion 1.

I am keeping it separate because it is the criterion most likely to be
implemented wrongly in a way that still passes criterion 1 — a uniformly
generic denial satisfies "Authority is evaluated" while being needlessly
hostile to an authorized reader, and a uniformly specific one leaks existence.
Merging them hides that tension. What would overturn it: a reviewer judging the
manifest padded, in which case 3 folds into 1 and the tension moves into
criterion 1's wording.

## The criteria this record was missing

Issue #296 carries a Budgets block and a Performance ownership block that no
criterion above mapped. An acceptance manifest that omits the ticket's own
budget contract is the failure this record exists to prevent, so they are added
here rather than left to the implementing slice to rediscover.

18. **The changed loop stays under 5 s**, measured rather than asserted.
    BETA-08's round 4 observed this budget had gone two slices without a
    recorded measurement; this slice either measures it or stops carrying it.
19. **Studio build-size and query-latency baselines are recorded**, with each
    budget derived mechanically as `ceil(observed × multiplier / quantum) ×
quantum` and the derivation asserted in-test, the way BETA-08's were.
20. **No secret or raw-payload snapshot enters any baseline or golden.** This is
    the performance-evidence counterpart of the disclosure decision: a
    build-size or latency artifact must not embed a result body or a receipt.
21. **The same-origin Studio bundle exists and matches the accepted contract** —
    one of the issue's own acceptance criteria, previously unmapped.
22. **The slice is independently demoable through its stated fixture** — the
    other previously unmapped issue criterion.

The performance manifests this slice owns are the Studio build-size and query
baseline measurement manifest, and the BETA-09 stable-runner budget report.
Both are named by the issue's Performance ownership block.
