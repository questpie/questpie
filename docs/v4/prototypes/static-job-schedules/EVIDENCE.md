# Static schedule activation model evidence

This PostgreSQL model tests the activation concurrency rules proposed in
ADR-0043. It is not a production scheduler or an acceptance record. The
authoritative candidate is `docs/adr/0043-freeze-static-job-schedules-and-mutation-checkpoints.md`
on `feat/v4`; this isolated proof worktree started from `338ac552b`.

## Executed checks

On PostgreSQL 17 and Bun 1.3.14, with PostgreSQL connection settings supplied
only through the process environment:

```sh
bun test docs/v4/prototypes/static-job-schedules/activation.test.ts
```

Result: 11 passed, 0 failed, 45 assertions. The final repeated run completed
in 290 ms; this is a local test duration, not a performance budget.

The tests cover competing first activations, receipt replay before CAS,
A-to-B-to-A activation, bigint revision overflow, concurrent tick producers,
adjacent-program frontier transfer, removal/re-addition, both removal/producer
lock orders, transactional rollback, and an abort observed after a lock wait.
Activation-containing minutes and new ticks behind an existing frontier were
first demonstrated failing, then repaired and rerun successfully.

The standalone TypeScript project extends the repository base configuration.
It passed the installed TypeScript compiler with the canonical worktree's
`node_modules/@types` as its type root. The installed repository oxlint passed
both source files when invoked with this worktree as its working directory.
`git diff --check` passed. No dependencies were installed for these checks.

An independent read-only Spec review found no contradiction within the
synthetic concurrency/ABA/frontier model. It did not perform formal acceptance.

## What this cannot establish

`produce` receives a caller-selected minute. There is no cron evaluator,
latest-match search, or no-match frontier advancement. `accepted_ticks` is a
synthetic receipt table, not the existing durable Job acceptance kernel.
Principal, Context, input validation, verified artifact catalogs, executable
pinning, Mutation checkpoints, and real Job retry/recovery remain separate
proof obligations. Digest strings in this model do not establish artifact
integrity.

The model uses Bun SQL, not the production `pg` transaction owner. Abort checks
are cooperative; they do not cancel a blocked PostgreSQL statement. The
lock-order test controls waiter arrival but establishes no PostgreSQL fairness
guarantee. `inspect` is settled-state test observation, not a public coherent
snapshot unless its caller supplies a snapshot transaction.

## Resource cleanup and construction incidents

Each current run creates a UUID-named schema with create-only SQL. Cleanup is
allowed only after that run's CREATE succeeds, and closes its SQL clients.
Tests backdate only their own synthetic program rows. The existing PostgreSQL
container and application schemas are not cleanup targets.

The initial construction used a fixed schema name,
`qp_static_schedule_activation_proof`, with a startup DROP. Its absence before
the first invocation was not established; therefore absence of preexisting
data loss cannot be claimed. This was disclosed to the user and the unsafe
startup cleanup was removed.

A later cancellation test deadlocked in its assertion harness before releasing
its blocker. The exact test process was terminated, and its owned schema
`qp_schedule_proof_c1bfb5e246884e39b61d77d517689b6b` was identified from its
pending cleanup statement and removed explicitly. The harness now captures
the outcome with an ordinary promise before releasing the blocker. Subsequent
complete runs cleaned up normally. These generated test tables can be recreated
by rerunning the test; they held no application data.
