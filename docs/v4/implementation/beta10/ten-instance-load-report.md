# BETA-10 ten-instance load report

Reviewed branch: `feat/v4-beta-10`.

## Result

`bun run test:load -- --scenario beta10` passed on local Docker PostgreSQL 17.
The observed run completed in 1,006.304 ms and proved:

- ten generated all-role Runtime instances started over one database;
- one signed `questpie.internal.v4` Runtime Build and nine current v5 builds
  remained live together;
- 20 direct Mutation roots and 20 Operation Wire POSTs were routed round-robin
  across the fleet;
- nine concurrent workers completed all 40 durable runs with 40 attempts, so
  the duplicate-attempt count was zero; and
- a worker created before its Runtime began draining admitted zero work after
  `app.close()`.

The canonical scenario selector was rerun after the blocked review and selected
`beta10-ten-instance` from its performance manifest. That replacement-head
validation completed in 1,020.242 ms with the same 40 claims, zero duplicate
attempts, and zero drained-worker admissions. It is validation evidence, not a
fourth baseline sample; the committed three-sample baseline remains unchanged.

The executable scenario is
`tests/load/beta10-ten-instance.ts:13`–`:159`; its owned budgets are
`quality/performance/beta10-ten-instance.json`. The scenario checks database
truth rather than trusting worker counters at `tests/load/beta10-ten-instance.ts:102`–`:128`.

## Defects found by the load

The first run failed before work began. Ten coordinators raced while inserting
the same reconciliation consumer under Repeatable Read. PostgreSQL returned
`40001`. Reconciliation now retries the whole transaction on that exact error
(`packages/runtime/src/live-query/postgres.ts:157`–`:278`, `:281`–`:298`), and
the unit test injects the failure before accepting the retry.

The first concurrent worker run then exposed `40001` losers in cancellation
reaping and claiming. Those paths now treat only that exact PostgreSQL error as
no work for this poll (`packages/runtime/src/durable/postgres-kernel.ts:309`–`:356`
and `:395`–`:580`); every other error still escapes. The hostile test injects
both losers.

The added backend paths initially exceeded the accepted 512 KiB application
bundle ratchet. The compiler now enables Bun syntax minification in addition to
whitespace minification (`packages/compiler/src/runtime/application-bundle.ts:22`–`:32`),
while the unchanged 524,288-byte assertion remains enforced
(`tests/unit/beta07-live-query-projection.test.ts:252`–`:264`). This preserves
the quality boundary instead of raising it.

## Scope

This is load evidence, not a stable-runner timing claim. The 15-second ceiling
detects a clear stall on noisy machines. A tagged stable runner remains the
owner of a strict release budget.
