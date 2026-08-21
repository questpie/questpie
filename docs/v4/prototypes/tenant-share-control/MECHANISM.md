# Per-tenant fair admission: the mechanism BETA-10 inherits

Mechanism note for the three durable axes the tenant-share decision assigned to
BETA-10. It is a note, not an implementation slice: it records the shape, the
costs, and the edges that decide them, so the implementing slice instantiates
rather than rediscovers.

This record writes no production code, opens no slice branch, and changes no
ADR, public projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## What BETA-10 inherits, in one place

The three axes below each changed position while this record was being checked,
two of them substantially. Stated here so the implementing slice reads the
current answer rather than reconstructing it from the corrections.

1. **Fair admission — build it.** Rank within tenant with
   `row_number() OVER (PARTITION BY tenant_id ORDER BY available_at, run_id)` and
   order the batch by `turn` first. `ORDER BY turn` is the entire fairness
   mechanism; the `turn <= $sliceHint` filter only prunes emission. **Set
   `sliceHint = claimBatch`** — anything smaller starves a single-tenant batch,
   which is the shape of the load scenario that passes today.
2. **Per-tenant in-flight cap — decide, do not assume.** The `(application_name,
tenant_id, state)` index this record once called necessary is **optional**:
   the shipped `durable_runs_lease_idx` answers the count through its
   `(application_name, state)` prefix at 0.083 ms, and the new index buys nothing
   at reachable scale. The open question handed over is whether a per-tenant cap
   binds at all below ten instances, given `worker.ts` runs one attempt at a time.
3. **Backlog refusal at acceptance — build it, as a guard.** Count against the
   cap adjacent to the dispatch insert, inside the Mutation transaction. It is
   approximate under READ COMMITTED by about one row, and that is accepted:
   `SERIALIZABLE` admits fewer than the cap by aborting, which is worse.

**And one precondition the mechanism does not enforce:** nothing bounds how many
tenants one actor can resolve to, so fair share is share among the tenants that
exist. See the section near the end for what would make that a framework
property rather than an application one.

## What admission does today

`admit(batch)` (`packages/runtime/src/durable/postgres-kernel.ts` `admit`, `:357`):

```sql
SELECT run_id, resource_identity, executable_digest
FROM questpie_internal.durable_runs
WHERE application_name = $1
  AND NOT cancellation_requested
  AND ((state IN ('delayed','ready') AND available_at <= transaction_timestamp())
    OR (state = 'running' AND lease_expires_at <= transaction_timestamp()))
ORDER BY available_at, run_id
LIMIT $2
```

`tenant_id` is stored on every run (`internal-protocol-v4-sql.ts:20`, written at
`packages/runtime/src/durable/acceptance.ts:58`) and appears nowhere in this
predicate. Strict `available_at` ordering means one tenant's burst takes the
whole batch, which is the finding the decision record names.

## 1. Fair admission

Rank within tenant, then take across tenants:

```sql
SELECT run_id, resource_identity, executable_digest
FROM (
  SELECT run_id, resource_identity, executable_digest, available_at,
         row_number() OVER (PARTITION BY tenant_id
                            ORDER BY available_at, run_id) AS turn
  FROM questpie_internal.durable_runs
  WHERE <the existing eligibility predicate, unchanged>
) ranked
WHERE turn <= $sliceHint
ORDER BY turn, available_at, run_id
LIMIT $batch
```

`ORDER BY turn` first is the whole mechanism: every tenant's first eligible run
precedes any tenant's second. A tenant with a thousand ready runs contributes
one before contributing two.

**The cost is real, and measuring it corrected two claims an earlier revision of
this note made from reasoning alone.** Measured on PostgreSQL 17.10 against a
table shaped like `durable_runs` with the same index, one noisy tenant holding
50,000 ready runs and 200 quiet tenants holding one each:

| Query                                      | Plan                        | Rows scanned | Time        |
| ------------------------------------------ | --------------------------- | ------------ | ----------- |
| current, real predicate                    | Seq Scan + top-N heapsort   | 50,200       | 16.0 ms     |
| ranked, real predicate                     | Seq Scan + Sort + WindowAgg | 50,200       | 42.7 ms     |
| current, single state                      | **Index Only Scan**         | **64**       | **0.09 ms** |
| ranked, single state, tenant-leading index | Index Only Scan + WindowAgg | 50,200       | 21.5 ms     |

**Correction 1: a window function _can_ stop early.** PostgreSQL 15 added run
conditions for monotonic window functions, and the plan confirms it —
`Run Condition: (row_number() OVER (?) <= 8)` — emitting 208 rows from 50,200.
What cannot stop early is the scan and sort _beneath_ the WindowAgg, because
every partition must be visited to know its first rows.

**Correction 2: the existing query does not stop at 64 either.** With the real
predicate it seq-scans all 50,200 rows. The `OR` between the two eligibility
branches defeats `durable_runs_claim_idx`. Only the single-state form uses the
index and stops at 64.

_That single-state figure is not the fix, and an earlier revision of this
paragraph presented it as one._ Comparing the shipped `OR` against a
single-state probe compares two different queries; the section below measures
the shipped predicate against a shape that answers the same question, and the
usable figure is **31×**, not the 170× this paragraph once claimed.

So admission is _already_ backlog-proportional, before any fairness change. That
strengthens rather than weakens the point below: backlog refusal is not merely
what funds fair admission, it is what the current query needs too.

**A separate finding, independent of fairness — and the first attempt to state
it was wrong three ways.** An earlier revision claimed a two-branch `UNION ALL`
would fix admission at 16.0 ms against 0.09 ms, 170×. Measuring it disproved
that, so here is what the plans actually show, on 50,000 ready runs with both
shipped indexes present:

| Predicate shape                  | Plan                                    | Rows scanned | Time        |
| -------------------------------- | --------------------------------------- | ------------ | ----------- |
| shipped `OR`                     | Seq Scan                                | 50,000       | 13.07 ms    |
| two-branch `UNION ALL`           | Seq Scan + one Index Scan               | 50,000       | 13.29 ms    |
| **three index-ordered branches** | **Merge Append over three Index Scans** | **64**       | **0.42 ms** |

Two branches do not help, because `state IN ('delayed','ready')` is itself two
index ranges and PostgreSQL cannot walk them in `available_at` order from one
scan. **Each state needs its own branch**, and the planner then produces a
`Merge Append` that pulls in order across all three.

**"Stops at the limit" is true of the Merge Append and not of every branch under
it.** Re-measured with 640 expired-lease `running` rows present — the ten
instances × batch 64 ceiling — the plan is a `Merge Append` feeding a `Limit`,
but only the `available_at`-ordered branches arrive pre-sorted:

- `state = 'ready'` — `Index Scan using durable_runs_claim_idx`, stops after one
  row.
- `state = 'running'` — a **quicksort** over the matching rows, because the
  branch filters on `lease_expires_at` while the Merge Append needs
  `available_at` order, and `durable_runs_lease_idx` is
  `(application_name, state, lease_expires_at)` (`internal-protocol-v4-sql.ts:100`).
  No shipped index supplies that order.

Total was 0.299 ms, so the rewrite's conclusion survives intact. What does not
survive is the implication that all three branches stop early: the `running`
branch's cost is proportional to the number of expired leases, not bounded by the
limit. That is cheap at the ceiling this fixture models and worth knowing before
someone assumes it is bounded.

The real figure is **31×**, not 170×, and the 0.09 ms in the earlier revision
came from a different query entirely — a single-state probe with
`cancellation_requested` added to the index — not from any `UNION ALL`.

Two things this rules out along the way, both tested rather than assumed:
`NOT cancellation_requested` does **not** defeat the index (single-state with it
still stops at 64, 0.31 ms), and adding that column to the index is a modest
win, not the fix (0.31 ms → 0.10 ms).

It is a defect in admission as shipped and it belongs to whoever touches the
claim predicate next.

**The sequencing reason an earlier revision gave is contradicted by this
record's own tables.** It said the rewrite "should land before fairness is
measured or the fairness number carries the `OR`'s cost". But the ranked query
scans every eligible row in all measured variants — 50,200 rows at 42.7 ms with
the shipped index and 21.5 ms with a tenant-leading one — for the reason stated
two paragraphs up: the scan and sort beneath the WindowAgg cannot stop early,
because every partition must be visited to know its first rows. The three-branch
rewrite's entire benefit is an ordered `Merge Append` that stops at the limit,
and ranking removes the stopping. Once fairness lands there is no `OR` cost left
for it to carry.

Sequencing it first may still be right — a clean baseline, and a predicate the
next slice inherits rather than rewrites — but those are the reasons, and the
measured one was not.

**This is where the three axes stop being independent.** Backlog refusal at
acceptance is what makes the ranking scan affordable — it is the bound on the
set the window function must read. Implemented alone, fair admission's cost
grows without limit; implemented alone, backlog refusal protects storage but
not share. They are one mechanism with three surfaces, which is the concrete
form of the decision record's "do not split them across slices."

`$sliceHint` bounds how many runs one tenant contributes to a batch. An earlier
revision justified it on planner grounds — "it exists only to let the planner
discard ranks that cannot reach the batch" — and measurement shows that is the
weaker half of the story, stated as the whole of it.

Measured on 50,200 ready runs across 201 tenants, varying only the filter:

| Filter         | Rows the WindowAgg emits | Time    |
| -------------- | ------------------------ | ------- |
| `turn <= 8`    | 208                      | 21.1 ms |
| `turn <= 1000` | 1,200                    | 19.3 ms |
| none           | 50,200                   | 36.0 ms |

So the filter's **presence** matters — removing it nearly doubles the query, and
the run condition genuinely prunes the emission. Its **value** does not: 8 and
1,000 are within noise of each other, and the larger bound was marginally
faster. The scan and sort beneath are unchanged in all three.

**So the hint is derived from the batch — and the value is `sliceHint = batch`,
not something smaller.** An earlier revision said the hint "is the bound on one
tenant's contribution to a round: too large and a noisy tenant reclaims the batch
it was meant to share, too small and the batch cannot fill." The second half is
right and the first half is wrong, and measurement settles both.

**The hint has no fairness role.** `ORDER BY turn` does all of it, which this
record already said two sections up and then did not follow through. Measured on
the 50,000-plus-200 fixture, batch 64, counting how many of the 64 admitted rows
belong to quiet tenants:

| Admission            | Quiet tenants admitted |
| -------------------- | ---------------------- |
| unranked (today)     | **0**                  |
| ranked, `turn <= 8`  | **63**                 |
| ranked, `turn <= 64` | **63**                 |

Identical. A larger hint does not let the noisy tenant reclaim the batch, because
every tenant's `turn = 1` sorts ahead of its `turn = 2` regardless of where the
filter sits. The hint prunes emission; it does not allocate share.

**A hint below the batch starves the low-tenant-count case, and that case is a
scenario that passes today.** With one eligible tenant holding 64 ready runs,
`turn <= 8` admits 8 and `turn <= 64` admits 64 — measured, same fixture. That is
exactly the shape of `tests/load/beta08-worker-contention.ts`: `runs = 64`,
`workers = 8` (`:18`–`:19`), every execution passing one `companyId` (`:42`) which
becomes the tenant at `fixtures/collaboration/src/execution.ts:64`, each worker
built with `claimBatch: 64` (`:57`). It polls `Math.ceil(64 / 64) + 1 = 2` rounds
(`:63`) and requires all 64 to have succeeded (`:88`). At `sliceHint = 8` the
fleet would claim 8 per round and finish 16 of 64, failing an assertion that
passes today.

Cost does not argue against the larger value: 27.8 ms at `turn <= 64` against
25.3 ms at `turn <= 8` on the same fixture, with the run condition still pruning
in both.

**So: `sliceHint = claimBatch`.** It preserves fairness exactly, it can never
starve a batch that today fills, and it keeps the emission pruning the filter
exists for. What would overturn it: a fixture where a single tenant's turn-N rows
crowd out a tenant that becomes eligible mid-round — which this ordering cannot
produce, since eligibility is re-evaluated per admission call.

## 2. Per-tenant in-flight concurrency

The claim is per run with `FOR UPDATE SKIP LOCKED`
(`postgres-kernel.ts:421`), and it is the only fenced point where in-flight
count can be decided, because it is the transaction that creates the attempt.

A cap needs to count a tenant's `running` runs. **`tenant_id` is in no index** —
the three on `durable_runs` are `(application_name, state, available_at,
run_id)`, `(application_name, state, lease_expires_at)`, and
`(application_name, resource_identity, state)`
(`internal-protocol-v4-sql.ts:98`–`:103`).

**That does not make a schema addition necessary, and an earlier revision of this
sentence concluded it did — directly above the measurement that refutes it.** The
count filters `state = 'running'` first, which `durable_runs_lease_idx` serves
through its `(application_name, state)` prefix; `tenant_id` is then a filter over
the matching rows, not a search key. So `(application_name, tenant_id, state)` is
**optional**, BETA-10 owns the decision rather than the obligation, and what the
index actually buys is measured below rather than assumed here.

**An earlier revision of this section measured this wrong, and the wrong table
was the argument for the index.** It reported the unindexed count as a Seq Scan
examining 50,016 rows at 4.704 ms, concluded "65× more", and said the cost
"scales with the backlog rather than with the cap". Re-measured on PostgreSQL
17.10 against a `durable_runs`-shaped fixture carrying exactly the three shipped
indexes, `ANALYZE`d — 50,000 ready runs and 16 running for one tenant, 200 quiet
tenants:

```
Index Scan using durable_runs_lease_idx  (rows=16, Buffers: shared hit=3)
  Index Cond: (application_name = 'app' AND state = 'running')
  Filter: (tenant_id = 'noisy')
Execution Time: 0.083 ms
```

**The shipped index already answers this count.** `durable_runs_lease_idx` is
`(application_name, state, lease_expires_at)` (`internal-protocol-v4-sql.ts:100`),
and its `(application_name, state)` leftmost prefix serves `state = 'running'`
directly, so the 50,000-row backlog is never touched. There is no Seq Scan, no
65×, and the backlog is not what the cost scales with.

**What the cost does scale with is fleet-wide in-flight work**, which is what
this record's own judgment call said all along — and the table contradicted it.
Measured on the same fixture by adding 5,000 _other_ tenants' running runs:

| Fleet-wide in-flight | Shipped indexes only           | With `(application_name, tenant_id, state)` |
| -------------------- | ------------------------------ | ------------------------------------------- |
| 16                   | 0.083 ms (Index Scan, 16 rows) | 0.086 ms — no measurable gain               |
| 5,016                | 0.650 ms (Bitmap, 5,016 rows)  | 0.090 ms                                    |

So the honest case for the schema addition is **7× at 5,016 fleet-wide in-flight
runs, both sub-millisecond**, and nothing at all at the scale the shipped bounds
actually permit. It decouples one tenant's admission cost from every other
tenant's load, which is an isolation argument, not a performance one.

**And the old fixture was outside the shipped envelope.** Sixteen runs in flight
for one tenant requires sixteen concurrent workers on that tenant, because
`worker.ts` claims and runs sequentially — `for (const admission of admissions)`
with `await runAttempt(...)` inside (`packages/runtime/src/durable/worker.ts:284`,
`:334`). One worker runs one attempt at a time, so per-tenant in-flight is
bounded by worker count, not by `claimBatch`, and ADR-0017's conformance target
is ten instances.

**That weakens this axis enough to hand BETA-10 a different question.** Not "how
do we make the count cheap" — it already is — but "does a per-tenant in-flight
cap bind at all below ten instances, and is decoupling from fleet-wide in-flight
worth an index." What would settle it: a fleet-wide in-flight figure from the
ten-instance fixture. If it stays in the hundreds, this axis is theoretical.

**Rejected: a per-tenant counter row.** It would avoid the count, and it would
serialize every claim for a tenant on one row. That converts a
`SKIP LOCKED`-based design, chosen precisely so workers never block each other,
into one with a contention point per tenant.

**Measured, because rejecting an option on an asserted cost is how a wrong
rejection survives.** Sixteen concurrent claim-shaped transactions against
PostgreSQL 17.10, each holding for 2 ms, driven concurrently from one client:

| In-flight check                                           | 16 concurrent |
| --------------------------------------------------------- | ------------- |
| indexed count over `(application_name, tenant_id, state)` | **6.7 ms**    |
| `UPDATE` of a per-tenant counter row                      | **63.6 ms**   |

The rejection holds, and the shape confirms the mechanism rather than merely the
verdict: 16 × 2 ms of hold is ~32 ms of pure serialization, and 63.6 ms is that
plus per-transaction overhead. The counted reads do not block each other and
finish in roughly one hold time. **9.5× at a 2 ms hold, and it worsens as the
hold grows** — a real claim transaction writes an attempt row and a lease, so it
holds longer than this probe does.

_A first attempt at this measurement was discarded._ It spawned sixteen
`docker exec` processes and reported the counter as marginally **faster**, which
is process-startup time swamping a 2 ms hold — a measurement answering a
different question than the one asked, which is the same failure this repository
keeps blocking tests for. Driving the concurrency from one client removed the
spawn cost from the comparison.

## 3. Backlog refusal at acceptance

The decision record settled that backlog is refused inside the Mutation
transaction, so the business write rolls back with the dispatch. The insert
already runs there (`acceptance.ts:58`, `ON CONFLICT DO NOTHING`), so the
refusal is a count against the same new index before it.

**The cap is approximate under concurrency, and it was measured rather than
assumed.** Under READ COMMITTED two Mutations accepting for the same tenant can
both observe a count below the cap and both insert. Ten concurrent accepts
against a cap of five, on PostgreSQL 17.10:

| Isolation      | Window between check and insert | Rows admitted |
| -------------- | ------------------------------- | ------------- |
| READ COMMITTED | realistic (adjacent statements) | **6**         |
| READ COMMITTED | widened to 200 ms               | **10**        |
| SERIALIZABLE   | realistic                       | **3**         |

Three things follow, and only the first was expected.

**The realistic overshoot is small.** One row past a cap of five, not the
doubling a contrived window suggests. The cap behaves as a guard, which is what
it is for.

**The window width dominates.** Widening the gap between the count and the
insert to 200 ms took the overshoot from one row to five. So the implementation
constraint is concrete: **the count must sit adjacent to the dispatch insert**,
not at the top of a Mutation that then does other work. Overshoot scales with
whatever runs in between.

**SERIALIZABLE is worse, not stricter.** It admitted _three_ — fewer than the
cap — because conflicting transactions abort with serialization failures rather
than being cleanly refused. That converts a one-row overshoot into transient
errors the Mutation caller must retry, on the write path, to make a coarse guard
precise. An advisory lock per tenant has the same shape of cost by serializing
that tenant's acceptance.

So the decision stands and now has evidence behind it: a backlog cap is a guard
against unbounded growth, not an invariant, and claiming exactness it does not
have is the failure mode this project keeps blocking on.

## The precondition this mechanism assumes, stated because it is not enforced

Fair admission gives each _eligible tenant_ a share of the batch. Nothing bounds
how many tenants one actor can be eligible under.

`tenant_id` is `text NOT NULL` with no cardinality constraint
(`internal-protocol-v4-sql.ts:20`), and its value comes from the author's resolve
step — `tenant: resolved.tenant`
(`packages/runtime/src/execution/index.ts:284`), typed at `:36` from whatever the
Execution resolved. The collaboration fixture derives it from a membership row,
`context.tenant({ id: membership.companyId })`
(`fixtures/collaboration/src/execution.ts:64`), which bounds it to the companies
a Principal actually belongs to. **That is an application property, not a
framework guarantee.**

So the mechanism bounds runs per tenant, not tenants per actor, and its
completeness as an answer to a noisy neighbour depends on tenants being
expensive to obtain. Where an application resolves a caller-supplied value into
`tenant`, one actor gets N shares for N values.

**The decision is to state this as a precondition rather than to close it here**,
and the decision record already points the same way: it places the request axis
outside this mechanism and names a quota engine as a non-goal. Enforcing tenant
cardinality would be admission control on the request axis wearing a fairness
mechanism's clothes.

What would overturn it: an accepted contract requiring `tenant` to be derived
from stored authorization data rather than from Execution input, which would make
the bound a framework property and worth asserting. Until then the honest
reading of this record is "fair share among the tenants that exist", and the
sentence "they are one mechanism with three surfaces" describes the durable axis
only.

## What must not be built

- **Group partitioning as a fairness mechanism.** One group per tenant
  serializes that tenant to one concurrent run, protecting the small tenant by
  crippling the large one. Ordering and fairness key on the same column and are
  opposite in effect; the decision record keeps them separate and this note does
  not reopen it.
- **Any cross-instance counter, token bucket, leader, or broker as the authority
  for share.** ADR-0017 names two of the four directly — "a singleton
  application, scheduler, queue, or realtime leader" and "mandatory Redis,
  broker, Pusher, or cache state as durable truth"
  (`docs/adr/0017-freeze-multi-instance-and-optional-acceleration.md:93`–`:94`).
  A cross-instance counter or token bucket is the second of those under another
  name once it holds share authority. Share must be a property of the claim
  predicate, decided in PostgreSQL, or it is not correct under ten instances.
- **A tenant-first listing anywhere.** Until the new index exists, `tenant_id`
  cannot drive a query; afterwards it can, but only on `(application_name,
tenant_id, state)` order.

## Evidence this needs

BETA-10 already owns the ten-instance fixture and the stable-runner budgets,
which is why the decision record placed the mechanism there. Three assertions
are specific to fairness and do not exist in that harness yet:

1. **Distribution, not throughput.** With one tenant holding a large backlog and
   several holding one run each, every small tenant is admitted before the large
   tenant's second run. Assert the admission order, not the elapsed time. The
   probe above already shows the shape this must reproduce in the real harness:
   of 64 admitted rows, the unranked query gave quiet tenants **0** and the
   ranked query gave them **63**.
2. **Falsify against the unranked predicate.** Restore `ORDER BY available_at,
run_id` and the same scenario must fail with the small tenants starved.
   Without that, the test proves only that the query still returns rows.
3. **Cost under a bounded backlog.** Measure admission latency at the backlog
   cap, since that is the bound the ranking scan actually pays. Deriving the
   budget from a scenario with an empty backlog would measure nothing.

## Judgment calls

**Ranking in SQL rather than admitting more and filtering in the worker.** A
worker could over-admit and drop, which needs no window function. Taken because
over-admission is itself the unfairness — the rows a worker discards were still
claimed against the batch, and under ten workers each over-admitting, the large
tenant wins by volume. What would overturn it: measurement showing the ranked
scan is unaffordable even at the backlog cap, in which case the cap is the thing
to lower.

**Requiring a new index rather than deriving in-flight count from the existing
ones — OVERTURNED by its own stated condition.** The original call read:
`(application_name, state, lease_expires_at)` could enumerate running runs and
filter tenant in memory, at a cost proportional to total in-flight work rather
than to one tenant's; taken because the whole point is isolation, and a
per-tenant decision whose cost scales with other tenants' load reintroduces the
coupling it removes. **What would overturn it: total in-flight work proving small
enough in practice that the distinction is theoretical.**

That condition is now met by measurement. At 16 runs in flight fleet-wide the
shipped `durable_runs_lease_idx` answers the count in 0.083 ms and the proposed
index gives no measurable gain; at 5,016 — far above what the shipped bounds
permit, since `worker.ts` runs one attempt at a time and ADR-0017 targets ten
instances — it is 0.650 ms against 0.090 ms. Both sub-millisecond.

The isolation argument stays true and stops being decisive: the cost does scale
with other tenants' load, and the magnitude of that coupling is immaterial at
every reachable scale. So the index is **optional**, and this record no longer
asks BETA-10 to add one.

Recorded this way rather than quietly edited, because a judgment call that names
what would change its mind and is then changed by exactly that is the case the
practice exists for. What would overturn the reversal: a fleet-wide in-flight
figure from the ten-instance fixture landing in the thousands, which would need
either many more instances or a worker that claims concurrently.

## BETA-10 shipped it, by a different mechanism than this note proposed

BETA-10 merged at `8787e870` (#329) and shipped per-tenant fair admission. This
note was written as design work for a slice that had not started; that framing
is now closed, and the parts below are reconciled against the merged tree rather
than predicted.

**What shipped.** `admit()` wraps the eligible set in a CTE and orders by a
window function: `row_number() OVER (PARTITION BY tenant_id ORDER BY
available_at, run_id) AS tenant_turn`
(`packages/runtime/src/durable/postgres-kernel.ts:365`), then `ORDER BY
tenant_turn, available_at, run_id` before `LIMIT`
(`:378`). A hostile test pins the statement text
(`tests/hostile/beta10-compatibility.test.ts:43`). The same rewrite added a
fleet-compatibility fence on `executable_digest`.

**Which of this note's three parts shipped: one.** The claim predicate rewrite
over `durable_runs_claim_idx`'s `(application_name, state)` leftmost prefix did
**not** ship, and the section below explains why it could not have. The
per-tenant in-flight cap did **not** ship — no such symbol exists in the durable
path. Backlog refusal at acceptance did **not** ship;
`packages/runtime/src/durable/acceptance.ts` is 108 lines and contains no
refusal, cap or backlog term.

### Measured against the merged tree

PostgreSQL 17, 200,000 eligible rows in one application, two tenants split
199,000 / 1,000, batch 32. `EXPLAIN (ANALYZE, BUFFERS)`, scratch schema.

| Query                                                                       | Execution  | Sort                               |
| --------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| pre-BETA-10 `admit()`, verbatim at `2de4cb23`                               | 45.993 ms  | top-N heapsort 33 kB               |
| digest fence added, no window                                               | 60.794 ms  | top-N heapsort 33 kB               |
| **shipped BETA-10 `admit()`**                                               | 294.259 ms | external merge, **11,768 kB disk** |
| shipped, `work_mem = 64MB`                                                  | 288.948 ms | quicksort 17,082 kB, in memory     |
| shipped, plus a `(application_name, tenant_id, available_at, run_id)` index | 251.794 ms | external merge 9,208 kB            |
| shipped, 2,000 eligible rows                                                | 1.876 ms   | —                                  |

**Fairness works.** On the 199:1 backlog the 32-row batch came back 16 rows to
each tenant. The mechanism does what it was built to do.

**The premise this note argued from was already false, and the measurement is
how I found out.** This note proposed rewriting the claim predicate to exploit
`durable_runs_claim_idx`, which is `(application_name, state, available_at,
run_id)`
(`packages/compiler/src/schema/postgres/internal-protocol-v4-catalog.ts:526`),
so that `LIMIT` could stop early. The pre-BETA-10 query already did not do that:
it planned a **Parallel Seq Scan over all 200,000 rows** with a top-N heapsort.
Reading the plan against the predicate, the reason is the `OR` — eligibility is
`(state IN ('delayed','ready') AND available_at <= now)` **or** `(state =
'running' AND lease_expires_at <= now)`, which spans `available_at` and
`lease_expires_at`, two different columns, so no one ordered index scan
satisfies it. **BETA-10 did not introduce the full scan. It added a full sort on
top of a scan that already read every eligible row**, and the honest statement
of its cost is the sort, not the scan.

**Two remedies tested, both negative.** Raising `work_mem` to 64 MB removes the
disk spill entirely — `quicksort  Memory: 17082kB` instead of `external merge
Disk: 11768kB` — and buys 5 ms of 294. The spill is not the cost; sorting
200,000 rows is, in memory or not. Adding the tenant-ordered index the window
function would seem to want does not change the plan either: the planner ignores
it and still sequentially scans, because it must read every row regardless of
order. Neither knob is the answer, which is worth recording before someone
reaches for one.

### What this changes for the record, and what would overturn it

The cost is linear in the eligible backlog and negligible until the backlog is
large: 1.876 ms at 2,000 rows, 294 ms at 200,000, once per worker poll cycle
(`packages/runtime/src/durable/worker.ts:280`). That was recorded as an
uncomfortable shape rather than a defect, because the backlog sizes where the
sort costs real time are exactly the ones where fairness is worth paying for.

**That characterisation is too gentle, and the same numbers say why.** A poll
admits at most `claimBatch` runs — 64 by default
(`packages/runtime/src/durable/worker.ts:120`) — whatever the call costs. So the
admission ceiling is `claimBatch / cost`:

| eligible backlog | `admit()`  | ceiling         |
| ---------------- | ---------- | --------------- |
| 2,000            | 1.876 ms   | ≈ 34,100 runs/s |
| 200,000          | 294.259 ms | ≈ 217 runs/s    |

**The service rate falls as the queue grows** — 157× fewer runs admitted per
second at the larger backlog. A queue whose service rate decreases with its own
length has no stable equilibrium above the point where arrivals exceed that
falling rate: past it, the backlog grows, admission slows, and the gap widens.
Linear cost in the backlog is not merely expensive at scale; it removes the
system's ability to catch up.

This is the same shape the statement-timeout gate catalogues for retention and
reconciliation — work whose failure or slowness enlarges its own next attempt —
arriving here through cost rather than through a timeout. **It is also the
sharpest argument for the backlog refusal that did not ship**, since a bound on
the eligible set is what keeps the service rate flat.

**What would overturn it.** These are single measurements at two backlog sizes on
a warm local container, and the ceiling above assumes admission dominates a poll
cycle. If claiming, running attempts and the rest of the cycle cost far more than
`admit()` at both sizes, the 157× applies to a small share of the cycle and the
instability argument weakens to a cost argument. Nothing here measures the rest
of the cycle.

**The two parts that did not ship are what would bound the part that did.**
Backlog refusal at acceptance limits how many rows can be eligible at once, and
a per-tenant in-flight cap limits how much of a batch one tenant can hold. Either
bounds the eligible set that the window function must sort. Shipping fairness
first and admission control later means the mechanism is at its most expensive
in precisely the case it was added for.

**What would overturn this.** A backlog that never approaches these sizes in the
ten-instance fixture would make the whole measurement academic — the numbers
above are from a synthetic 200,000-row table, not from the fixture, and I did not
run the fixture. A measurement from `tests/load/beta10-ten-instance.ts` showing
the eligible set staying in the low thousands would reduce this from a cost to a
footnote.
