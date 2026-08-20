# BETA-10 backend acceptance

BETA-10 closes the multi-instance correctness slice without introducing a
leader, process registry, sticky routing, cache, broker, split-role deployment,
or Studio. PostgreSQL remains the semantic authority; optional infrastructure
may only accelerate possible-progress delivery.

## What this slice proves

The ten-instance scenario creates ten all-role collaboration Runtime instances,
routes 20 direct roots and 20 Operation-Wire POSTs across them, and completes 40
durable runs with zero duplicate attempts. One instance carries a signed
internal-protocol-v4 Runtime Build and nine carry the current v5 build, so the
scenario exercises a compatible rolling fleet rather than ten identical object
references (`tests/load/beta10-ten-instance.ts:13`–`:159`). The separately owned
soak/chaos scenario completes 80 runs across four waves, abandons one claim,
recovers it exactly once after lease expiry, replaces three instances, and ends
with no failed runs (`tests/load/beta10-soak-chaos.ts:13`–`:170`).

Admission is tenant-fair and filters pinned executable digests before its batch
limit (`packages/runtime/src/durable/postgres-kernel.ts:357`–`:393`). A direct
claim rechecks the digest under the row lock, so an incompatible worker cannot
consume an attempt while the durable run remains available to a compatible old
worker (`:395`–`:435`). Exact PostgreSQL serialization losers in claim and
cancellation reaping become no work for that poll; every other error still
escapes (`:309`–`:356`, `:395`–`:580`). The hostile test inspects the executable
filter and injects both serialization losers
(`tests/hostile/beta10-compatibility.test.ts:5`–`:93`). A live PostgreSQL test
seeds four runs for one tenant and two for another, then proves a four-run batch
interleaves two from each tenant in turn order
(`tests/integration/postgres/beta08-durable-kernel.test.ts:104`–`:140`). The same
suite proves an incompatible kernel neither admits the run nor consumes an
attempt before a compatible kernel claims it (`:460`–`:488`).

A run abandoned after its final allowed claim is terminalized as
`failed / RETRY_EXHAUSTED`: the outstanding attempt is settled, the run becomes
a dead letter, and one append-only failure event is written without creating a
new attempt (`packages/runtime/src/durable/postgres-kernel.ts:436`–`:480`). The
live PostgreSQL test proves that state and proves later admission no longer
returns the poison run
(`tests/integration/postgres/beta08-durable-kernel.test.ts:353`–`:402`).

Runtime readiness now retries the complete repeatable-read reconciliation
transaction on exact `40001`; it does not retry only the failed statement inside
the stale transaction (`packages/runtime/src/live-query/postgres.ts:157`–`:278`,
`:281`–`:319`). Serialization losers use a bounded 1–64 ms full-jitter
exponential delay before reserving a fresh session, preventing ten coordinators
from immediately recreating the same race.
That repair was discovered by starting ten coordinators concurrently, and the
unit test injects the serialization failure before accepting the retry
(`tests/unit/beta07-postgres-reconciliation.test.ts:142`–`:167`), including an
exact one-call assertion for the application callback.

The rolling matrix keeps schema, wire, Policy/Context, realtime, executable,
durable state, and internal protocol as separate compatibility decisions
(`docs/v4/implementation/beta10/rolling-compatibility-matrix.md:5`–`:22`). The
fanout/reconnect report connects the new fleet evidence to the established
2,050-watch fanout, fresh-Runtime reconnect, arbitrary-holder reauthorization,
and drain tests rather than copying those slow scenarios into a second script
(`docs/v4/implementation/beta10/fanout-worker-reconnect-report.md:5`–`:16`).

The optional-infrastructure report derives absence from package and runtime
imports, then grounds correctness in PostgreSQL admission, reconciliation, and
startup scans
(`docs/v4/implementation/beta10/optional-infrastructure-absence-report.md:5`–`:29`).
No Redis, cache, broker, Pusher, WebSocket, or carrier is needed for the BETA-10
load or soak scenario.

The new backend paths initially crossed the accepted 512 KiB generated
application-bundle ratchet. The compiler now enables Bun syntax minification in
addition to whitespace minification
(`packages/compiler/src/runtime/application-bundle.ts:22`–`:32`), while the
unchanged 524,288-byte test remains enforced
(`tests/unit/beta07-live-query-projection.test.ts:252`–`:264`). The slice does not
buy correctness by weakening the quality boundary.

The architecture ratchet also rejected an 836-line durable kernel. Its exported
structural contract types moved behind the existing internal durable-row seam
(`packages/runtime/src/durable/rows.ts:17`–`:130`), leaving production transition
behavior in the smaller kernel. This is a source-organization change only; the
generated-contract golden and the complete PostgreSQL kernel suite cover the
resulting import graph.

## `drainRuntime` judgment

For beta.1, `drainRuntime` is the idempotent local `app.close()` lifecycle
transition, not a fourth durable-run maintenance command. Generated close first
marks every created worker draining, and a draining worker admits no new work
(`docs/v4/implementation/beta10/fanout-worker-reconnect-report.md:16`–`:25`). A
remote command cannot target a process without introducing a stable
Runtime-instance identity plus the process registry or leader authority that
ADR-0017 rejects
(`docs/adr/0017-freeze-multi-instance-and-optional-acceleration.md:20`–`:37`).
Gate 8 now records that exact split between the three audited durable-run
maintenance commands and local `drainRuntime`
(`docs/v4/implementation-gates.md:277`–`:287`).

This judgment would be overturned by Accepted authority defining that stable
instance identity, who may target it, the expected-version fence across process
death, and the owning audit contract. Without those definitions, inventing a
network maintenance surface would expand the product rather than close the HA
slice.

## Evidence and limits

The pre-acceptance head passed `bun run quality:full`, the explicit PostgreSQL
durable-kernel suite (14 tests, 138 assertions), the ten-instance scenario, and
the manual soak/chaos scenario. The canonical selectors on the replacement head
measured 1,049.284 ms for 40 durable runs and 3,168.598 ms for 80 soak runs,
both inside their committed stable-runner budgets and recorded separately from
the three-sample baselines in the owned reports.

After the blocked review, every file range in this closure record and the five
owned BETA-10 reports was re-read with `nl -ba` against the replacement head;
no range was carried forward from a diff hunk or an earlier commit.

The replacement review invocation on head `ebe1cfe8` returned terminal
`NO_RESULT` after the reviewer transport reached its five-minute timeout and
wrote no review artifact; it is not a verdict. The next materially changed head
adds the bounded reconciliation backoff and exact callback-count assertion
before requesting a fresh review.

The five required owned artifacts are:

- `docs/v4/implementation/beta10/ten-instance-load-report.md`;
- `docs/v4/implementation/beta10/soak-chaos-report.md`;
- `docs/v4/implementation/beta10/rolling-compatibility-matrix.md`;
- `docs/v4/implementation/beta10/fanout-worker-reconnect-report.md`; and
- `docs/v4/implementation/beta10/optional-infrastructure-absence-report.md`.

Redis implementation, Pusher/WebSocket, split roles, a provider matrix, Studio,
and any new browser or network administration surface remain non-goals. Cache,
broker, and wake hints may improve latency later, but loss or absence cannot
change results, authorization, durable transitions, or reconnect correctness.
