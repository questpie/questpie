# SQL work in one route LIVE refresh

Source inventory, 2026-10-24. Baseline: published source commit `6e64d0f7f76e7fba1db39791bc969885e9fa1e2b`. This inventory ran no database, tests, builds, or load. The setup reduction below is a prepared candidate, not measured execution evidence.

## Count the complete evaluation

Start the interval when the coherent scheduler grants a compute slot. Include fresh identity resolution, snapshot setup, request-derived facts, product access, handler reads, relation/field policies, hooks, and output validation. Report transaction protocol separately from application SQL. End after transaction settlement; record queue wait separately.

Do not count only the handler. Shared durable-outbox polling and channel-frame admission are separate workloads: report their aggregate cost without charging one shared poll independently to every watch.

| Phase           | Source-owned behavior                                                                                                                                          | SQL budget implication                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity        | `subscribeRouteQuery` calls `refreshAdapterContext` with deferred context extensions. The adapter delegates to the configured session resolver or Better Auth. | SQL count depends on the auth implementation and credential path; it is not a fixed framework count.                     |
| Snapshot setup  | `executeQueryRoute` opens an owned read-only repeatable-read transaction, then captures xmin and lowers the local statement timeout in two successive SELECTs. | Two framework setup statements in the baseline. BEGIN/COMMIT are additional driver protocol work.                        |
| Facts           | `deriveRequestContextOnDb` derives marked request facts on the snapshot database.                                                                              | Application-owned queries; retain the transaction boundary. LIVE already defers this resolution during identity refresh. |
| Access and data | `runJsonRoute` evaluates access, handler, and output validation. CRUD adds its own hooks, collection/field access, hydration, and relations.                   | Count all nested reads, including policy and service queries.                                                            |
| Delivery        | The scheduler hashes and delivers the result or an unchanged marker.                                                                                           | Equal output suppresses payload delivery after computation; it does not establish that SQL was avoided.                  |

Relevant source: [route subscription](../../../packages/questpie/src/server/adapters/routes/realtime.ts), [adapter context](../../../packages/questpie/src/server/adapters/utils/context.ts), [query executor](../../../packages/questpie/src/server/routes/execute.ts), [watermark](../../../packages/questpie/src/server/modules/core/integrated/realtime/snapshot.ts), and [scheduler](../../../packages/questpie/src/server/modules/core/integrated/realtime/refresh-scheduler.ts).

## Narrow next candidate: combine snapshot setup

Prepared in `/home/drepkovsky/.t3/artifacts/questpie-live-sql-setup`, branch `fix/live-snapshot-sql-setup`, based on `6e64d0f7`.

Capture `pg_snapshot_xmin(pg_current_snapshot())` and apply the existing transaction-local `set_config` in one first SELECT. Facts, access, and handler execution still follow this statement. Keep the existing 30-second ceiling and preserve any stricter connection timeout. This targets **two setup statements → one**, independent of row count, without reusing another evaluation's data or permission verdict.

The controlled probe currently has two setup SELECTs plus two fact reads. Its new regression requires one setup SELECT plus the same two fact reads: **four → three inside that transaction**. That is not a claim about an authenticated application's total SQL or a measured latency gain.

Prepared verification: baseline executor must fail the new statement-count regression; candidate must pass it, the timeout cases (unlimited, 5 seconds, 45 seconds), existing LIVE/query/preparation tests, and both core type contracts. A separate real-PostgreSQL concurrency/timeout gate remains necessary; no fixture was started. Tests and types are currently unrun pending a finite shared-host admission.

## Further savings need evidence or application choices

- `find` computes totals; use the existing bounded `findRows` contract when the projection needs rows without a total. Do not silently change pagination semantics. See [CRUD execution](../../../packages/questpie/src/server/collection/crud/crud-generator.ts).
- `batchRead` already keeps policy calls proportional to protected field paths rather than rows. The existing three-path fixture performs three grant queries at 10/50/100 rows. It does not automatically combine policies or cache their verdicts. See [regressions](../../../packages/questpie/test/collection/batch-field-access.test.ts).
- The route compute closure already checks binding activity before refreshing identity and before opening its snapshot. Removing canceled scheduler queue entries can reduce retained work and free queue capacity; it must not be advertised as a newly added route SQL cancellation fence.
- Context-fact services and handler services have separate scopes and authority modes. Repeated service construction is a source lead, not proof of repeated SQL. Do not merge privileged scopes to eliminate construction. See [context facts](../../../packages/questpie/src/server/config/questpie.ts) and [service extraction](../../../packages/questpie/src/server/config/app-context.ts).
- Full route sharing remains disabled: equal input or subject does not prove equal facts, access, hooks, or output.

For the final controlled comparison, record SQL count and normalized fingerprints, examined rows/buffers, DB time, queue wait, refresh count per relevant change, and delivered final-state coverage. Include empty/selective results and increasing row counts. A smaller statement count alone is not a bounded-work or capacity proof.
