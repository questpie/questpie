# Generated worker checkpoint candidate

ADR-0043 remains Proposed. This isolated candidate connects the existing Job
worker to generated inert Mutation references and the ordinary Mutation executor.
It is not formal acceptance or a beta.2 release claim.

## Red and green

`tests/integration/postgres/static-job-checkpoint-worker.test.ts` compiles a
copied Collaboration application with an authored checkpoint Job, accepts it
through generated direct Job acceptance, and polls the actual generated worker.

- Before generated declarations, compilation rejected the missing `step` and
  `mutations` members (QP-COMPOSE-013).
- After declarations but before Runtime wiring, the worker retried with
  `HANDLER_FAILED` instead of completing.
- After wiring, one business write, one completed checkpoint, and successful
  worker terminal settlement passed: 1 test / 6 assertions.
- A Job that throws after a completed checkpoint then retries with a deleted
  receipt reproduced unsafe recovery classification. Required-receipt checking
  inside the existing Mutation transaction prevents a new receipt claim or write.
- That repair exposed a missing v9 durable-event failure constraint. The v9
  run and event catalogs now both admit the exact safe `CHECKPOINT_INVALID` code.
- Deleted and changed receipt cases now end permanently with
  `CHECKPOINT_INVALID`, retain one business write, and disclose no receipt bytes
  to the Job. Combined worker tracer: 1 test / 14 assertions, PostgreSQL 17,
  no skips.

The database connection uses process-only credentials. Each test creates and
verifies its own UUID-named database before applying fixture migrations; it
closes application and clients and drops only that database. Existing PostgreSQL
and preview resources are not stopped.

One run hit environment `EDQUOT` while writing generated files under `/tmp`.
The same test passed using a newly owned `TMPDIR` on the workspace filesystem;
no unrelated temporary files were removed.

## Ownership

The attempt owner synchronously captures codec-canonical input and private
reference provenance. A lease-fenced store loads authoritative history,
reserves commands, and binds committed receipt identity and a result digest.
It stores no second result. Each dispatch resolves fresh ordinary Context and
uses the existing Mutation executor. The worker joins started checkpoint
promises before terminal settlement and Execution cleanup.

An ordinary Fable 5.1 consultation was advisory, not acceptance. Its suggestion
to fence the Mutation transaction itself was not adopted: the accepted separate
transaction boundary and the existing unique Mutation receipt already prevent
duplicate writes for a stable Call Identity. No second kernel or retry owner
was introduced.

## Still blocking

The expanded generated-worker tracer passes 1 test / 54 assertions. It covers
caught forged-reference failure, unawaited and concurrent commands, duplicate
names, synchronously detached mutable input, truncated/renamed/changed history,
and transient failure before replay followed by successful recovery. Independent
review reproduced the transient failure being replaced by a synthetic history
failure; a failing worker test preceded its repair. The original handler failure
now survives joining and uses the existing bounded Job retry.

The same generated application has a static service recipe. Built CLI activation
and exact receipt replay precede ten real Runtime instances contending through
their ordinary worker polls to accept one latest tick. Its Job executes the
named checkpoint successfully.
Denied service Context leaves the frontier unchanged and produces the safe,
separate producer failure while the worker remains usable. The temporary
proof-only `durable.schedules` access is deleted. Activation is deployment CLI
work, not a public Runtime management API. The combined worker and PostgreSQL
schedule-owner run passes 2 tests / 99 assertions without skips.

The generated durable-kernel artifact now pins `CHECKPOINT_INVALID` in both its
known and permanent failure sets. A failing compiler artifact test preceded this
repair; the focused artifact test passes 31 assertions.

Integrated authority changes during replay, lease takeover and cancellation;
beginner/browser tracer; final artifact and authority
reconciliation; independent review and manifest-bound formal acceptance remain
required. Historical model proofs do not substitute for generated-path checks.
