# Seven durable properties that no test drives

BETA-08 was accepted with twelve review observations. Auditing them against the
tree closed one, refuted one, found one part stale, and **confirmed three** —
all of the same shape: a property declared in a criterion, implemented in code,
and asserted by nothing.

This record converts those three into falsifications, because the lesson the
same audit produced is that reading settles candidates and only breaking
settles enforcement. Each entry says what to break, what must then fail, and
what the test proves that a reading cannot.

It writes no code and opens no slice. The gaps belong to whoever next touches
the durable surface.

Base: `feat/v4` at `c0b133b5`.

## 1. The effect fence

**Claimed.** Criterion 4: "every heartbeat, terminal transition, and effect
write compares the current attempt and the lease token."

**Built.** `packages/runtime/src/durable/postgres-effects.ts:86` —
`SELECT 1 AS held FROM questpie_internal.durable_runs WHERE application_name = $1
AND run_id = $2 AND current_attempt_id = $3 AND lease_token_digest = $4`.

**Driven by nothing.** All six `"fenced"` assertions in
`tests/integration/postgres/beta08-durable-kernel.test.ts` are kernel surfaces —
`succeed`, `fail`, `cancel`, `heartbeat` at `:200`–`:217`, the
`succeed`-versus-`cancel` race at `:440`, and a second `succeed` fence at `:542`
inside the cancel-reap test at `:490`. `DurableLeaseLost` appears in no test.
An earlier revision of this entry said "all five" and enumerated only the first
five; the file held six then too, so that was a miscount at authoring rather
than drift. The substance is unchanged and slightly strengthened: the sixth is
another kernel surface, not the effect fence.

**The falsification.** Take a claim, let the lease expire, let another worker
claim it, then invoke an effect on the _stale_ claim. Assert the ledger refuses
it. Break it by deleting `AND current_attempt_id = $3 AND lease_token_digest =
$4` from `:88`; the test must then show the stale holder reserving or settling
an effect the fresh holder owns.

**What only the test can prove.** That two attempts cannot both drive one
effect identity. The reading proves the predicate is present, not that it is
reached — and the ledger's own `fenced` status is returned from three separate
call sites.

## 2. The maintenance brand refusal

**Claimed.** That maintenance commands take a trusted `Principal` rather than a
caller-supplied identity pair.

**Built.** `postgres-maintenance.ts` `actorOf` (`:179` today) — it throws
`"durable maintenance requires a trusted Principal"` unless
`principalKernel.is(actor)`.

**Driven by nothing.** The only test matching that string is
`tests/integration/beta03-execution-services.test.ts:450`, which passes a cast
value into a _runtime execution_ and trips the Execution root's own brand check.
Same message, different file, different code path.

**The falsification.** Call a maintenance command with a plain object shaped
like a `Principal`. Assert it throws. Break it by removing the
`principalKernel.is` guard; the command must then accept the impostor and write
its `kind`/`id` into the audit.

**What only the test can prove.** That the brand is load-bearing rather than
decorative. Note the qualifier in
`docs/v4/implementation/beta09/maintenance-decisions.md`: with no wire route,
the only caller is in-process and mints its own `Principal`, so this test proves
the guard works and not that anything adversarial is stopped.

## 3. The `cancellationRequested` event

**Claimed.** Criterion 16: "every declared event kind is appended." The kind is
declared at `packages/compiler/src/reaction/durable-kernel.ts:83`.

**Built.** `postgres-maintenance.ts:263` appends
`claimed ? "cancellationRequested" : "cancelled"`, so the kind is reached only
when the run is currently claimed.

**Driven by nothing.** Event kinds are asserted from `events()` at
`beta08-durable-kernel.test.ts:204`, `:308`, and `:812`, and this kind appears
in none of them. The two `cancellationRequested` hits at `:340` and `:745`
assert the **field** on `inspect()`, not the **kind** in the history.

**The falsification.** Cancel a run while it is claimed, then read `events()`
and assert `cancellationRequested` is among the kinds. Break it by flipping the
ternary at `:267` to append `"cancelled"` unconditionally; the assertion must
then fail.

**What only the test can prove.** That the claimed and unclaimed cancellation
paths append _different_ kinds. The field on `inspect()` is true in both cases,
so asserting it distinguishes nothing.

## Why these three and not the other nine

The audit's outcomes are recorded in `HANDOFF.md` beside the #295 verification
entries. One observation was explained and closed, one was refuted outright,
and one carried-forward list turned out to be part stale. Those needed reading.
These three needed breaking, and that is the whole distinction the lesson
records.

## All three are constructible today

A falsification nobody can build is worse than none, so each was checked against
the existing harness and test patterns rather than left as a description.

`Beta08Harness`
(`tests/integration/postgres/helpers/beta08-durable.ts:140`) already exposes
`kernel`, `ledger`, `maintenance`, and `kernelWith`. Nothing new is needed.

| Spec                       | Extends                                                                          | What is already there                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, effect fence            | kernel test 1 plus the cross-attempt effect test                                 | `claimAfterLeaseExpiry` (`:78`) produces the stale/fresh claim pair, and `createDurableRunHandle` is already used with two different claims at `:603` and `:628`. Build a handle from the **crashed** claim rather than the fresh one and invoke an effect. |
| 2, brand refusal           | any maintenance test                                                             | `prepared.maintenance` is the published surface. Pass a plain object shaped like a `Principal` instead of `prepared.principal`.                                                                                                                             |
| 3, `cancellationRequested` | kernel test 1's claimed run, plus the `events()` reads at `:204`, `:308`, `:812` | Cancel while the run is **claimed**, then assert the kind is among those returned.                                                                                                                                                                          |

So each is a variation on a test that exists, not a new harness. Spec 1 is the
one with real content — it needs the stale claim to reach the ledger rather than
the kernel, which is precisely the path nothing currently drives.

One caveat worth stating before someone starts. Spec 2 proves the guard fires;
it cannot prove anything adversarial is stopped, for the reason recorded in
`docs/v4/implementation/beta09/maintenance-decisions.md` — with no wire route the
only caller is in-process and mints its own `Principal`. Write the assertion, and
write down which half it proves.

## Four further gaps, found by adversarial review and verified here

These are bounds that accepted authority names and no code enforces. None is a
disclosure gap in this record's original three; they are additions, found by
running two opposing reviews over the tenant-share records and then checking the
tree rather than the reports.

This heading said "Two further gaps" while four sections sat under it. Sections
4 and 5 arrived at `e1af84fd`, sections 6 and 7 at `ba7daced`, and the count was
not updated either time. The document title said "Three" for the same reason.

### 4. The retry horizon is pinned, digest-carried, and enforced nowhere

`retryHorizonMilliseconds: 86_400_000` is pinned into the compatibility contract
the Runtime Build digests (`packages/compiler/src/reaction/durable-kernel.ts:77`),
under a comment claiming that block holds "only the budgets this slice actually
enforces" (`:68`–`:71`).

`horizon_at` has exactly two references in the runtime:
`packages/runtime/src/durable/acceptance.ts:62` writes it, and
`packages/runtime/src/durable/postgres-kernel.ts:260`–`:262` reads it — inside
`available_at = LEAST(transaction_timestamp() + interval, horizon_at)`. Nothing
compares it to the current time as a termination condition.

**The clamp has an ordering consequence.** Once `horizon_at` is in the past,
`LEAST` sets `available_at` to a past timestamp, and `admit` orders
`available_at` ascending (`postgres-kernel.ts:378`). A run past its horizon
therefore takes its remaining retries with zero backoff **at the head of the
admission queue**, ahead of healthy work.

**This entry was first written more strongly than the tree supports, on an
agent's framing that was not checked against the surrounding text.** Two
corrections, both from reading BETA-08's narrower-claims list in
`docs/v4/implementation/beta08/design-context.md` in full — its retry-horizon
bullet and its `durable-kernel.json` budgets bullet:

- **It is not a self-contradiction, and calling it one was unfair.** The record
  discloses the gap in the same bullet that describes the clamp: "This slice
  runs no horizon sweep, so a run whose horizon passes while it waits is still
  bounded only by its eight-attempt program" (`:260`–`:263`). Counting the
  horizon among the pinned budgets at `:266`–`:268` is consistent with that,
  because the horizon _is_ read and applied on every retry schedule. "Enforces"
  there means clamps, not terminates.
- **The head-of-queue effect is bounded, not permanent.** The eight-attempt
  program stops the retries; `claim` returns `skipped` once
  `attemptNumber > retry.maximumAttempts` (`postgres-kernel.ts:439`).

So the accurate finding is narrower than "a pinned budget with no enforcing
path": the clamp is a path. What is missing is a **termination** condition —
nothing compares `horizon_at` to the current time to end a run — and the clamp's
interaction with ascending admission order means an over-horizon run's remaining
attempts jump the queue.

It compounds with §5 rather than standing alone: once those attempts are
exhausted the run is `skipped` on every claim, still carries a past
`available_at`, and is therefore re-admitted at the head of the queue **forever**.
That permanence comes from §5, not from the horizon.

### 5. A refused claim writes nothing, and the run is re-admitted forever

Two claim outcomes return without touching the row:
`refused / EXECUTABLE_RETIRED` (`postgres-kernel.ts:431`–`:435`) and `skipped`
when `attemptNumber > retry.maximumAttempts` (`:439`).

**The two leave the run in different states, and the second is rarer than it
looks — both worth stating precisely, because a first draft of this entry was
vaguer than the tree.** Ordinary retry exhaustion does _not_ reach the `skipped`
path: `fail()` terminalizes at `claim.attemptNumber >= claim.retry.maximumAttempts`,
writing `state = 'failed'` with `RETRY_EXHAUSTED` and `deadLetter: true`
(`postgres-kernel.ts:663`–`:675`). So an exhausted run normally ends `failed`,
which is correct and reachable.

The `skipped` branch uses `>` against `attempt_count + 1`, so it fires only when
`attempt_count` already reached `maximumAttempts` **without** `fail()` ever being
called — a worker that died after the attempt incremented the count and before it
reported an outcome. The lease then expires, `admit` re-selects the row through
`state = 'running' AND lease_expires_at <= transaction_timestamp()` (`:462`),
`claim` skips it, nothing is written, and the cycle repeats indefinitely.

So the two stuck classes settle at **`ready`** (retired executable) and
**`running` with an expired lease** (crash at the exhaustion boundary).
Neither is `failed`. The worker mirrors
this, counting the refusal and continuing —
`refusedIncompatible += 1` at `packages/runtime/src/durable/worker.ts:290`,
`continue` at `:300`. An earlier revision cited `:300`–`:304`, which resolves
and sits in the right branch but starts at `outcome: "refusedIncompatible"`
inside the pushed record and misses the counter at `:294` — the half the
sentence actually names. `available_at` never
advances, so `admit` re-selects the row on every poll of every worker and it
sorts **first**. No sweeper removes it — there is no `DELETE` against any
`durable_*` table anywhere in `packages/*/src/`.

**A shipped test asserts this state.** After a retired-kernel refusal,
`tests/integration/postgres/beta08-durable-kernel.test.ts:386`–`:391` asserts the
run is still returned by `admit()` and still reads
`{ state: "ready", attemptCount: 0 }`.

`claimBatch` defaults to 64 and is rejected outside 1–64
(`postgres-kernel.ts:257`–`:263`), so it takes only as many such rows as the
configured batch to occupy every admission permanently — 64 at the default, fewer
for a worker configured lower. They sort first because a refused run keeps its
original `available_at` while healthy work arrives with later ones.

The trigger is an ordinary completed rolling deploy, not an attack: "readiness
does not scan `durable_runs.executable_digest` against the current build"
(`docs/v4/implementation/beta08/design-context.md:279`–`:283`), and no readiness
path in `packages/runtime/src` reads that column.

**What BETA-08 disclosed, stated fairly.** The slice named this: the refusal
"consumes no attempt; the run stays `ready` for a compatible worker" (`:264`–`:266`),
and `:279`–`:283` records it as a narrower claim and "the only disposition this
slice implements". So the mechanism is disclosed and deliberate. What is not
disclosed is the consequence for admission — that the row is re-selected by every
worker on every poll indefinitely, ahead of live work, with no sweeper and no
progress bound. That consequence is this entry's content; the mechanism is not a
discovery.

**This is why it matters to the fair-admission work next door.** Ranking by
`row_number() OVER (PARTITION BY tenant_id ORDER BY available_at, run_id)` makes
a poison row `turn = 1` for its tenant on every round. Fair admission narrows the
blast radius to one tenant and makes that tenant's starvation permanent. Neither
`docs/v4/prototypes/tenant-share-control/MECHANISM.md` nor its `DECISION.md` asks
whether an admitted run can fail to progress, and there is no progress bound on
admission to ask it of.

**Falsification for both.** For 4: set a run's `horizon_at` in the past, fail it,
and assert its `available_at` is not before a healthy run's. For 5: refuse a
claim, poll `admit()` twice, and assert the run does not appear in the second
batch. The §4 falsification still fails against the tree; BETA-10 closes §5
below.

**BETA-10 resolution of §5.** The two poison classes are now closed at their
different correct seams. Admission filters executable digests before its
tenant-fair order and `LIMIT` (`packages/runtime/src/durable/postgres-kernel.ts:357`–`:393`),
so an incompatible run remains durable for an old compatible worker without
occupying a new worker's batch. A run whose worker died after the last allowed
claim is terminalized as `failed / RETRY_EXHAUSTED`, its outstanding attempt is
settled, and one append-only `failed` event is written without creating a ninth
attempt (`packages/runtime/src/durable/postgres-kernel.ts:436`–`:480`). The PostgreSQL falsification at
`tests/integration/postgres/beta08-durable-kernel.test.ts:353`–`:402` asserts
the terminal state and that a later admission no longer returns the run.

This does not resolve §4's separate horizon-ordering claim; no BETA-10 evidence
silently promotes that remaining candidate to closed.

### 6. The maintenance audit has no row bound, and a timeout cannot give it one

`durable_events` is bounded by CHECK —
`durable_event_sequence_bounded CHECK (sequence BETWEEN 1 AND 1024)`
(`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:149`).
`durable_maintenance_commands` has no equivalent. Its five CHECK constraints
(`:213`–`:245`) cover the command name, the outcome, the rejection code, the
outcome shape, and the actor kind. None bounds a count.

`record()` inserts a row for **rejected** commands as well as applied ones, from
eleven call sites in `packages/runtime/src/durable/postgres-maintenance.ts`
(`:208`, `:218`, `:228`, `:269`, `:289`, `:299`, `:309`, `:325`, `:345`, `:362`,
`:372`). Repeated rejected commands against one run therefore grow the table
without limit, no sweeper deletes them — every
`delete from questpie_internal.*` in `packages/*/src/` targets `change_ledger`,
`retained_live_query_results`, or a `realtime_*` table — and `audit(runId)` reads
all of them: `WHERE application_name = $1 AND run_id = $2 ORDER BY requested_at,
command_id`, with no `LIMIT` (`postgres-maintenance.ts:384`).

**Why this matters to the statement-timeout gate next door.** A
`statement_timeout` on `audit` converts an unbounded read into a _failing_ read
rather than a bounded one. The missing bound is on rows, and the gate only
bounds time. This is the one surface where the gate makes the operator's
experience worse rather than better, and
`docs/v4/prototypes/statement-timeout-gate/DECISION.md` should not be read as
covering it.

**Falsification.** Issue N rejected maintenance commands against one run, then
assert `audit(runId)` returns a bounded number of rows. It fails for every N.

### 7. Pool checkout is unbounded and abort-blind, in framework code

`packages/runtime/src/mutation/postgres.ts:173` is `await pool.reserve()` — no
signal, no deadline — and it runs _after_ the 5,000 ms budget is armed at `:159`.
The relational path is the same shape: `reserveConnection`
(`packages/runtime/src/relational/postgres.ts:29`–`:36`) calls `pool.reserve()`
and retries once on a closed connection, neither call signal-aware, invoked at
`:80` after a single `throwIfAborted()` at `:79`.

Pool _sizing_ is legitimately the host's — the framework takes `SQL` as a
type-only import and never constructs the pool. But the _wait_ is framework code,
and the framework declines to wire an abort it already holds.

**This is the bound the tenant-share record files under "PostgreSQL pool slots |
nowhere; the host owns the pool | non-goal for beta.1".** That scoping is right
about sizing and wrong about the wait. It matters for share: a
`statement_timeout` bounds the holder of a connection, not the queue for one, so
a tenant parking N mutations behind the unbounded row lock recorded in the gate
record still holds N slots while every other tenant waits in an uninterruptible,
unordered queue.

**Falsification.** Abort a Mutation's signal while every pool connection is
held, and assert the call rejects. It waits instead.

## Who owns 4 through 7

Sections 1 through 3 already say they belong to "whoever next touches the
durable surface". Sections 4 through 7 were left with no owner at all, which is
how a written falsification becomes a permanent record instead of a test. Each
is assigned below against the slice scopes in
`docs/v4/prototypes/implementation-collapse-p16/QUEUE.json`, or recorded as
deferred with the reason. No new prototype: the falsifications are already
written above, and this section only says where each one lands.

### 4 and 5, retry horizon and poison-run progress, to BETA-10

They go together because section 4 says so: its permanence "comes from §5, not
from the horizon". Assigning them apart would split one failure.

**5 is the stronger fit, and it is close to exact.** BETA-10's `hostile` list
contains `"old/new compatible build"` and `"incompatible claim refusal"`
(QUEUE.json), and section 5's trigger is "an ordinary completed rolling deploy"
producing exactly that refusal. Its falsification — refuse a claim, poll
`admit()` twice, assert the run is absent from the second batch — is a
rolling-compatibility assertion, which is what BETA-10's `"rolling compatibility
matrix"` artifact is for.

**4 needs more than one worker to be visible at all.** The head-of-queue effect
is an ordering claim between a poisoned run and healthy work competing for
admission, so it is only observable under BETA-10's `"ten-instance load
scenario"` and `"concurrent schedulers/workers"`.

**One thing whoever takes this must know before writing the test.** A shipped
test already asserts the stuck state as correct:
`tests/integration/postgres/beta08-durable-kernel.test.ts:386`–`:391` asserts
that after a retired-kernel refusal the run is still returned by `admit()` and
still reads `{ state: "ready", attemptCount: 0 }`. Fixing section 5 changes an
assertion inside an accepted slice. That is a BETA-08 acceptance question, not a
free BETA-10 edit, and it should be raised before the work starts rather than
discovered in review.

**What would overturn this.** If the owner rules that the eight-attempt program
is the only intended bound and a poisoned row at the head of admission is
acceptable, section 4 stops being slice work and becomes a disclosure fix in
`docs/v4/implementation/beta08/design-context.md` — the consequence for
admission is the part that record does not state. Section 5 does not dissolve
the same way; no reading makes indefinite re-admission intended.

### 6, the maintenance audit row bound, to BETA-09 — and it does not die with it

`audit(runId)` is the inspection surface's read, and BETA-09 owns `"safe
event/explain views"`. Its `hostile` list is where the rows come from:
`"maintenance Authority denial"` and `"typed concurrent command winner"` both
produce **rejected** commands, and `record()` inserts a row for rejected
commands as well as applied ones from eleven call sites. The slice that
exercises those hostile cases is the slice that generates the unbounded table.

**The dependency is the problem with this assignment, and it is worth stating
plainly.** BETA-09 is unaccepted and blocked on an owner decision. If it is
descoped, section 6 loses its owner while the gap stays exactly where it is:
`audit()` is BETA-08 code, accepted and shipping, and
`postgres-maintenance.ts:384` has no `LIMIT` today regardless of what happens to
Studio. **A descope decision must reassign section 6, not close it.** There is
no Studio row bound in the tree to inherit either — the 100-row page bound the
public guide describes has no constant anywhere in `packages/`, because Studio
lives on an unmerged branch.

### 7, pool checkout abort-wiring, deferred — with the trigger that undefers it

No current slice would catch it. Every slice that asserts cancellation asserts
it without pool contention: nothing in `tests/` drives pool exhaustion, and the
only `reserve()` appearances are a stub at
`tests/integration/beta04-policy-query.test.ts:106` and direct session checkouts
in the beta02 and beta06 protocol tests. A gap no criterion reaches is deferred
whether or not anyone writes it down; writing it down is the difference between
deferred and lost.

**The existing non-goal covers half of it and should not be read as covering the
rest.** The tenant-share record files pool slots under "the host owns the pool |
non-goal for beta.1". That is right about _sizing_ — the framework takes `SQL`
as a type-only import and never constructs the pool. It is not about the _wait_:
`mutation/postgres.ts:173` is `await pool.reserve()` with no signal, armed after
the 5,000 ms budget at `:159`, and `relational/postgres.ts:31`,`:34` are the
same shape. That is framework code declining to wire an abort it already holds,
which the non-goal does not reach.

So this is deferred as slice work but recorded as a known limit of the
cancellation contract: a Mutation's signal does not interrupt a pool wait.

**What undefers it.** BETA-10 ships a `"ten-instance load scenario"`. If that
scenario puts enough concurrent Mutations against one pool to queue on checkout,
section 7 becomes observable inside a slice that is already running, and its
falsification — abort a Mutation's signal while every connection is held, assert
the call rejects — costs one test rather than a new scenario. Whoever builds
that scenario should check whether it already reaches this, because that is the
cheapest moment this gap will ever be closeable.

## BETA-10 changed what "head of the queue" means

§4 above argues that a run past its horizon takes its remaining retries with
zero backoff at the head of the queue, because `LEAST` drives `available_at`
into the past and `admit` orders by it ascending. BETA-10 merged at `8787e870`
and rewrote that ordering: `admit` now sorts `ORDER BY tenant_turn,
available_at, run_id` (`packages/runtime/src/durable/postgres-kernel.ts:378`),
where `tenant_turn` is `row_number() OVER (PARTITION BY tenant_id ORDER BY
available_at, run_id)` (`:365`).

**The finding survives and its blast radius shrinks.** `available_at` is still
the tiebreak inside a tenant, so a horizon-exhausted run still sits at the head
of **its own tenant's** turn order and still burns its retries with no backoff.
What changed is who pays: before, that run competed directly against every other
tenant's work for the head of one global queue, so one tenant's runaway retry
loop could hold the front of the batch. Now each tenant's first run is taken
before any tenant's second, so the loop is confined to its own tenant's share of
each batch.

**This is a containment, not a fix.** The run still spends attempts at full
speed against its own tenant, which is the tenant that would notice. Nothing in
the BETA-10 rewrite bounds the retry rate; it bounds the collateral. The
underlying gap — that `LEAST(transaction_timestamp() + interval, horizon_at)`
turns a horizon into a zero-backoff floor rather than a stop — is untouched at
`:260`–`:262`.

**What would overturn this.** A single-tenant deployment, where `PARTITION BY
tenant_id` yields one partition and `tenant_turn` degenerates to the old global
`available_at` order. There the containment does not exist and §4's original
statement stands unmodified. I did not check whether any accepted document
requires more than one tenant per application, so single-tenant is the case to
assume, not the exception.

## Gap 5's first half closed at the source, and its evidence is text-shaped

"4 and 5 to BETA-10" above assigned this gap. BETA-10 merged at `8787e870`, and
half of gap 5 is closed — not by making the refusal write something, but by
removing the reason the refusal was reached.

`admit()` now fences on fleet compatibility inside its own `WHERE`:
`executable_digest IN (SELECT pg_catalog.jsonb_array_elements_text(($2::text)::jsonb))`
(`packages/runtime/src/durable/postgres-kernel.ts:368`–`:370`). A run whose
pinned executable no boot in the fleet carries is **no longer eligible for
admission**, so it cannot be handed to a worker, refused, and re-admitted on the
next poll. That was the loop this entry described, and it is gone at its source.

**The refusal path survives, correctly, as a race backstop.** `claim` still
returns `refused / EXECUTABLE_RETIRED` (`:431`–`:435`), which is right: a run can
be admitted and the executable retire before the claim transaction runs. What
changed is that this is now the narrow window rather than the steady state.

**The second half is untouched.** The `skipped` branch when `attemptNumber >
retry.maximumAttempts` (`:439`) still writes nothing, and nothing in the BETA-10
diff addresses gap 4's retry horizon. Both remain open, and "4 and 5 to BETA-10"
should now be read as one delivered and one not.

**The evidence is thinner than the mechanism, which is this record's whole
subject.** The fence's statement text is asserted by
`tests/hostile/beta10-compatibility.test.ts:5`, which builds the kernel over a
fake `sql` whose `unsafe` captures the statement and resolves `[]`
(`:11`–`:17`), then asserts `toContain` on the captured string. That proves the
statement contains the fence, not that the fence excludes a run. The one live
`postgresTest` that calls `admit()` —
`tests/integration/postgres/beta08-durable-kernel.test.ts:104` — asserts tenant
interleaving, `[runIds[0], runIds[4], runIds[1], runIds[5]]` from a
two-tenant backlog, and never introduces a run with an incompatible digest.

**So gap 5's mitigation is in the same category the other six entries name.**
Implemented in code, asserted as a string. The falsification this record would
have asked for is unchanged in shape: admit a run, retire its executable from
every reaction in the fleet, call `admit()`, and assert the run is absent from
the batch. That test does not exist today.

## The archive kernel is not the single-tenant case

The entry above names a single-tenant deployment as what would overturn the
containment reading, since `PARTITION BY tenant_id` degenerates to one partition
there. BETA-11 merged at `aa7d2a54` and added a second fixture,
`fixtures/archive`, whose acceptance test is titled "archive compiles the
existing kernels **without tenant**, CRUD, or collaboration assumptions"
(`tests/integration/beta11-archive.test.ts:13`). That title is about what the
compiler assumes, not about what the kernel declares: the fixture declares
`tenantId: field.uuid({ nullable: false })`
(`fixtures/archive/src/institutions.ts:7`) and resolves
`context.tenant({ id: institution.tenantId })`
(`fixtures/archive/src/execution.ts:16`).

So the overturn condition is still unmet, and both shipped fixtures carry a
tenant. Recorded because the test title reads like the opposite, and a future
reader looking for the single-tenant case would reasonably stop there.
