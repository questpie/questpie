# Per-tenant fair admission: the mechanism BETA-10 inherits

Mechanism note for the three durable axes the tenant-share decision assigned to
BETA-10. It is a note, not an implementation slice: it records the shape, the
costs, and the edges that decide them, so the implementing slice instantiates
rather than rediscovers.

This record writes no production code, opens no slice branch, and changes no
ADR, public projection, gate, or tracker state.

Base: `feat/v4` at `8389cf5f80b1e2a4684dfb00faa10bcd83c93605`.

## What admission does today

`admit(batch)` (`packages/runtime/src/durable/postgres-kernel.ts:455`):

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
index and stops at 64, at 0.09 ms — **170× faster than the shipped shape**.

So admission is _already_ backlog-proportional, before any fairness change. That
strengthens rather than weakens the point below: backlog refusal is not merely
what funds fair admission, it is what the current query needs too.

**A separate finding, independent of fairness.** Splitting the `OR` into two
index-friendly branches — a `UNION ALL` of the ready case and the expired-lease
case — would let each use `durable_runs_claim_idx` and stop early. On this
dataset that is the difference between 16.0 ms and 0.09 ms. It is a defect in
admission as shipped, it belongs to whoever touches the claim predicate next,
and it should be fixed before fairness is measured or the fairness number will
carry the OR's cost.

**This is where the three axes stop being independent.** Backlog refusal at
acceptance is what makes the ranking scan affordable — it is the bound on the
set the window function must read. Implemented alone, fair admission's cost
grows without limit; implemented alone, backlog refusal protects storage but
not share. They are one mechanism with three surfaces, which is the concrete
form of the decision record's "do not split them across slices."

`$sliceHint` is a hint, not a cap: it exists only to let the planner discard
ranks that cannot reach the batch. It must be derived from the batch, not
chosen — a fixed number would be a budget nothing enforces.

## 2. Per-tenant in-flight concurrency

The claim is per run with `FOR UPDATE SKIP LOCKED`
(`postgres-kernel.ts:504`), and it is the only fenced point where in-flight
count can be decided, because it is the transaction that creates the attempt.

A cap needs to count a tenant's `running` runs. **`tenant_id` is in no index** —
the three on `durable_runs` are `(application_name, state, available_at,
run_id)`, `(application_name, state, lease_expires_at)`, and
`(application_name, resource_identity, state)`
(`internal-protocol-v4-sql.ts:98`–`:103`). So this axis requires a schema
addition, `(application_name, tenant_id, state)`, and BETA-10 owns it.

With that index the count is cheap for the reason that matters: it is bounded
by the cap itself plus however many leases have expired but not yet been
reaped. It never scans the backlog.

**Rejected: a per-tenant counter row.** It would avoid the count, and it would
serialize every claim for a tenant on one row. That converts a
`SKIP LOCKED`-based design, chosen precisely so workers never block each other,
into one with a contention point per tenant.

## 3. Backlog refusal at acceptance

The decision record settled that backlog is refused inside the Mutation
transaction, so the business write rolls back with the dispatch. The insert
already runs there (`acceptance.ts:58`, `ON CONFLICT DO NOTHING`), so the
refusal is a count against the same new index before it.

**The cap is approximate under concurrency, and the record must say so.** Under
READ COMMITTED two Mutations accepting for the same tenant can both observe a
count below the cap and both insert. The overshoot is bounded by the number of
concurrent accepters, not by the backlog.

Making it exact costs more than it is worth: an advisory lock per tenant would
serialize acceptance for that tenant, which is a throughput cost on the write
path to make a coarse guard precise. A backlog cap is a guard against
unbounded growth, not an invariant, and claiming exactness it does not have is
the failure mode this project keeps blocking on.

## What must not be built

- **Group partitioning as a fairness mechanism.** One group per tenant
  serializes that tenant to one concurrent run, protecting the small tenant by
  crippling the large one. Ordering and fairness key on the same column and are
  opposite in effect; the decision record keeps them separate and this note does
  not reopen it.
- **Any cross-instance counter, token bucket, leader, or broker as the authority
  for share.** ADR-0017 forbids all three. Share must be a property of the claim
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
ones.** `(application_name, state, lease_expires_at)` could enumerate running
runs and filter tenant in memory, at a cost proportional to total in-flight work
rather than to one tenant's. Taken because the whole point is isolation, and a
per-tenant decision whose cost scales with other tenants' load reintroduces the
coupling it removes. What would overturn it: total in-flight work proving small
enough in practice that the distinction is theoretical.
