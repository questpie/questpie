# UTC calendar prototype evidence

- Date: 2026-09-06
- Candidate input: Proposed ADR-0043
- Scope: standalone parser/latest-match model and SELECT-only PostgreSQL oracle
- Authority: none; this evidence does not accept or project ADR-0043

## Current regression owner

The duplicate calendar implementation has been deleted from this candidate.
Its unchanged parser and latest-match tests now exercise the Runtime schedule
contract at `tests/unit/static-schedule-calendar.test.ts`; the independent
SELECT-only PostgreSQL oracle lives at
`tests/integration/postgres/static-schedule-calendar.test.ts`.
Both pass against the integrated candidate: 11 unit tests / 41 assertions and
6 PostgreSQL 17 tests / 23 assertions, without skips. The PostgreSQL test now
checks the exact CI-selected major, defaulting to 17 only when unset; no
PostgreSQL 16 or 18 run is claimed here.

The history below records construction of the deleted model, preserved in Git.
Its old commands are historical, not the current regression commands. Compiler,
activation and generated-worker evidence live in their candidate records;
neither these tests nor deletion constitute formal acceptance.

## Falsified boundary

The historical `calendar.ts` models exactly five numeric UTC cron fields. It
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
- authored text currently uses JavaScript `trim()` plus Unicode `\s` splitting,
  so leading, trailing, and inter-field JavaScript whitespace normalize away;
  this is a provisional parser assumption, not a projected public grammar;
- the evaluator trusts a canonical program produced by `parseUtcCron`; it does
  not validate forged arrays or mutable foreign artifacts. Production requires
  an artifact decoder that reconstructs and validates this invariant.

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
11 pass, 0 fail, 41 assertions
```

The branch also ran the repository formatter and warning-denying linter over
the three proof files, a standalone strict TypeScript check over both `.ts`
files, and `git diff --check` before its proof commit. All returned zero.

The PostgreSQL oracle in `calendar-postgres.test.ts` enumerates at most 10,080
minutes per fixed test window with `generate_series`, extracts UTC fields, and
selects the latest match. It shares parser-produced field sets, not the
backwards-by-day search. It therefore tests evaluator agreement independently,
but does not independently prove parser grammar or canonicalization. Every SQL
statement is SELECT-only; the connection is not an enforced read-only role or
transaction. No database, schema, row, or setting is created or changed.

Independent review covered UTC extraction, frontier exclusivity, oracle work
bounds, cleanup, and these evidence limitations. The PostgreSQL tests require
process-only PG settings and assert major version 17; a skipped run is not
evidence.

The live PostgreSQL 17 run, including a window with several quarter-hour
matches, passed:

```text
bun test docs/v4/prototypes/static-job-schedules/calendar.test.ts docs/v4/prototypes/static-job-schedules/calendar-postgres.test.ts
17 pass, 0 fail, 0 skip, 65 assertions
bun run --bun tsc -p docs/v4/prototypes/static-job-schedules/tsconfig.json
exit 0
```

The standalone configuration now includes both activation and calendar proofs.

## Residual proof work

This model does not prove compiler Origins or artifact linkage, activation/
frontier transactions, concurrent tick uniqueness, schedule counts,
transaction-time budgets, or real Job acceptance. The PostgreSQL oracle checks
selected UTC answers and one database-derived whole-minute instant. Production
still must capture `clock_timestamp()` once after acquiring the activation lock,
validate linked artifacts, and commit frontier progress with real Job acceptance.
Runtime-host `Date` must not decide the observed instant.

Named zones, DST, aliases, seconds, years, wrapping ranges, special tokens, and
multiple schedules are outside this candidate slice. No dependency or timer
scheduler was introduced.
