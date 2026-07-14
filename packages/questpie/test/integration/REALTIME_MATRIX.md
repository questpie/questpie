# Realtime v2 verification matrix

The CI `realtime-matrix` job starts Postgres, Redis, and Soketi from
`test/fixtures/soketi/compose.yml`. Gated integration tests use those real
services; deterministic failure tests stay in-process so drops, retries, clocks,
and backpressure are reproducible.

## Driver and QoS evidence

| Contract                     | Evidence                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SSE + pg-notify broadcast    | `realtime-driver-services.test.ts` sends collection and global wakes to two real LISTEN connections.                                                               |
| SSE + Redis broadcast        | `realtime-driver-services.test.ts` sends the same wakes through two independent real XREAD cursors.                                                                |
| Soketi wake broadcast        | `realtime-soketi.test.ts` requires both application subscribers to receive one notice-only wake.                                                                   |
| Soketi channels and presence | `realtime-soketi.test.ts` observes a presence join and two server-mediated events in order.                                                                        |
| Latest-snapshot QoS          | `realtime-sse-transport.test.ts` proves latest-wins replacement and a hard byte cap.                                                                               |
| Ordered-event QoS            | `ordered-channel-ledger.test.ts` proves locked ordering, replay, dedupe, gap close, and slow-consumer close.                                                       |
| Deploy herd                  | `realtime-refresh-scheduler.test.ts` resumes 500 equivalent clients at the current sequence with zero snapshots, then computes once for all 500.                   |
| Wake loss and crash window   | `realtime-reconciliation.test.ts` proves poll healing; `realtime-transactional-capture.test.ts` proves same-transaction capture and post-commit wake independence. |
| Bulk and live count          | `realtime-transactional-capture.test.ts` proves one event per bulk mutation; `realtime.test.ts` proves count uses `count` and transfers one scalar.                |
| DoS and backpressure         | `realtime-admission.test.ts`, `realtime.test.ts`, and `realtime-sse-transport.test.ts` cover connection/topic/query/depth/snapshot/buffer limits.                  |

## Channel security evidence

The IDs below are the normative checklist in `TRANSPORT.md`. SDK client-event
allowlists are intentionally not counted as authorization.

| ID     | Automated evidence                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-01 | `channel-routes.test.ts`: subscribe and publish policies are evaluated independently and fallback behavior is explicit.                                                        |
| SEC-02 | `channel-routes.test.ts`: public/default channels can subscribe but cannot anonymously publish.                                                                                |
| SEC-03 | `channel-routes.test.ts`: thrown/timed-out/collision denials cause zero provider calls; `realtime.test.ts` rejects before sink allocation.                                     |
| SEC-04 | `channel-routes.test.ts`: schema and size failures occur before a ledger event id is returned.                                                                                 |
| SEC-05 | `realtime-soketi.test.ts`: hostile raw client-events require provider-wide enablement and a direct client trigger.                                                             |
| SEC-06 | `realtime-soketi.test.ts`: hostile client payload delivery proves the provider allowlist is membership-only, unvalidated, non-replayable, and distinct from framework publish. |
| SEC-07 | `realtime-pusher-transport.test.ts`: final private/presence channel alphabet and 164-character boundary.                                                                       |
| SEC-08 | `channel-security.test.ts` and `channel-routes.test.ts`: cross-pattern and ambiguous-param collisions fail before authorization/provider work.                                 |
| SEC-09 | `channel-security.test.ts` and `channel-routes.test.ts`: missing, malformed, and untrusted cookie origins fail.                                                                |
| SEC-10 | `channel-routes.test.ts`: exact credentialed CORS reflection, `Vary: Origin`, and no wildcard.                                                                                 |
| SEC-11 | `channel-routes.test.ts`: session/principal token buckets return 429 and recover under a fake clock.                                                                           |
| SEC-12 | `channel-security.test.ts` and `channel-routes.test.ts`: serialized 10,000 bytes pass and 10,001 bytes fail without allocation.                                                |
| SEC-13 | `realtime-pusher-transport.test.ts` and `channel-routes.test.ts`: bounded presence identity/info/member count and resolver-only exposure.                                      |
| SEC-14 | `realtime-pusher-routes.test.ts` and `channel-routes.test.ts`: socket/channel-bound auth, `no-store`, and secret-free config.                                                  |
| SEC-15 | `realtime-pusher-transport.test.ts`: provider termination plus denial until principal restoration.                                                                             |
| SEC-16 | `channel-routes.test.ts`: hostile params, payload, wire name, and socket values never enter observations; reasons are from the bounded enum.                                   |
