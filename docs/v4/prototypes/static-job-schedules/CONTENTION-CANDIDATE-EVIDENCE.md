# Worker contention and integrated local measurements

This record preserves the failed contention gate and its bounded comparison on
2026-09-07. The measurements do not establish a candidate-specific regression,
but did not close the gate. The later complete
[reference-local run](#integrated-reference-local-run) passes without replacing
the failures below. ADR-0043 remains Proposed; this is not formal acceptance or
tagged stable-runner release evidence.

## Original failure and comparison

The integrated candidate at `9956d9358c536810990f0cac03dd09391595a6f6` completed
the functional assertions for 64 successful Reaction runs without duplicate
attempts, then failed `postgresContention64Ms` at **2284.8262129999985 ms** against
the existing **2000 ms** budget. The affected-scenario runner stopped there;
its other three selected load/soak scenarios did not run in that invocation.

The diagnostic comparison used this unchanged registered command:

```sh
bun run test:load -- --scenario beta08-worker-contention
```

Candidate `9956d9358c536810990f0cac03dd09391595a6f6` and pre-schedule baseline
`97910dac96e0fcc9a7da5c911b8f2534f5eb83b4` ran in separate dedicated worktrees.
Three interleaved pairs were selected before measuring; every result is retained.

| Pair | Candidate milliseconds | Candidate exit / gate | Baseline milliseconds | Baseline exit / gate |
| ---- | ---------------------- | --------------------- | --------------------- | -------------------- |
| 1    | 1227.1581740000001     | 0 / PASS              | 1330.6623520000012    | 0 / PASS             |
| 2    | 1823.0906450000002     | 0 / PASS              | 1574.0478280000007    | 0 / PASS             |
| 3    | 3725.096383            | 1 / FAIL              | 4510.4245439999995    | 1 / FAIL             |

All six measured runs reached and passed the functional assertions before the
timing check: 64 runs succeeded, 64 attempts were recorded, no attempt was
superseded, and the fleet claimed exactly 64 runs. Neither a consumer failure
nor a durable invariant failure was observed in these runs. Both heads exceeded
the budget in the third pair. The candidate was faster in pairs one and three
and slower in pair two; this sample does not isolate schedule overhead.

## Setup, isolation and retained failures

Both worktrees used Bun 1.3.14, canonical TypeScript 6.0.2, pinned `pg` 8.22.0,
and the existing local PostgreSQL 17 container on loopback port 55432. Frozen
dependency installation left both tracked trees clean. Fresh worktrees initially
lacked ignored public-package build output. The first six invocations failed
while loading the public package, before reaching the timed workload:

| Setup invocation | Head      | Exit | Measurement |
| ---------------- | --------- | ---- | ----------- |
| 1                | Candidate | 1    | Not reached |
| 2                | Baseline  | 1    | Not reached |
| 3                | Candidate | 1    | Not reached |
| 4                | Baseline  | 1    | Not reached |
| 5                | Candidate | 1    | Not reached |
| 6                | Baseline  | 1    | Not reached |

The normal `bun run build` command in each worktree's `packages/questpie`
supplied that prerequisite. No source repair was applied. The runner was then
changed to stop at the first further pre-measurement failure; all six subsequent
invocations produced the measurements above. Setup failures are not samples or
passing tests.

Each invocation used a newly created UUID-named database. Credentials were read
from the existing container into process memory and never printed. `PGDATABASE`
and `PG_DATABASE` selected the same owned database, and an independent Bun SQL
connection checked its actual identity before the harness could reset schemas.
All twelve owned databases were dropped after their invocations. No application
schema in the shared maintenance database was reset. Canonical `feat/v4` was
neither edited nor compiled; prior branches were preserved.

Compiler and root heavy work paused for the paired measurements. A separate
preview host remained active against its own database on the same container.
This was a shared development host, not a tagged stable runner.

The credential-redacted original log is retained locally at
`/home/drepkovsky/code/questpie-v4-beta2-verification.l3bsSH/affected-load-soak.log`.
The comparison directory is
`/home/drepkovsky/code/questpie-load-pairs.Q4HQN7`: `1-candidate.log` through
`6-baseline.log` and `results.json` retain the six setup failures;
`measured-1-candidate.log` through `measured-6-baseline.log` and
`measured-results.json` retain all measured outcomes. The local `run-pairs.ts`
records the database lifecycle and unchanged scenario invocation. These local
paths are diagnostic provenance, not portable repository prerequisites.

## What the comparison can establish

Immediately after the pairs, the coordinating agent reported these host
observations from `uptime`, `nproc`, one-second `vmstat` samples and container
statistics: load averages 20.76 / 18.67 / 19.67 on 12 processors, 25–39 runnable
tasks, 1–4% CPU idle, swap-in 12–39 MB/s, swap-out 5–45 MB/s, and approximately
15 GB swapped. The target PostgreSQL container reported 5.57% CPU and 67.24 MiB
memory. These are coordinator-reported post-run samples, not measurements taken
by the paired workload or an independent attribution of its elapsed time.

The observations support shared-host contention as a plausible contributor.
They do not prove it was the sole cause. The failure also occurs on the
pre-schedule head, so this comparison does not justify a producer optimization.

Source inspection narrows the relevant difference: the timed workload is
unchanged, compilation and the 64 publication Mutations are outside its timer,
and these Reactions do not enter Job checkpoint load or completion. The new
producer performs reconciliation before each worker poll, adding 16 transactions
across the two rounds of eight workers. Without activation, reconciliation
returns after reading the absent schedule head. No producer-disabled
counterfactual was run because the comparison did not establish a consistent
candidate-specific regression.

A zero-program fast path is not assumed equivalent. Reconciliation currently
returns `active` with zero counts for an explicitly activated matching empty set,
but `inactive` for an absent or mismatched head. Returning `inactive` without
reading PostgreSQL would change that observable distinction even though no tick
could be accepted.

The 2000 ms budget, workload and consumer remain unchanged. No producer fast
path, performance waiver or production patch was introduced. The comparison
left the gate unresolved; the later complete run is recorded below. Strict
release budgets still require stable tagged-runner evidence under the repository
quality rule. ADR-0043 acceptance cannot proceed while any required deterministic
gate remains unresolved.

## Integrated reference-local run

On candidate `fcf2adeeb`, one predeclared sequential invocation of the complete
four-scenario matrix passed. The coordinator stopped its other compiler and
PostgreSQL verification work before starting; the machine remained a shared
development host, not a tagged stable runner. Every scenario reported
`evidenceClass: "reference-local"`. Earlier failures above and in the
[retained-build record](./RETAINED-BUILD-FIXTURE-EVIDENCE.md) remain evidence;
this run establishes neither their sole cause nor stable performance.

| Command                                                          | Result                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test:load -- --scenario beta08-worker-contention`       | PASS: 822.651 ms against 2000 ms; 64 runs, eight workers, zero duplicate attempts                                                            |
| `bun run test:load -- --scenario beta10-ten-instance`            | PASS: 1940.702 ms against 15000 ms; ten instances, 20 direct roots, 20 network posts, 40 runs, zero duplicate attempts or drained admissions |
| `bun run test:load -- --scenario pb05-mutation-transaction-tail` | PASS: 1,000 measured calls, 500 fresh and 500 replay samples, 500 fresh writes and zero replay writes                                        |
| `bun run test:soak -- --scenario beta10-soak-chaos`              | PASS: 5935.412 ms against 60000 ms; 80 runs, one recovered crash attempt, three replacements, zero failed runs or drained admissions         |

Workloads, budgets and production limits are unchanged. The log records each
scenario's start, exit zero and owned-database cleanup in order. The coordinator
verified removal of all four exact owned databases. The complete log is
`/home/drepkovsky/code/questpie-v4-beta2-verification.l3bsSH/affected-load-soak-fcf2adeeb.log`;
this is local provenance, not a portable prerequisite. The complete local matrix
closes the affected candidate load/soak checks. Strict tagged-runner release
evidence remains outstanding; no release or public performance claim follows.
