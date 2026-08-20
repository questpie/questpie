# BETA-10 fanout, worker, and reconnect report

## Fleet composition

The connected evidence is intentionally layered rather than copying mature
BETA-07 and BETA-08 scenarios into one slow script.

| Concern                                 | Evidence                                                                                                                                                                                                                                                                 | Result                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ten-instance startup and reconciliation | Runtime readiness starts its coordinator before returning (`packages/runtime/src/application/index.ts:179`–`:185`); wake startup immediately requests a scan (`packages/runtime/src/live-query/postgres-wake.ts:109`–`:123`). The BETA-10 load creates ten applications. | The startup race produced a real `40001`, the bounded whole-transaction retry repaired it, and all ten became ready.                                                        |
| Direct and network routing              | `tests/load/beta10-ten-instance.ts:48`–`:84`.                                                                                                                                                                                                                            | 20 direct roots and 20 POSTs succeeded across ten instances.                                                                                                                |
| Concurrent durable workers              | `tests/load/beta10-ten-instance.ts:86`–`:128`; the established 64-run contention workload remains at `tests/load/beta08-worker-contention.ts:54`–`:103`.                                                                                                                 | 40/40 in BETA-10 and 64/64 in the inherited contention case, with zero duplicate attempts.                                                                                  |
| Fanout                                  | `tests/load/beta07-recompute-fanout.ts:188`–`:225`.                                                                                                                                                                                                                      | 2,050 dirty watches recompute in exact waves 1,024, 1,024, 2.                                                                                                               |
| Reconnect after process loss            | `tests/integration/postgres/beta07-generated-live-query.test.ts:397`–`:447`, plus the final assertions at `:516`–`:526`.                                                                                                                                                 | A fresh Runtime accepts the reconnect, delivers the missed update once, and does not surface `TRANSPORT_FAILED`.                                                            |
| Arbitrary holder takeover               | `tests/integration/postgres/beta07-postgres-no-affinity-carrier.test.ts:727`–`:787`.                                                                                                                                                                                     | A different holder re-authorizes retained state; revoked authority yields a failure instead of stale bytes.                                                                 |
| Drain fencing                           | Generated close marks every created durable worker draining before closing Runtime resources (`packages/compiler/src/runtime/application.ts:491`–`:499`); a draining worker returns zero admissions (`packages/runtime/src/durable/worker.ts:266`–`:278`).               | BETA-10 load and soak both assert zero post-drain admissions. Root refusal and bounded abort remain driven at `tests/unit/beta05-runtime-application.test.ts:1689`–`:1726`. |

## `drainRuntime` judgment

For beta.1, `drainRuntime` means the local lifecycle transition implemented by
idempotent `app.close()`. It is not a fourth durable-run maintenance command.
A remote command cannot identify an arbitrary process without adding the
process registry or leader authority ADR-0017 rejects, and no Accepted ADR
defines such an identity. The fence is therefore: stop new roots and claims on
this instance, bound owned work, then dispose it (`packages/runtime/src/application/index.ts:589`–`:624`).

This judgment would be overturned by Accepted authority defining a stable
Runtime-instance identity, who may target it, how expected-version fencing
works across process death, and what audit owns the command. Until then,
inventing a network maintenance surface would be scope expansion, not closing
the HA slice.
