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

## Scope marker: several of these criteria are now non-goals

`65643c1c` re-scoped BETA-09 through
`docs/adr/0024-descope-minimal-studio-from-beta-one.md` (`Status: Accepted`).
`QUEUE.json` now lists as `nonGoals`: "Studio UI or browser mount", "durable
inspection read model", "failed-run worklist", and "ambient Admin/System
authority". This list was written before that and is left intact; the marker
says which entries survive it.

| Criterion                                                                 | Under the re-scope                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1 inspection Authority, 4 inspection projection                           | out — "durable inspection read model"                                  |
| 3 denial specificity                                                      | **split** — its inspection clause is out, its maintenance clause is in |
| 8 four reads plus one worklist, 9 bounded worklist                        | out — "failed-run worklist"                                            |
| 16 Studio projection producer, 19 Studio baselines, 21 same-origin bundle | out — "Studio UI or browser mount"                                     |
| 2 maintenance Authority, 11–14 protocol v5 and typed denial               | in — these are the re-scoped slice                                     |

Criterion 3's split is not a tidy-up: its two clauses were already shown to sit
on opposite blockers, and the re-scope keeps exactly the maintenance one.

**Read the out entries as design history.** They record how an inspection
surface would have been authorized and bounded, which is what a later release
reintroducing one will need. They are not acceptance criteria for BETA-09 as it
now stands, and building against them would build the slice's own non-goals.

## The criteria

Each is falsifiable and each maps to a decision already recorded. The record
that owns it is named, so a reviewer can check the criterion against the
reasoning rather than against the prose.

1. **Inspection Authority is evaluated, not assumed.** Every operational read
   evaluates an inspection Authority decision; a caller without it receives the
   same value a missing run produces. Falsifiable: today no read evaluates
   anything. → `maintenance-decisions.md` Q3, `inspection-contract.md` D3.

   **Prerequisite, and it is a blocker rather than a scope note.** The criterion
   states a property and is right to. Nothing available today can satisfy it for
   a read shaped as a Query: the handler is handed no Principal
   (`QueryContext` is `data` and `signal`,
   `packages/compiler/src/generate.ts:322`–`:325`); the Query cannot declare
   authorization either, since `QueryFactory` takes exactly `name`, `network?`,
   `input`, `output` and `handler` (`:377`–`:384`); and the Operation execution
   path evaluates nothing of the kind — `packages/runtime/src/operation/` holds
   six files and none references authority or policy, while the same search finds
   policy machinery in `packages/runtime/src/relational/`.

   **This is not the claim that Queries are unauthorized, and that distinction
   was sharpened after the fact.** Policy in v4 is Collection-bound, attached as
   `{ kind: "default", requiredForNormalDataAccess: true }`
   (`packages/compiler/src/relational/discovery.ts:136`) and carried in the
   compiled read plan as `policy` and `policyProgramDigest`
   (`packages/runtime/src/relational/query.ts:97`–`:98`, `:621`), so an ordinary
   Query reading Collection data through `ctx.data` **is** Policy-checked.

   The inspection reads are outside that binding, which is the whole of the
   problem. `durable_runs` is not a discovered Collection — it appears nowhere in
   `relational/discovery.ts` — and the durable read path carries no Policy
   machinery at all: the only match for `policy` under
   `packages/runtime/src/durable/` is a comment at `principal.ts:8`, against two
   files carrying it under `packages/runtime/src/relational/`.

   So passing criterion 1 requires first choosing one of the three shapes in
   `docs/v4/prototypes/durable-evidence-gaps/ROUTE-SHAPE.md` — reads as
   Mutations, a widened `QueryContext`, or the durable route. **Planning the
   slice without settling that plans a criterion that cannot be met** — and the
   fix must not be an Operation-level Policy on Query, which would duplicate a
   binding that already works for Collection data.

   **That choice has since been narrowed against accepted authority, and the
   three are not comparable in cost.** Two need an Accepted ADR amended: reads as
   Mutations would have to stop a Mutation owning the single PostgreSQL
   transaction ADR-0011:27 _requires_ it to own, and a widened `QueryContext`
   would have to let a Query's context carry more than the "generated read-only
   `ctx.data`" ADR-0011:23 specifies. The durable route needs **no amendment** —
   ADR-0015:33–:35 already gives a Route handler the Principal, so an inspection
   Authority decision is evaluable there today — and instead needs the mounting,
   Fetch dispatch and `routes` projection that ADR-0014 assigns to ADR-0015's
   slice and nobody has built.

   `ROUTE-SHAPE.md` records the recommendation and its judgment call: prefer the
   route, because unbuilt-but-specified work is a smaller commitment than
   amending a frozen contract, and the command half needs that same work
   regardless.

2. **Maintenance Authority is evaluated and distinct.** Holding inspection
   Authority does not confer it. A caller lacking it is refused with a typed
   `AUTHORITY_DENIED`, and the attempt is recorded in the append-only audit.
   Falsifiable: `actorOf` checked only a brand. → `maintenance-decisions.md` Q3,
   `hostile-cases.md` case 5.

   **Shipped and closed.** BETA-09 merged at `21e38b21`. The Authority decision
   is now `input.authorize({ actor, command, runId })`
   (`packages/runtime/src/durable/postgres-maintenance.ts:287`) — a decision
   about this actor, this command and this run, which is precisely what case 5
   said a brand could not be. `actorOf` survives at `:179` and still brand-checks,
   but it is no longer the authorization: it proves the `Principal` came from the
   application's own module, which is a separate property.

   The citation in this falsification pointed at `:130`, where `actorOf` sat
   before the slice; `:130` is now a `Promise<Result>` return type. The slice
   moved it to `:179`, which is the citation axis reopening on a code file rather
   than a document — the same decay, from an implementation landing rather than
   an edit to a record.

   **The clause `hostile-cases.md` case 5 gained is implemented with its
   reasoning attached**, which is worth recording because it was added here as a
   requirement and arrived there as an argument. `readRun` takes `locking: false`
   on the denial path, and the comment at `:141`–`:146` gives the reason: "An
   unauthorized caller must not take `FOR UPDATE` on a run it may not touch … a
   denial-of-service surface handed to exactly the caller who was refused."
   **Criteria 1, 2 and 3 carry a reachability caveat, verified after they were
   written.** `packages/runtime/src/application/index.ts` contains no reference to
   `durable`, so the Fetch router exposes no durable route and the operational
   surface is in-process only. **In-process is not the same as unwired, and the
   difference is worth stating because I got it wrong once.** The generated
   application does publish the maintenance surface:
   `packages/compiler/src/runtime/application.ts:408` constructs
   `createPostgresDurableMaintenance`, and `:474`–`:476` expose `cancelRun`,
   `retryRun` and `acknowledgeAmbiguity` on `app.durable`. The BETA-08 harness
   reaches it exactly that way — `maintenance: app.durable`
   (`tests/integration/postgres/helpers/beta08-durable.ts:273`). What is absent
   is a _route_, not the wiring. Every demonstration of these three therefore runs as
   host code that **supplies its own `Principal`**. That proves the decision is
   evaluated, the denial is typed, and the audit records the attempt. It cannot
   prove the property the criteria exist for — that a caller who should not pass
   does not — because the only caller is trusted by construction and could equally
   have asserted an Authority that passes.

   **Criteria 1 and 2 are not blocked the same way, and the difference decides
   what each costs to fix.** Maintenance _has_ the Principal and lacks a route:
   `actorOf` takes one as a parameter
   (`postgres-maintenance.ts` `actorOf`, `:179` today) and merely
   brand-checks it, so criterion 2 becomes satisfiable by evaluating a value
   already in hand. Inspection is the mirror — the reads are wire-reachable as
   Queries today, and a Query handler receives **no Principal at all**, in-process
   or otherwise, because `QueryContext` is `data` and `signal`
   (`packages/compiler/src/generate.ts:322`–`:325`). Host code calling a Query
   cannot hand its handler a Principal the way it hands one to `actorOf`.

   So the caveat above is right that both are in-process only, and that is where
   the similarity ends. Criterion 2 needs a decision written where a brand check
   sits. Criterion 1 needs one of the three shapes in
   `docs/v4/prototypes/durable-evidence-gaps/ROUTE-SHAPE.md`, two of which amend
   an Accepted ADR. Reading the caveat as one shared blocker understates the
   second and overstates the first.

This is stated here rather than left for a reviewer to find, because a criterion
demonstrated by a weaker case than it claims is what previous rounds blocked on.
The evidence for these three should say plainly which half it proves. See the
qualifier in `maintenance-decisions.md`; the caveat expires the moment a durable
route exists.

3. **Denial specificity follows the missing Authority.** A caller without
   inspection Authority cannot distinguish denial from absence; a caller with
   inspection but not maintenance Authority receives a specific denial. →
   `maintenance-decisions.md` Q3.

   **This criterion straddles the two blockers, one clause each.** Its first
   clause is the inspection side and inherits criterion 1's problem exactly:
   producing a denial indistinguishable from absence requires evaluating an
   inspection Authority, and a Query handler has no Principal to evaluate. Its
   second clause is the maintenance side and sits with criterion 2 — the Principal
   reaches `actorOf`, and the typed denial it needs is the `AUTHORITY_DENIED`
   code `internal-protocol-v5.md` adds to the rejection union and CHECK, driven by
   `hostile-cases.md` case 5.

   **That is an argument against the merge the judgment call below considers.**
   It weighs folding criterion 3 into criterion 1. Half of it does belong there;
   the other half is satisfiable on the maintenance path once a decision replaces
   a brand check, and merging would carry that half into a criterion blocked on an
   ADR amendment it does not need. Splitting the clauses is the better move if
   this is reopened — one to criterion 1's fate, one to criterion 2's.

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
6. **The operational nondisclosure commitments are pinned and digest-verified**,
   asserting the absence of result and receipt explicitly, so a later widening is
   a visible diff in a digested artifact. **The criterion is the property, not a
   filename** — an earlier version named `operational-nondisclosure.json`, and
   the implementation satisfies the intent without producing that file. →
   `inspection-contract.md` D1.
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
15. **A stale build is explained, given the run's identity.** A run pinned to a
    retired executable digest is not presented as healthy. Falsifiable:
    `EXECUTABLE_RETIRED` writes nothing, so the history says only `accepted`.
    **Scoped deliberately:** the criterion is about what the projection says
    about a run it was handed, not about an operator finding one. Nothing lists
    a stuck `ready` run — the worklist keys on `state = 'failed'` and `runId`
    comes from no shipped API — so a criterion asserting the operator path would
    pass on a fixture that already knows the identity. →
    `hostile-cases.md` case 4.
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
  rather than carry criteria it cannot satisfy.** Queries are wired, so the
  inspection _reads_ reach the wire today.

  **But "with handler-evaluated Authority", which an earlier revision said here,
  is not available.** `QueryContext` is `data` and `signal` only
  (`packages/compiler/src/generate.ts:322`–`:325`), so a Query handler is handed
  no Principal and cannot evaluate an Authority at all; the mechanism and the
  alternatives are worked through in
  `docs/v4/prototypes/durable-evidence-gaps/ROUTE-SHAPE.md`. The reads reaching
  the wire is still true and is what that sentence needed; the reads being
  _authorized_ is not settled, and criterion 1 depends on it.
  Only the commands are blocked, and no accepted slice currently owns the
  unblocking work. A criterion asserting a
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
  size and nothing prunes the audit** — every `delete from questpie_internal.*`
  across `packages/*/src/` targets one of `change_ledger`,
  `retained_live_query_results`, `realtime_binding_generations`,
  `realtime_scope_attachments`, or `realtime_watch_bindings`, and no `durable_*`
  table appears among them — so it grows without bound, while one
  `(application_name, requested_at DESC)` index removes it at 0.072 ms.
  Measured in `studio-purpose.md`.
- **The redacted-envelope hostile case is structurally satisfied already** and
  is the weakest of the six.

## Judgment call

**Twenty-two criteria against BETA-08's sixteen**, with criterion 3 (denial
specificity) the one most likely to be judged as belonging inside criterion 1.

An earlier version of this line said "seventeen", which was right when written:
the section below, "The criteria this record was missing", later added 18
through 22 from #296's Budgets and Performance blocks and this sentence did not
move. Counted rather than estimated — 17 numbered items under "The criteria",
5 under the later heading — and BETA-08's figure verified too: its accepted
`acceptance-manifest.json` carries exactly 16.

**The corrected comparison says something the old one hid.** Seventeen against
sixteen reads as parity with the slice that took four review rounds. Twenty-two
against sixteen is a materially larger acceptance surface, and the five that
grew it are budget and performance criteria rather than behaviour. That is worth
a reviewer's attention rather than being smoothed over: if this slice is judged
too large, criteria 18 through 22 are the separable part, because they bind the
ticket's budget contract rather than the inspection behaviour the rest describes.

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
    **Criterion 19's subject is out of scope and its method is what replaced it.**
    The re-scope substituted this budget rather than deleting it. `QUEUE.json` now
    requires a "maintenance command latency baseline recorded" and lists a
    "maintenance command latency measurement manifest" as performance evidence. No
    record in this set mentions maintenance command latency anywhere, so the
    replacement budget has no criterion.

The derivation rule carries over unchanged, and it is real rather than
aspirational: `tests/load/beta08-worker-contention.ts:22` onward computes
`Math.ceil((referenceObservedMs * multiplier) / roundUpQuantumMs)`, the shape
BETA-08 asserted in-test. A latency baseline derived any other way — a number
chosen and then justified — is the failure BETA-08's first round was blocked
for. Read criterion 19 as: the subject is now maintenance command latency, and
the mechanical derivation is the part that survives.

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
