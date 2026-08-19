# Adversarial review: findings raised, and which are still open

Two opposing reviews were run over `statement-timeout-gate/DECISION.md`,
`tenant-share-control/DECISION.md`, and `tenant-share-control/MECHANISM.md` —
one arguing the gate is unnecessary and the mechanism over-engineered, one
arguing the gate is urgent and the mechanism insufficient.

Every finding below was **re-verified against the tree before being recorded
here**; the reports themselves were not taken as evidence. The ones already
acted on are listed for provenance, so a later reader can tell a closed finding
from an open one.

Base: `feat/v4` at `1d1cb53d`.

## Acted on

| Finding                                                          | Commit     |
| ---------------------------------------------------------------- | ---------- |
| Lock-timeout argument stated twice in one section                | `abfec489` |
| Four-item list said "forbids all three", uncited                 | `e666c733` |
| `query.cancel()` leaves the caller pending, not only the backend | `9fa0cfbf` |
| In-flight count table measured the wrong baseline                | `31268fc0` |
| Lock finding is not specific to maintenance                      | `86c0c58b` |
| `executeAbortable` misattributed to compiler code                | `86c0c58b` |
| A database/role default is a second tax-free shape               | `86c0c58b` |
| Same "forbids all three" left standing in the sibling record     | `000ab2a6` |
| `configurePostgresTimeouts` is session-scoped, not callable      | `000ab2a6` |
| Retry horizon pinned and enforced nowhere                        | `e1af84fd` |
| Refused claims write nothing and are re-admitted forever         | `e1af84fd` |
| Both numbers the gate proposed to pin were scope errors          | `1d1cb53d` |
| `sliceHint` below the batch starves the single-tenant case       | `5d472f3d` |
| `OR`-fix sequencing rationale contradicted by own tables         | see item 3 |
| "Stops at the limit" overstated for the `running` branch         | see item 4 |
| The five bare reads are not all operator-facing or unbounded     | see item 2 |
| Three runtime readers of the 5,000 ms, not one                   | see item 5 |

## Open — verified, not yet acted on

**1. CLOSED — a batch-derived `sliceHint` collapses the single-tenant batch.**
Resolved in `MECHANISM.md` by deriving `sliceHint = claimBatch` rather than a
smaller value. Measured: fairness is identical at `turn <= 8` and `turn <= 64`
(63 quiet tenants of 64 admitted, against 0 unranked), because `ORDER BY turn`
allocates share and the filter only prunes emission; and the single-tenant batch
admits 64 at the larger hint against 8 at the smaller. Cost 27.8 ms against
25.3 ms. The finding as originally stated is below, unedited.

**1. A batch-derived `sliceHint` collapses the single-tenant batch.** With
`turn <= 8` and one eligible tenant, a batch of 64 admits 8. That is the shape of
`tests/load/beta08-worker-contention.ts` — 64 runs, 8 workers, all passing one
`companyId` which becomes the tenant. The scenario asserts all 64 complete
within `ceil(64/64)+1 = 2` rounds, so fair admission as recorded would fail an
existing green scenario. `tenant-share-control/DECISION.md` cites that scenario's
330.045 ms against a 2000 ms budget as headroom; the headroom is in elapsed time
and the collision is in completion count, which no budget measures. **This is the
most consequential open item** — it says the mechanism as recorded breaks
something that currently passes.

**2. CLOSED — the wrap is aimed at four bounded reads.**
Verified the predicates: `inspect`, `events`, effects `read`, and `audit` are all
`WHERE application_name = $1 AND run_id = $2`; only `admit` is table-scoped and
it is the scheduler. Corrected in the gate record, which now says its expensive
case is the worklist — a read that does not exist yet. Original below, unedited.

**2. Four of the five bare reads are run-id scoped, not table-scoped.**
`inspect`, `events`, effects `read`, and `audit` are all PK or PK-prefix lookups
for one run. Only `admit` scales with the table, and `admit` is the scheduler,
not an operator surface. The gate justifies wrapping five reads as protecting
"the surface an operator uses against an unhealthy database"; the surface that
would actually be unbounded is the worklist, which does not exist in the tree.

**3. CLOSED — sequencing rationale contradicted by the record's own tables.**
Corrected in `MECHANISM.md`: the ranked query scans every eligible row in all
measured variants, so ranking removes the stopping the three-branch rewrite
buys, and there is no `OR` cost left for fairness to carry. The sequencing may
still be right for other reasons, which the record now states instead. Original
finding below, unedited.

**3. The `OR`-predicate fix is sequenced on a rationale the record's own tables
contradict.** The record says the three-branch rewrite "should land before
fairness is measured or the fairness number carries the `OR`'s cost". But its own
tables show the ranked query scanning every eligible row in all variants, because
the scan and sort beneath the WindowAgg cannot stop early. Once ranking lands
there is no `OR` cost left to avoid. The sequencing may still be right for other
reasons; the stated reason is not one.

**4. CLOSED — "stops at the limit" overstated for the third branch.**
Re-measured with 640 expired-lease `running` rows: the `Merge Append` does stop
at the limit, but the `running` branch reaches it through a quicksort, because
it filters on `lease_expires_at` while the merge needs `available_at` order and
`durable_runs_lease_idx` cannot supply it. Total 0.299 ms, so the rewrite's
conclusion holds; its cost on that branch scales with expired-lease count rather
than the limit. Original finding below, unedited.

**4. "Each state needs its own branch" is stated more strongly than measured.**
Only the two `available_at`-ordered branches stop at the limit. The `running`
branch filters on `lease_expires_at` and sorts on `available_at`, so no shipped
index supplies its order and it top-N sorts every expired lease. The 0.42 ms
conclusion survives; the mechanism claim does not hold for the third branch.

**5. CLOSED — three readers named in the gate record.**
Verified `mutation/postgres.ts:336` before `COMMIT` and
`mutation/collection.ts:199`, `:202` sandwiching the await. All three are
wall-clock assertions around an uninterruptible await. Original below, unedited.

**5. Three runtime readers of the 5,000 ms, not one.** Beyond
`AbortSignal.timeout(5_000)` and `query.cancel()`, there are wall-clock checks at
`packages/runtime/src/mutation/postgres.ts:336`–`:337` and at
`packages/runtime/src/mutation/collection.ts:199`, `:202`. All three are
assertions around an uninterruptible await, so the gate's conclusion holds, but
an implementer needs to know there are three to reconcile.

**6. Pool checkout is unbounded and abort-blind.** `pool.reserve()` at
`packages/runtime/src/mutation/postgres.ts:172`–`:173` takes no signal and runs
after the 5,000 ms timeout is armed at `:159`. Sizing is the host's, but the
_wait_ is framework code and the framework has an abort in hand it does not wire.
A `statement_timeout` bounds the holder, not the queue.

**7. The maintenance audit has no per-run row bound.**
`durable_maintenance_commands` caps no count, and `record()` inserts for rejected
commands from every rejection branch. A `statement_timeout` converts an unbounded
read into a failing one rather than a bounded one.

**8. Fair admission bounds runs per tenant, not tenants per actor.** Nothing
constrains the cardinality of `tenant_id`. Where one actor resolves to many
tenants, fair share gives that actor many shares. Partly a design disagreement —
bounding this edges toward the quota engine the decision names as a non-goal —
but the mechanism reads as a complete answer to a noisy tenant and its
completeness assumes tenants are expensive to obtain.

## What each review conceded

Restraint conceded that the gate's load-bearing measurement is correct and
reproduced it, and that its own best alternative — a database default — is
deployment-time and cannot be guaranteed by the framework. Enforcement conceded
that its own findings undercut its headline: the two cheapest, highest-value
defects it found (items in `durable-evidence-gaps/FINDING.md` §4 and §5) are
untouched by the gate, which damages the claim that the gate is the
highest-value item in the tenant-share record.
