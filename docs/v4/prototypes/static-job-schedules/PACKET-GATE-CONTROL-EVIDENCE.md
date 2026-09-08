# Post-packet-repair release control

This records the complete quality control after the acceptance-packet repair.
It does not accept ADR-0043 or certify stable-runner performance.

## Failed runs retained

The first post-repair `quality:release` stopped after approximately 590 seconds
with a Bun 1.3.14 segmentation fault during the ordinary test process. The log
is retained as `quality-release-packet-safety.log`. No cause is established.
The complete isolated schedule-compiler file subsequently passed nine tests
and 52 assertions. The packet controls passed 124 tests and 217 assertions,
and strict TypeScript passed. These isolated results do not explain the crash.

One unchanged-head full control at `f616b17e2` then reported 1,121 passes,
196 skips and 37 failures. The first failure was `EDQUOT` while writing the
generated Query Resource client, followed by failed temporary-file writes and
their downstream failures. `/tmp` is a 16 GiB tmpfs with `usrquota` enabled;
free filesystem space does not prove remaining user quota. The complete log is
`quality-release-f616b17e2-control.log`. No failed run is recorded as PASS.

## Isolated temporary storage and full PASS

A new owned directory on the ordinary disk supplied `TMPDIR`; no test, source,
filter, timeout, assertion or performance budget changed. No unrelated temporary
files or worktrees were removed. The previously failing Query Resource file
passed 14 tests and 66 assertions there.

On the unchanged `f616b17e22a67289c0627fdfb66fef0b9c6723b6` head,
`bun run quality:release` with that process-local `TMPDIR` completed successfully:

- ordinary suite: 1,158 passes, 196 gated skips, zero failures across 303 files;
  1,354 tests in 542.12 seconds;
- React: three passes; packed OpenTelemetry isolation: one pass and 2,333
  assertions; packed CLI telemetry: one pass and 24 assertions;
- architecture, formatting, lint, types, Knip, build, docs, public skills and
  package checks: PASS;
- 19 performance manifests validated, not executed.

Logs remain in
`/home/drepkovsky/code/questpie-v4-beta2-verification.l3bsSH`:
`bun-crash-isolated-schedule-compiler.log`,
`bun-crash-isolated-packet-controls.log`, `quota-isolated-query-resource.log`
and `quality-release-f616b17e2-owned-tmp.log`. The paths are local provenance,
not portable build prerequisites. The later full PASS is not evidence that
the earlier segmentation fault was repaired, nor that quota caused it.

## Release boundaries still open

The independent read-only release audit found that `release.yml` calls
`quality:release`, whose performance step validates manifests only. A registered
release runner alone would not execute strict workloads. The release must bind
actual unchanged-budget stable-runner workload evidence before publication.
The runner API currently reports zero registered runners. The existing four
scenario reference-local matrix is retained and is not relabelled as stable.

Formal schedule acceptance is still unconsumed. A committed verified PASS must
precede authority/public-documentation projection and the schedule-inclusive
aggregate beta.2 acceptance. Manual example inspection and explicit publication
authority remain separate prerequisites.
