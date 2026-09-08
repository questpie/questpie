# NRQ-02 native lifetime and local commits

This slice verifies the production public Query Adapter against native cache
lifetime and an owned PostgreSQL 17 Runtime. It changes tests and public guidance,
not server execution, adapter algorithms or accepted scope.

## Closed coverage gaps

The independent exit audit mapped the existing generated consumer and PostgreSQL
cases to NRQ-02. It found two gaps: timer-driven cache eviction was not exercised,
and the public page omitted the retention cost of terminal failed-key markers.

The new public-factory case uses native `gcTime: 10`, observes the actual cache
removal event, verifies data is gone, then fetches successfully with the same
captured options. Two watch opens and zero ordinary HTTP reads establish reuse
through the generated live path. Its deadline bounds failure; it does not stand
in for the removal event. A test-only negative control with `gcTime: Infinity`
fails only this new case. The production implementation already satisfied the
behavior; no product defect or product RED is claimed for this addition.

The strict generated lifetime suite now passes **53 tests / 249 assertions**.
Existing cases cover terminal denial, equivalent old-option fencing, prefetch,
shared ownership, native disabled/static behavior, cleanup subscribers, pending
and completed Mutation retirement, correlated commit classification, distinct
family refresh and refresh-failure isolation. The parent passes **1 / 1**.

## PostgreSQL repetition and test repair

The first new owned PostgreSQL run passed local two-family invalidation but
timed out waiting for the gap write to become the first small-window row after
reconnect. Safe diagnostic facts reproduced the cause: both larger views had
the gap write and every observer was successful, while the earlier write had a
larger UUID. `messages.page` orders `id DESC`; generated UUIDs do not encode
publication order. The test's first-row expectation was wrong.

The repaired test derives the expected descending window from known authorized
IDs plus the new ID, minus the deleted ID. It waits for complete replacement and
checks the exact larger window without assuming atomic publication across
independent Queries. The same correct small window is checked after real Field omission.
No timeout, transport or Runtime behavior changed. Diagnostic probes are removed.

The final exact command, using task-owned writable `TMPDIR`, is:

```sh
bun run tests/support/native-react-query-postgres-run.ts
```

It passes **2 scenarios / 39 assertions**, including strict generated consumer
types. Its parent passes **1 / 2**. The scenarios retain response-loss/no-retry,
replay gap, row deletion, inverse result replacement, real membership Field
omission and terminal denial, separate scope, and two-family refresh controls.
The owned loopback PostgreSQL container and temporary roots are removed.

## Public guidance and review

Three independent read-only Claude CLI reviews using the Opus alias examined
facts, prose and usage. Their findings narrowed the paragraph to browser-live
Queries, named the key's public identity fields, stated uncapped failure-cardinality
retention until disposal, and clarified that disposal is terminal. Recovery needs
a fresh generated scope, not rebinding the retired one. The marker contains no
input, result or failure payload. No example or public interface was added.

The subsequent [combined release gate and independent review](NRQ-02-03-REVIEW.md)
pass. Standards and Spec have no open NRQ-02 finding. This closes the native
lifetime/local-commit slice, not beta.2 release readiness. Golden UI, packed
migration and aggregate acceptance remain owned by successor tickets.
