# UTC calendar prototype evidence

- Date: 2026-09-06
- Candidate input: Proposed ADR-0043
- Scope: standalone parser and latest-match model only
- Authority: none; this evidence does not accept or project ADR-0043

## Falsified boundary

[`calendar.ts`](./calendar.ts) models exactly five numeric UTC cron fields. It
accepts numbers, ascending inclusive ranges, lists, and positive steps on `*`
or a range. It emits sorted complete field sets, requires either normalized day
of month or day of week to be complete, and rejects a program with no date in
one complete 400-year Gregorian cycle.

Latest-only catch-up searches calendar days backwards, builds at most 1,440
allowed minute-of-day candidates once, and returns the latest candidate in the
exclusive-inclusive `(frontier, observedMinute]` window. It examines at most
146,097 days regardless of outage duration; it does not iterate missed minutes.
The test compares representative month, weekday, leap-day, and stepped programs
with a deliberately minute-scanning oracle over a bounded 90-day window.

## Candidate proof assumptions

These are prototype bounds, not Accepted product limits:

- input instants are exact UTC minutes;
- supported UTC years are `1` through `9999`;
- the evaluator's hard search bound is one 400-year Gregorian cycle
  (`146,097` days);
- impossible-date validation performs at most one cycle of day checks during
  parsing;
- UTC numeric fields use the proleptic Gregorian behavior modeled by
  ECMAScript `Date` in this standalone proof.

The year bound is conservative and executable. ADR-0043 or its implementation
must either ratify it or replace it with an equally finite PostgreSQL-owned
instant bound.

## Commands and results

Initial RED:

```text
bun test docs/v4/prototypes/static-job-schedules/calendar.test.ts
0 pass, 1 fail: Cannot find module './calendar'
```

Implemented proof:

```text
bun test docs/v4/prototypes/static-job-schedules/calendar.test.ts
8 pass, 0 fail, 35 assertions
```

The branch also ran the repository formatter and warning-denying linter over
the three proof files, a standalone strict TypeScript check over both `.ts`
files, and `git diff --check` before its proof commit. All returned zero.

## Residual proof work

This model does not prove compiler Origins or artifact linkage, PostgreSQL
clock ownership, activation/frontier transactions, concurrent tick uniqueness,
schedule counts, transaction-time budgets, or Job acceptance. Production must
not use Runtime-host `Date` as calendar authority. PostgreSQL 17 integration
must reproduce the same canonical UTC answers and own the observed instant.

Named zones, DST, aliases, seconds, years, wrapping ranges, special tokens, and
multiple schedules are outside this candidate slice. No dependency or timer
scheduler was introduced.
