# BETA-09: what Studio is for

Decides the purpose question `maintenance-decisions.md` defers to this file.
Settled by adversarial review: two agents argued opposing framings, each
required to ground claims in `file:line` and to name where its own position was
weakest. Both reports were verified against the tree before anything here was
written; two of their findings correct `design-context.md`, and those
corrections land in the same commit.

This record decides. It opens no slice branch and changes no ADR, public
projection, gate, or tracker state.

**Scope note.** Implementation for this slice lives on branch
`feat/v4-beta-09` (worktree `/home/drepkovsky/code/questpie-v4-beta-09`), which
is not merged to `feat/v4`. The commit carrying this record touches only
`docs/`; the branch is where the code and its tests are. Where the two
disagree, the branch is the evidence.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## The decision

**Studio's job is _explain, then act_.**

- **The address space is identity-first.** The entrance is an identity resolver
  plus flat authorized catalogs of the compiled contract.
- **Every destination is decision-first, not facts-first.** Arriving at an
  identity surfaces the decision it enables and the authorized command that
  acts on it — never a tile wall.
- **One bounded worklist of runs that need a human** exists as a panel reachable
  from the entrance. It is not the front door.

The owner's steer — that the research handoff is not user-friendly enough and
lacks a real purpose — is honoured by the second and third points. The
handoff's six-to-eight facts-only Overview tiles (`OPEN-DECISIONS.md` Q5) do
not survive. Its canonical-identity depth does, and becomes the destination.

## Why the entrance cannot be a symptom

This is the finding that decides it, and it is not a matter of taste.

**The operational lane has exactly one durable symptom source: `durable_runs`.**
Everything else an incident-first entrance would enter from does not durably
exist at this base:

| Candidate symptom             | Durable trace                                                                                                                                                                                      | Verified at                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A failed Query execution      | **none.** There is no query receipt, log, or execution table                                                                                                                                       | —                                                                                                                                           |
| A failed Mutation             | **none.** `CHECK (outcome IN ('executing','committed'))` admits no failure, and the receipt is inserted inside the Mutation's own transaction, so a pre-commit failure rolls back its own evidence | `packages/compiler/src/schema/postgres/internal-protocol-v2.ts:38`                                                                          |
| An Execution error            | **none stored.** `durability: "telemetry"`, an optional in-process sink, with `traceId`, `causationId`, and `tenantRef` typed as hardcoded `null` and a per-process sequence counter               | `packages/runtime/src/application/events.ts:24`, with `traceId`, `causationId` and `tenantRef` typed `null` at `:11`, `:13` and `:16`–`:34` |
| A Live Query reset            | **current only.** A superseded generation is deleted at once, not after a delay; an idle scope is swept 30 s after its last renewal. No reset history is retained either way                       | `internal-protocol-v3-realtime.ts:169`, `:43`; `postgres-realtime-generations.ts:129`                                                       |
| A change nobody can explain   | **no attribution.** `change_ledger` carries no correlation, causation, call, principal, or tenant column                                                                                           | `internal-protocol-v3.ts:29`                                                                                                                |
| A failed or dead-lettered run | **yes**                                                                                                                                                                                            | `durable_runs`                                                                                                                              |

A symptom-first front door would therefore be a filtered view of one table.
That is a panel, and it is built below. It is not an entrance.

Meanwhile the compiled lane is complete and self-enumerating: `manifest.json`,
`policy-projection.json`, `query-projection.json`, `relational-explain.json`,
`relational-nondisclosure.json`, `committed-migrations.json`,
`reaction-projection.json` and the rest are files the Runtime already holds and
already digest-verified at startup
(`packages/runtime/src/application/artifact-files.ts:22`). An identity-first
entrance needs no new read to be complete; a symptom-first one needs several
that do not exist.

## The counter-finding, which is why the worklist exists

The opposing argument produced one fact that the identity-first position cannot
answer on its own: **`runId` is not obtainable through any shipped API.**

- All four durable reads take `runId` alone: `inspect`, `events`, effects
  `read`, and `audit`.
- `admit(batch)` is the only multi-row **read** of `durable_runs`
  (`packages/runtime/src/durable/postgres-kernel.ts:455`). `reapCancelled`
  (`:407`) also spans multiple rows, but it is a write and its predicate
  excludes terminal states too, so neither surfaces a failed run. `admit`'s
  predicate
  structurally excludes every state an operator cares about — it returns only
  runs eligible for claiming, never `failed`, `succeeded`, `cancelled`, or
  dead-lettered. It is the opposite of a symptom feed.
- `durableRunIdentity(dispatchId)` is deterministic
  (`packages/runtime/src/durable/acceptance.ts:18`) but is not exported from
  the package root (`packages/runtime/src/index.ts`).

So a purely identity-first Studio would ship a Reactions section whose detail
pages nothing can navigate to. That is the same "field no source populates"
failure BETA-08's first round was blocked for, one level up.

**The bridge is one bounded read, and it needs no schema.**
`durable_runs_claim_idx` is `(application_name, state, available_at, run_id)`
(`internal-protocol-v4-sql.ts:98`), whose leftmost prefix `(application_name,
state)` already serves `WHERE application_name = $1 AND state = 'failed' ORDER
BY available_at, run_id` as an index scan. Both opposing teams identified this
index independently. One read method over an index that already exists is the
cheapest correction that makes the durable kernel reachable at all.

**The index claim is verified, not assumed.** Measured on PostgreSQL 17.10
against 207,000 runs, the worklist query plans as
`Index Scan using durable_runs_claim_idx`, returns 64 rows, and runs in
0.13 ms. The leftmost prefix carries it and no schema is needed — which is the
premise this whole decision rests on, so it is checked rather than argued.

**Re-measured independently, and the figure above is the one to keep.** A second
run against a fresh 207,000-row fixture with the shipped indexes reported an
`Index Only Scan` with `Heap Fetches: 0` at 0.079 ms, which looks like a stronger
result and is not one. It is an artifact of a table that has been loaded and
never updated. Two things remove it, both normal for `durable_runs`:

| Projection / table state                                  | Plan                                 | Time     |
| --------------------------------------------------------- | ------------------------------------ | -------- |
| indexed columns only, freshly loaded                      | Index Only Scan, `Heap Fetches: 0`   | 0.079 ms |
| indexed columns only, after rows were updated             | Index Only Scan, `Heap Fetches: 120` | 0.116 ms |
| projection includes a non-indexed column (`failure_code`) | Index Scan                           | 0.103 ms |

`durable_runs` is a hot table whose rows change state constantly, so the
visibility map is rarely current, and any worklist row richer than
`(run_id, available_at)` reaches outside the index. **`Index Scan` at ~0.1 ms is
the realistic characterization and index-only is the exception**, which is what
this section already said.

Recorded because the failure it prevents is specific: a test asserting
`Index Only Scan` or `Heap Fetches: 0` passes on a freshly seeded fixture and
fails in production, which is the "test that proves something other than what it
claims" shape this project keeps blocking rounds for. Assert the index _name_ and
a row bound, not the scan kind.

**A gap this predicate cannot see, found after the decision and recorded rather
than folded in.** `state = 'failed'` covers the dead-letter case, which is the
operator need that justified the worklist, and ordinary retry exhaustion does
reach it — `fail()` writes `state = 'failed'` with `RETRY_EXHAUSTED` and
`deadLetter: true` once `attemptNumber >= maximumAttempts`
(`packages/runtime/src/durable/postgres-kernel.ts:663`–`:675`).

Two classes of permanently non-progressing run never reach `failed`, so this
worklist cannot show them:

- **Retired executable.** The claim is refused and nothing is written
  (`postgres-kernel.ts:514`–`:518`); the run stays `ready`. BETA-08 asserts this
  state (`tests/integration/postgres/beta08-durable-kernel.test.ts:386`–`:391`).
- **Crash at the exhaustion boundary.** `claim` returns `skipped` without writing
  when `attempt_count + 1 > maximumAttempts` (`:522`–`:523`), reachable only if a
  worker died after incrementing the count and before reporting an outcome. The
  run stays `running` with an expired lease and is re-admitted forever through
  `:462`.

Both are described in `docs/v4/prototypes/durable-evidence-gaps/FINDING.md` §5.
They matter here because the worklist's stated purpose is runs that need a human,
and a run that can never progress is exactly that while being invisible to a
`failed`-keyed read.

**The decision stands as scoped, and the scope is now stated:** this worklist
answers "what failed", not "what is stuck". Widening it is cheap on the same
indexes — `state = 'ready'` uses the same `durable_runs_claim_idx` prefix, and
the expired-lease class is served by
`durable_runs_lease_idx (application_name, state, lease_expires_at)`
(`internal-protocol-v4-sql.ts:100`) — but it is a second read shape, and D3 fixes
the inspection surface at four reads plus one worklist. Adding it belongs to
whichever slice owns the progress bound, not to this one. What would overturn
the scoping: evidence that either class occurs in practice rather than only
after a crash or a rolling deploy, in which case "what failed" is the wrong
question for the only multi-row read an operator has.

Constraints on it, each forced:

- **First N with `hasMore`, never a count.** The reason is disclosure, not
  cost. Measured, a count over the same indexed predicate is an Index Only Scan
  at 0.47 ms for 2,000 failed runs — affordable. But `countOracle: "absent"` is
  a nondisclosure commitment in the application lane
  (`packages/compiler/src/relational/nondisclosure.ts`), and the operational
  lane matches it so a total cannot be used as an existence oracle. An earlier
  revision justified this as "a total is a scan," which measurement does not
  support.
- **Tenant-filtered, not tenant-keyed.** `tenant_id` is in no index, so a
  tenant-scoped list selects through the indexed state predicate and filters —
  0.31 ms measured, cost proportional to the matching state set rather than the
  table. Tenant is displayed and authorized on; it does not drive the query.
- **Inspection Authority evaluated at the entrance, not the leaf.** A list
  leaks the existence of runs, so the Authority decision `design-context.md`
  assigns to this slice becomes the first thing evaluated rather than the last.

## Jobs, traced

### Answerable: "this run is stuck — is retrying safe?"

The flagship, and it terminates in an action.

`inspect(runId)` reports `state`, `failureCode`, `deadLetter`, and `version`.
`EFFECT_AMBIGUOUS` is a permanent failure code, so the run is terminal and
dead-lettered with no retry pending. Effects `read(runId)` returns the
ambiguous effect with `receipt: null` — and null receipt is _forced_ for
`ambiguous` by `durable_effect_settled_shape`
(`internal-protocol-v4-sql.ts:188`), so the unknown provider outcome is a
schema guarantee rather than an inference. `audit(runId)` shows whether someone
already tried. The action is two fenced steps: `acknowledgeAmbiguity`, then
`retryRun`, both bound to `version`.

**This job does not execute as written, and that is a finding this slice owes.**
`acknowledgeAmbiguity`'s applied path appends an `ambiguityAcknowledged` event
(`packages/runtime/src/durable/postgres-maintenance.ts:371`), and every append
bumps `event_sequence` (`packages/runtime/src/durable/rows.ts:139`). The run's
version therefore changes. `DurableMaintenanceOutcome` (`postgres-maintenance.ts:28`)
carries no version, and `maintenance-decisions.md` only returns one on a
`VERSION_MISMATCH`. So a caller who reads version V, acknowledges, then retries
bound to V is _guaranteed_ to be fenced out — the flagship job fails on its
second step by construction.

The fix is small and belongs with the fence decision: an **applied** outcome
must return the run's new version too, not only a rejected one. Then the two
steps chain without a second `inspect()` and without a race. Recorded here
rather than quietly repaired because this is exactly the class of defect
BETA-08 was blocked for — a path asserted in a record that no execution
supports.

This is the job that justifies the whole slice, and it is exactly the job
`maintenance-decisions.md` warns Studio must not get wrong by offering
`retryRun` as the remedy for ambiguity.

### Answerable, and it proves explanation is primary: "why is this run stuck?"

A run whose executable was retired sits at `state = 'ready'` with a history
that says only `accepted`. The refusal writes **nothing** — the claim returns
`EXECUTABLE_RETIRED` from inside a transaction that has performed only a
`SELECT ... FOR UPDATE SKIP LOCKED` (`postgres-kernel.ts:513`), and the worker
counts it in memory.

So the durable log cannot explain it. The only witness is the compiled
contract: `durable_runs.executable_digest` against the loaded Reaction's
`contractDigest`, resolved through the executable artifact's origin. **Durable
facts without the compiled contract are uninterpretable**, which is the
strongest possible argument for the entrance chosen here.

This also stands as a finding in its own right: a retired-executable run is
invisible in the durable history, and any screen claiming to explain a stuck
run must join to the contract to do it.

### Answerable: "the Mutation committed — what happened to its Reaction?"

Pure function, no lookup — but **not a function of `callId` alone**, and an
earlier revision wrote it that way. The dispatch identity is
`deterministicUuid(inputScopeBytes({...}))` over **seven** inputs: application,
`tenantId`, operation identity, principal kind, principal id, `callId`, and the
`dispatchSlot`
(`packages/runtime/src/mutation/postgres.ts:271`–`:280`). From there
`durableRunIdentity(dispatchId)` → `runId` → `effectIdentity(application, runId,
effectName)` are each a deterministic digest
(`packages/runtime/src/durable/acceptance.ts:18`,
`packages/runtime/src/durable/rows.ts:170`), and every landing is a primary key.

The correction matters for whether the job is usable. Six of the seven inputs are
facts the caller's own Execution already fixes — application, tenant, operation,
principal, and the slot the Reaction is declared in — so a support flow that
knows _which operation a known principal called in a known tenant_ can derive the
rest. A flow holding only a `callId` cannot. "`callId` rides the wire response"
is still true and still useful; it is one of seven inputs rather than the whole
key.

Two things stand between this chain and being usable, and they are not the same
kind of thing.

`durableRunIdentity` is not exported from the package root. That is a disclosure
of an existing deterministic derivation and costs nothing.

A public read of `mutation_call_receipts` is **not** available to this slice, and
an earlier revision listed it beside the export as though it were. It is a fifth
read shape over an internal table, which `inspection-contract.md` D3 forbids in
terms — "adding read shapes beyond these is how an inspection surface becomes the
internal-table CRUD the issue names as a non-goal" — and internal-table CRUD is
one of the issue's own non-goals. D3 wins: the surface stays at four reads plus
the worklist, and this job stays partly unanswerable rather than being made
answerable by widening the surface.

One correction to how the receipt was described. It is not "already-indexed" in
the sense that implies. `mutation_call_receipts` carries a single index, the
six-column primary key `(application_name, tenant_id, operation_name,
principal_kind, principal_id, call_id)`
(`packages/compiler/src/schema/postgres/internal-protocol-v2.ts:34`), with
`call_id` **last**. A lookup by `callId` alone cannot use it. The chain above
works because it arrives knowing the five preceding columns, not because a
receipt is addressable by its call identity.

### Not answerable — recorded as findings, not deferred

- **"Which subscriptions did this deploy reset?"** No source. Reset history
  is not retained at all: a superseded generation is deleted immediately, and
  an idle scope is swept thirty seconds after its last renewal. This kills the
  handoff's Q5 reset tile.
- **"Show me recent Executions / trace this correlation id."** No source, and
  for **two** reasons rather than one. The Execution Envelope is unstored
  telemetry with hardcoded-null trace, causation and tenant references —
  `correlationId` itself is populated, so what defeats it is the missing store
  rather than a null field.

  The second reason is stronger and was missing here. `correlation_id` **is**
  durably stored, on `durable_runs` and on `durable_run_events`
  (`packages/compiler/src/schema/postgres/internal-protocol-v4-sql.ts:31`,
  `:143`) — and it is unqueryable: **no index mentions it, and no `WHERE` clause
  anywhere in `packages/runtime` filters on it.** It is write-only propagation
  data. So even where a correlation is durably recorded, tracing one is a
  sequential scan rather than a lookup.

  Gate 8 already requires that missing telemetry stay explicit, so Studio must
  say so rather than render an empty lane. An earlier revision of this bullet was
  also garbled mid-sentence by a previous edit.

- **"Who changed this row and why?"** No source. The Change Ledger carries no
  caller attribution.
- **"Who cancelled what today?"** A scan, and the cost is now measured rather
  than asserted. With only the shipped
  `durable_maintenance_commands_run_idx (application_name, run_id, requested_at)`,
  a global `ORDER BY requested_at DESC LIMIT 50` over 200,000 audit rows plans as
  a parallel sequential scan with a top-N heapsort at **31.8 ms**. Adding
  `(application_name, requested_at DESC)` makes the same query an Index Scan at
  **0.072 ms**.

  So "no source at acceptable cost", which an earlier revision said, is too
  strong: 31.8 ms is usable. The accurate statement is that the feed is linear in
  audit size from the shipped indexes, **and nothing prunes the audit** — there is
  no retention sweeper against any `durable_*` table
  (`freshness-and-provenance.md`), so that cost grows without bound and one index
  removes it entirely. The decision to keep the audit per-run stands on the
  accepted contract framing it that way, not on the scan being unaffordable.
  `durable_maintenance_commands_run_idx` is `(application_name, run_id,
requested_at)` (`internal-protocol-v4-sql.ts:246`) — `run_id` is second, so a
  time-ordered global feed is a sequential scan. The audit is answerable per
  run, which is how the accepted contract frames it.

## What this costs

One read method on the durable surface, over an existing index. Two
disclosures of existing facts. No schema for any of it — the internal protocol
v5 this slice owns is for the maintenance reason
(`maintenance-decisions.md`), not for the worklist.

Against that: four named lanes the screens must **not** draw, because nothing
populates them. Naming them here is the point. BETA-08's first round was
blocked for pinning what nothing enforces; the Studio equivalent is a view
model field no source fills, and the four above are exactly where that would
have happened.
