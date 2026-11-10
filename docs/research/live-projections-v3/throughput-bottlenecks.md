# Throughput opportunities from existing SaaS evidence

Research only, 2026-10-23. Prioritize repeated authorization work, invalidation/refetch amplification, and exact durable admissions before infrastructure changes. These are ranked investigation opportunities, not measured speedups. No benchmarks, tests, type checks, builds, servers, or runtime changes were performed; all future experiments remain deferred.

## Evidence and version boundary

Primary evidence: [post-topology-fix raw results](../ephemeral-broadcast/saas-topology-after.json), [four-CPU raw results](../ephemeral-broadcast/saas-4cpu.json), [projection-tuned raw results](../ephemeral-broadcast/saas-projection-tuned.json), and their [workload report](../ephemeral-broadcast/saas-load.md). The first two record `runtimeCommit: 52fb28ff70fc5e090fcc8abdff4feb3912a7bf42` and identical `sourceSha256` maps. Those hashes matter: the measured topology coordinator has SHA-256 `933e382a0ced060e417f9992885835755bc2d97b1dfc476e71c22e785f6b7a1e`, differing from that commit's blob; fixture files also differ. The commit label alone cannot reproduce the measured tree. The projection-tuned artifact records older runtime `da944cdf678fc7bf0113599164afba13004fcfaf` and fixture hashes.

None measures the coordinator's published-3.40 baseline or current source, inspected at HEAD `9791f7d3917cc8f5f2ca34d366dbfefa93d56649`. The local [core manifest](../../../packages/questpie/package.json) says `3.39.0`; release identity must not be inferred from it. Dirty, unshipped admission microbatch changes are separate from both committed source and historical measurements. This note reads the committed admission path, not that candidate implementation.

The historical fixture uses two Bun web processes, twenty tenants, and real HTTP/SSE. The post-fix profile offers 30 seconds of input and records 32.862 seconds including completion/tail. PostgreSQL's two-CPU/1-GiB limit comes from the report; that artifact leaves `databaseLimits` null. The four-CPU artifact explicitly records `4CPU/1GiB` and disk-overlay/fsync-on storage. Twelve reported host CPUs are not the container allowance.

## 1. Reduce repeated fresh-fact work within an owned evaluation

**Observed:** the post-fix 1,000-user profile records **59,719 RBAC queries, 59,651 session queries, and 35,040 recursive ancestor queries**. Their aggregate PostgreSQL execution times are respectively 8,180, 3,712, and 2,029 ms. These are expensive through volume; individual average execution is sub-millisecond. They are not measurements of request wall latency or pool wait, and `topSqlByTime` retains only twelve statements. Summing those twelve cannot establish percentages of the entire database workload.

The [fixture](../../../packages/questpie/bench/saas-app.ts) resolves current sessions, active memberships/bindings/roles, and page ancestry. Its separate `saas-auth` pool has **max 12 per pod**, and also serves application reads. The core pool has **max 16 per pod**; the [generator](../../../packages/questpie/bench/saas-load.ts) has another max-4 pool. `authPoolWaitingMax` samples `pool.waitingCount` every 500 ms and is a process-lifetime maximum, including startup. Post-fix maxima **1,218/1,180** mean queued connection acquisitions, not executing SQL, query duration, or a latency percentile. This supports investigating work volume before enlarging pools.

**Hypothesis:** combine compatible fact reads and reuse raw facts only inside one owned evaluation, identity, and database snapshot. Never reuse a cached “yes” permission across refreshes, principals, revocations, or snapshots. [RequestScope](../../../packages/questpie/src/server/config/request-scope.ts) memoizes service instances; it does not automatically cache their query results.

**Already present:** the [HTTP adapter](../../../packages/questpie/src/server/adapters/http.ts) defers context extensions for query routes, and [LIVE refresh](../../../packages/questpie/src/server/adapters/routes/realtime.ts) passes `deferContextExtensions: true`. The [executor](../../../packages/questpie/src/server/routes/execute.ts) derives facts on its owned read-only repeatable-read snapshot, alongside access, handler reads, and output validation. Do not propose repairing a supposedly still-existing double HTTP fact resolution from an older report.

## 2. Reduce invalidation → authorized HTTP refetch amplification

**Observed:** the post-fix run has **600 ledger inserts**, **29,998 received activity frames**, **3,000 base list requests**, and **18,748 refetch latency samples**. Thus the sample-based ratios are **31.247 extra HTTP reads per semantic event** and **6.249 times the base list count**. The raw `refetch:200` status counter is **18,765**, yielding **31.275/event** and **6.255/base list**. Preserve this counter discrepancy rather than presenting 18,748/600 as 31.275.

The fixture emits `list.changed` every fifth save. The generator turns each received durable event into a POST to `bench/list`, suppressing concurrent refetches per client. These counts therefore describe run-wide fan-out after suppression, not an invariant multiplier for every event. Every extra request repeats session/RBAC and projection work. The four-CPU run records 24,586 refetch 200s, showing that accepting more work can expose more downstream demand.

**Hypothesis:** dependency-aware LIVE projections and bounded latest-state coalescing could remove redundant round trips and evaluations. Preserve ordered durable events and required final-state coverage; replacing application refetch semantics requires an explicit contract. This is not evidence that all invalidations or authorization checks can be dropped.

## 3. Amortize durable admission overhead without weakening cuts

**Observed:** post-fix SQL contains **60,000 fence `SELECT … FOR SHARE` calls**, about two per received activity frame. In committed [fence admission](../../../packages/questpie/src/server/modules/core/integrated/realtime/channel-authority-fence.ts), one transaction locks the channel coordinator and the exact subject, then compares its expected generation. The committed [ledger](../../../packages/questpie/src/server/modules/core/integrated/realtime/channel-event-ledger.ts) invokes that path per authorized local frame. The counts are consistent with approximately **30,000 admission transactions**, not 60,000 transactions; received frames are not a perfect transaction counter.

**Hypothesis:** bounded admission batches might amortize transaction/round-trip costs. Keep exact channel/subject generations, independently checked attempts, and revocation cuts; later arrivals cannot inherit an earlier admission. Preserve owned-transaction boundaries and fail closed on absent/moved fences. Publish only owned synchronous admission state under locks; sink writes and external I/O stay outside them so revocation cannot wait on a slow reader. Dirty microbatch work is unshipped and unmeasured here, not an established improvement.

## 4. Design safe opt-in compute sharing for route LIVE

**Observed:** projection-tuned results already use explicit equivalent-output **collection** sharing, selected list columns, covering indexes, and correlated-column statistics. At 250 users the control saves have p95 43 ms; awareness raises it to 610 ms with 10,131 skipped inputs. Multiple changes and shared-host conditions prevent attribution to sharing alone.

Current [refresh scheduling](../../../packages/questpie/src/server/modules/core/integrated/realtime/refresh-scheduler.ts) deliberately gives each coherent route binding a unique group key. Route compute sharing is **not implemented**. Adding `accessCacheKey` to arbitrary handlers is not a low-risk fix: handlers may depend on request, actor, services, clock, field rules, and output hooks.

**Design hypothesis:** isolate immutable data computation where possible. Full shared-route snapshots need proven byte-identical outputs and preservation of authority and data in the same snapshot. Each binding still needs fresh verified principal authorization, admission/revocation handling, and rejection of stale frame adoption before authorization. A grouping/cache key is never an ACL. [Route dependency declarations](../../../packages/questpie/src/server/routes/live.ts) do not themselves prove output equivalence.

## Already fixed; infrastructure remains secondary

[Topology renewal](../../../packages/questpie/src/server/modules/core/integrated/realtime/topology-coordinator.ts) already batches up to 1,000 exact owner/generation lease pairs and prevents overlapping heartbeats. [Packet packing](../../../packages/questpie/src/server/channels/ephemeral-wire.ts) already serializes entries individually rather than repeatedly serializing a growing batch. Do not count either as a future optimization.

The post-fix profile has zero closes and 1,900/1,900 final sequences, but skips **53,719/60,000** cursor opportunities; delivery p95 is **2,713 ms**. Four CPUs still skip **52,191/60,000**, with p95 **2,354 ms**. These are overloaded profiles, not 1,000-user capacity or controlled speedup claims. Broker publish p95 remains roughly 17–21 ms with zero failures and zero sampled queue usage. WAL wait sample counts indicate observed states, not wait durations. More CPU or Redis alone does not remove repeated authorization, admission transactions, or HTTP fan-out. Deferred experiments should measure those mechanisms separately while retaining correctness boundaries.

## Primary documentation for interpreting the counters

The [node-postgres pool API](https://node-postgres.com/apis/pool) defines `waitingCount` as queued requests waiting for an available client. Its [pool-sizing guidance](https://node-postgres.com/guides/pool-sizing) requires considering connections across all service instances. PostgreSQL's [pg_stat_statements reference](https://www.postgresql.org/docs/17/pgstatstatements.html) distinguishes execution statistics from optional planning statistics; neither supplies application pool wait or end-to-end delivery time. These definitions support the interpretation above, not a diagnosis of every second of historical latency.

## Separate AP evidence: indexed acquisition still grows behind a fixed SQL count

Coordinator-supplied AP S3 head `84120414`, installed QUESTPIE **3.35.7**, uses the AP canonical conversation policy seam from #329/#332. This is domain evidence, not a 3.40 regression or capacity result. Read-only inspection verified all **19** records in `/var/tmp/whol1194-supervisor318-841-db/my-live-runs-sql-plans.jsonl`: 3,667,530 bytes, SHA-256 `a1fa85cd2da4fb9353704fec3f4d87d9a1b6500d18d2cb5f25164cae11812d5d`. The adjacent `plan-summary.json` retains `totalBudgetStatus: UNMEASURED_NOT_ADMITTED`; complete capture does not mean the M5 work budget passed. Files are existing host artifacts, not committed evidence added by this research. Reported correctness runs were not rerun here.

The capture boundary runs from fresh Actor scope through raw facts, selection, enrichment, and final Role/Direct-witness closing. It records **28 SQL dispatches for empty results, 40 for marks, 44 for panels**, and up to 58 in growth cases. Plans are default-planner `EXPLAIN ANALYZE` replays, not first-dispatch buffer telemetry.

Selected-Space exclusion growth from 128 to 2,048 keeps **44 dispatches**, while summed scan visits grow **519 → 2,439** and replay shared blocks **222 → 528**. In both records, statement index 18 uses `agent_runs_company_requester_live_idx`; its Run index-scan filter removes **129 → 2,049** rows. Hidden-only results take 28 dispatches but 4,936 summed scan visits and 3,088 shared blocks; that Run node removes 4,669 rows and returns none. These counts expose candidate rejection behind a constant statement count; scan visits and block accesses are not elapsed time, unique pages, CPU, or complete planner work.

This strengthens two independent opportunities: reduce repeated fresh-fact round trips, and improve predicate/index alignment for acquiring eligible rows before top-N. The latter belongs to the **sole S3 author**, already investigating native/index direction. No duplicate policy SQL, arbitrary anchor/candidate cap, new LATERAL API requirement, projection, migration, or S3 query fix is proposed here. LIVE delivery can remove HTTP refetches, but still pays its underlying selection cost on every evaluation. No new benchmark, heavy-work slot, AP writer, or capacity claim follows from this inspection.
