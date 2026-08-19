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
- **`authorityDocuments` digests are read at the reviewed head**, not at `HEAD`
  or from the working tree. The builder runs
  `git show <reviewedHead>:<path>` and fails on
  `authority document digest mismatch`
  (`.agents/skills/questpie-v4/scripts/acceptance-review-packet.ts:224`–`:231`).

  **This is what makes repinning unavoidable, and BETA-08 paid it three times** —
  `8f538203`, `baea3450`, and `d0aedd54` are all "repin the acceptance manifest".
  Any commit that touches a pinned document after the digests are computed
  invalidates them, including a commit that only repairs a record. Compute
  digests last, and treat the manifest commit as the reviewed head. Every entry
  must also be exactly `{name, path, sha256}` with a 64-hex digest and a unique
  path.

- **The packet is scanned for secrets**, both every authority document and the
  manifest itself, and a match fails the build — `database URL` and
  `credential assignment` are the guarded classes
  (`acceptance-packet-secrets.ts:77`, `:93`). A local PostgreSQL URL is
  permitted; anything else in that shape is not. Worth knowing before pinning a
  document that quotes a connection string as an example.
- **`reviewOutput`** the round's record path. Preserve every review record
  byte-identically and add each to `quality/format-baseline.txt`. **The path
  must not already exist** — `requireAbsentReviewOutput` runs before the
  transport (`.agents/skills/questpie-v4/scripts/acceptance-review.ts:104`), so a
  round cannot be re-run into an occupied path. That is why BETA-08 carries four
  differently named records for four rounds:
  `claude-initial-review.json`, `claude-review-02.json`, `claude-review-03.json`,
  and `REVIEW-04.json`. Each repaired head needs a **fresh** `reviewOutput` path
  as well as recomputed document digests, and the two are easy to remember
  separately and forget together.

### The dry run is free and validates everything

`--dry-run` runs the whole path — manifest decode, ancestry, document digests,
secret scan, verification semantics, and the review-output absence check — then
prints the packet summary and exits **before any model call**
(`acceptance-review.ts:114`–`:126`). Every rule in this section fails there
rather than in a review round.

That is worth stating plainly because knowing the rules has not been enough.
BETA-08 knew the digest rule and repinned three times anyway, because each
repair arrived after the digests were computed. The sequence that actually pays
is: repair, then compute digests, then commit, then dry run, and only then spend
the call.

- **`verification`** every entry must be exactly `{command, result}` and
  **`result` must be `"PASS"`**. The validator rejects the whole manifest
  otherwise — `every verification entry must be PASS`
  (`.agents/skills/questpie-v4/scripts/acceptance-review-packet.ts:137`–`:145`),
  and it fails the packet build, before any model call.

  **This is a trap for this slice specifically.** A lane that is pending cannot
  be recorded here at all. BETA-08's round 4 observed exactly this shape — both
  CI lanes sat at `PENDING_CI` in its baselines while the manifest said nothing
  about the Gate 10 selected-PR and nightly lanes being unmet — and BETA-09 owns
  a Studio build-size and query-latency baseline plus a stable-runner budget
  report, which are the lanes most likely to be incomplete when the manifest is
  first written.

  So a lane that has not passed is not a verification entry with a different
  result; it is **not a verification entry**, and it belongs in the narrower
  claims instead, named as unmet. Omitting it silently is what a reviewer
  finds.

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
   **Criteria 1, 2 and 3 carry a reachability caveat, verified after they were
   written.** `packages/runtime/src/application/index.ts` contains no reference to
   `durable`, so the Fetch router exposes no durable route and the operational
   surface is in-process only. Every demonstration of these three therefore runs as
   host code that **supplies its own `Principal`**. That proves the decision is
   evaluated, the denial is typed, and the audit records the attempt. It cannot
   prove the property the criteria exist for — that a caller who should not pass
   does not — because the only caller is trusted by construction and could equally
   have asserted an Authority that passes.

This is stated here rather than left for a reviewer to find, because a criterion
demonstrated by a weaker case than it claims is what previous rounds blocked on.
The evidence for these three should say plainly which half it proves. See the
qualifier in `maintenance-decisions.md`; the caveat expires the moment a durable
route exists.

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

- **The maintenance commands cannot reach the wire in this slice, and the reason
  is outside it.** Exposure is binary — `network: true` puts an Operation in the
  generated browser client (`packages/compiler/src/model.ts:264`,
  `packages/compiler/src/runtime/client.ts:55`) — and BETA-08's accepted
  criterion 13 forbids a durable control plane there. The two alternatives are
  both unbuilt: a Route has a generated factory and no dispatch, mounting, or
  `routes` projection, which ADR-0014:32 assigns to ADR-0015's slice; and a
  third exposure state is new authoring surface for an ADR. See
  `docs/v4/prototypes/durable-evidence-gaps/ROUTE-SHAPE.md` and
  `docs/v4/prototypes/authority-contract-gap/AUTHORED-VS-BUILT.md`.

  **So this slice should scope the command half as deferred and name the owner,
  rather than carry criteria it cannot satisfy.** The inspection _reads_ are
  unaffected — Queries are wired, so they work over the wire today with
  handler-evaluated Authority. Only the commands are blocked, and no accepted
  slice currently owns the unblocking work. A criterion asserting a
  wire-reachable command would be false at acceptance for a reason no repair
  inside BETA-09 can close.

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
- **The maintenance audit is answerable per run, not as a global time-ordered
  feed.** `run_id` precedes `requested_at` in
  `durable_maintenance_commands_run_idx` (`internal-protocol-v4-sql.ts:246`), so
  a global `ORDER BY requested_at DESC` cannot use the index and plans as a
  sequential scan. An earlier revision of this entry said "not globally listable
  at acceptable cost"; measurement disproved the cost half — 31.8 ms over 200,000
  rows is usable. The accurate disclosure is that the cost is **linear in audit
  size and nothing prunes the audit** (no retention sweeper exists against any
  `durable_*` table), so it grows without bound, while one
  `(application_name, requested_at DESC)` index removes it at 0.072 ms.
  Measured in `studio-purpose.md`.
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

**Four of these five sit outside the branch's status derivation, and that is
worth knowing before a manifest is written.** `feat/v4-beta-09` re-derived
criteria status at `cdd5193c`, finding fourteen of **seventeen** met with three
carrying the Q3 qualifier. Both copies of this file hold twenty-two criteria —
seventeen in the section above and these five.

**Criterion 18 is covered, in a different file.** The branch's
`narrower-claims.md:107` records "Criterion 18 is now measured: 255 ms against a
5,000 ms budget", so the changed loop is tied to its criterion. An earlier
revision of this section said the branch was silent on 18 through 22; it was
silent on **19 through 22**, and I had read only the reconciliation record before
concluding about the whole branch. Criteria status is spread across at least
`acceptance-reconciliation.md` and `narrower-claims.md`, so neither file alone
answers what is covered.

Some of the evidence already exists on that branch, though **not at the figures
its commit message gives, and an earlier revision of this section repeated them
unverified.** The committed baseline
(`feat/v4-beta-09:quality/baselines/beta09-studio-projection.json`) records
`observed.studioBundleBytes` **243,941** against a 327,680 budget, and
`observed.worklistMedianMs` **0.167** from samples `[0.142, 0.167, 0.255]`
against a 5 ms budget — not 245,540 and 0.151. Both still pass their budgets
comfortably, so the conclusion is unchanged and only the numbers were wrong.

That is most of what criterion 19 asks for. What is missing is the derivation
tying that evidence to these criteria, plus the 5 s changed-loop measurement in
its flagged form (see `design-context.md`) and an explicit statement for criteria
20, 21 and 22.

A count a reviewer checks first should not have two answers depending on which
section they read.
