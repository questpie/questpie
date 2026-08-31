# OpenTelemetry signal projection v1

Status: normative candidate evidence for Proposed ADR-0033

The official adapter's instrumentation scope name is `questpie` and its scope
version is the exact installed `questpie` package version. It binds
OpenTelemetry Semantic Conventions 1.44.0 for the stable HTTP and database keys
listed below. A dependency update may not rename a span, instrument, attribute,
or outcome without a new QUESTPIE projection version.

## Resource

| Attribute                       | Value                                                      |
| ------------------------------- | ---------------------------------------------------------- |
| `service.name`                  | `OTEL_SERVICE_NAME`, otherwise application identity        |
| `service.version`               | exact installed `questpie` package version                 |
| `service.instance.id`           | Envelope v2 `runtimeInstanceId`                            |
| `deployment.environment.name`   | `deploymentEnvironment` option; absent when not configured |
| `questpie.runtime_build.digest` | exact Runtime Build digest                                 |

No other host, process, OS, container, cloud, or environment detector is
enabled by the adapter in v1.

## Span graph

| Scope                          | Kind       | Exact name                             | Parent or link                                                 |
| ------------------------------ | ---------- | -------------------------------------- | -------------------------------------------------------------- |
| generated Operation Fetch      | `SERVER`   | `POST /_questpie/operation`            | valid remote parent; restart creates root plus link; else root |
| authored matched Route         | `SERVER`   | `{METHOD} {matched route template}`    | same ingress rule                                              |
| unmatched framework Fetch      | `SERVER`   | `{METHOD}`                             | same ingress rule; no raw path                                 |
| direct root Execution          | `INTERNAL` | `questpie execution`                   | active valid local context, otherwise root                     |
| Query Operation                | `INTERNAL` | `query {Resource identity}`            | owning Execution                                               |
| Mutation Operation             | `INTERNAL` | `mutation {Resource identity}`         | owning Execution                                               |
| Action Operation               | `INTERNAL` | `action {Resource identity}`           | owning Execution or durable Attempt                            |
| Mutation transaction           | `INTERNAL` | `questpie transaction`                 | owning Mutation                                                |
| compiler-owned PostgreSQL call | `CLIENT`   | uppercase SQL verb                     | active Operation/transaction/attempt scope                     |
| Job acceptance                 | `PRODUCER` | `job {Resource identity} accept`       | accepting Execution or Mutation transaction                    |
| Reaction committed-fact accept | `PRODUCER` | `reaction {Resource identity} accept`  | Mutation transaction that commits the dispatch fact            |
| Job physical attempt           | `CONSUMER` | `job {Resource identity} attempt`      | new root with first-acceptance link at span creation           |
| Reaction physical attempt      | `CONSUMER` | `reaction {Resource identity} attempt` | new root with committed-fact-acceptance link at span creation  |
| Action effect                  | `CLIENT`   | `action {Resource identity}`           | current Operation or physical Attempt                          |

Live Query initial execution and recomputation use the same Query span. They
set `questpie.execution.entry` to `watch_initial` or `watch_recompute`.
Generated Operation Fetch has both the SERVER span and its child Execution and
Operation spans. Standard Bun/HTTP and PostgreSQL instrumentation is suppressed
only for those QUESTPIE-owned layers.

The PostgreSQL name is exactly one of `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or
`CALL`, equal to `db.operation.name`. The compiler-owned statement identity is
an attribute, never the span name.

HTTP methods are normalized to `CONNECT`, `DELETE`, `GET`, `HEAD`, `OPTIONS`,
`PATCH`, `POST`, `PUT`, or `TRACE`; every other input becomes `_OTHER` before it
can enter a span name or attribute. An unmatched name therefore remains bounded.

## Span attributes

Every string is at most 256 UTF-8 bytes. Resource and statement identities are
compiler-bounded. Exact UUID attributes appear only when `operationalIds` is
`spans`.

| Attribute                      | Type    | Allowed scopes                     | Values                                                                                             |
| ------------------------------ | ------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `questpie.resource`            | string  | Operation, accept, attempt, Action | exact static Resource identity                                                                     |
| `questpie.operation.kind`      | string  | Operation                          | `query`, `mutation`, `action`                                                                      |
| `questpie.execution.entry`     | string  | Execution, Query                   | `direct`, `fetch`, `watch_initial`, `watch_recompute`, `worker`                                    |
| `questpie.outcome`             | string  | all semantic spans                 | `ok`, `declared_error`, `framework_error`, `cancelled`, `deadline`, `ambiguous`, `fenced`, `retry` |
| `questpie.error.code`          | string  | terminal semantic spans            | declared code or closed framework code                                                             |
| `questpie.statement.identity`  | string  | PostgreSQL                         | compiler-owned fixed statement identity                                                            |
| `questpie.attempt.number`      | integer | durable Attempt                    | 1..8                                                                                               |
| `questpie.runtime.instance.id` | string  | operational span opt-in            | canonical UUID                                                                                     |
| `questpie.transaction.id`      | string  | transaction/ambiguity opt-in       | canonical nonzero PostgreSQL `xid8` decimal text, maximum `18446744073709551615`                   |
| `questpie.dispatch.id`         | string  | accept/attempt opt-in              | canonical UUID                                                                                     |
| `questpie.run.id`              | string  | attempt opt-in                     | canonical UUID                                                                                     |
| `questpie.attempt.id`          | string  | attempt opt-in                     | canonical UUID                                                                                     |
| `questpie.effect.id`           | string  | effect opt-in                      | canonical UUID                                                                                     |

HTTP SERVER spans add only stable `http.request.method`, matched `http.route`
when available, `url.scheme`, and `http.response.status_code`. They omit raw
target, path for unmatched requests, query, headers, user agent, peer address,
and body. PostgreSQL spans add stable `db.system.name = "postgresql"` and
`db.operation.name`; they omit server address, database namespace, table, SQL,
parameters, row count, and error text.

Every closed outcome except `framework_error` leaves OTel span status `UNSET`.
`framework_error` includes unexpected statement, adapter-readiness, and
physical-handler failures and sets status `ERROR` with no description. HTTP
status follows OTel HTTP server conventions. No exception event is recorded.

## Span events

| Event                                      | Attributes                                           |
| ------------------------------------------ | ---------------------------------------------------- |
| `questpie.context.completed`               | none                                                 |
| `questpie.receipt.replayed`                | none                                                 |
| `questpie.transaction.committed`           | optional `questpie.transaction.id`                   |
| `questpie.operation.post_commit_ambiguous` | optional `questpie.transaction.id`                   |
| `questpie.durable.accepted`                | optional Dispatch/Run IDs                            |
| `questpie.execution.cancelled`             | none                                                 |
| `questpie.execution.deadline_exceeded`     | none                                                 |
| `questpie.durable.fenced`                  | optional Attempt ID                                  |
| `questpie.durable.retry_scheduled`         | `questpie.attempt.number`, `questpie.retry.delay_ms` |
| `questpie.durable.terminal`                | `questpie.outcome`, optional closed error code       |
| `questpie.action.ambiguous`                | optional Effect ID                                   |

A span accepts at most 32 QUESTPIE events. A thirty-third event increments the
adapter's drop diagnostic and is omitted. Event attributes use only the span
allowlist above plus `questpie.retry.delay_ms`, an integer 0..900,000.

Event owners are exact: Context/cancellation/deadline belong to Execution;
receipt replay and post-commit ambiguity to Mutation; commit to transaction;
acceptance to its producer; fencing/retry/terminal to a physical Attempt; and
Action ambiguity to the effect. No other scope accepts a QUESTPIE event.

Runtime, HTTP, transaction, and PostgreSQL scopes end only `ok`,
`framework_error`, `cancelled`, or `deadline`. Execution, Query, and acceptance
also admit `declared_error`. Mutation, Action, and Action effect additionally
admit `ambiguous`. Job/Reaction attempts additionally admit only `fenced` and
`retry`. A committed transaction remains `ok` if the outer Mutation later
becomes post-commit `ambiguous`; observation never initiates retry or changes
rollback/cancellation ownership.

## Metrics

All duration histograms use seconds. Operation/statement/Action boundaries are
`[0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]`.
Queue/attempt boundaries add `60`, `300`, and `900` seconds.

| Instrument                               | Type          | Unit          | Attributes                                    |
| ---------------------------------------- | ------------- | ------------- | --------------------------------------------- |
| `questpie.operation.calls`               | Counter       | `{call}`      | Operation kind, Resource, outcome, error code |
| `questpie.operation.duration`            | Histogram     | `s`           | Operation kind, Resource, outcome             |
| `questpie.operation.active`              | UpDownCounter | `{execution}` | Operation kind, Resource                      |
| `questpie.postgresql.statement.duration` | Histogram     | `s`           | statement identity, DB operation, outcome     |
| `questpie.job.accepted`                  | Counter       | `{run}`       | Resource, outcome                             |
| `questpie.job.queue.delay`               | Histogram     | `s`           | Resource                                      |
| `questpie.durable.attempt.duration`      | Histogram     | `s`           | Resource, outcome, error code                 |
| `questpie.action.duration`               | Histogram     | `s`           | Resource, outcome                             |
| `questpie.runtime.active_executions`     | UpDownCounter | `{execution}` | entry kind                                    |
| `questpie.observation.dropped`           | Counter       | `{signal}`    | signal (`span` or `event`), cause             |

Metric `questpie.outcome` uses the closed span outcome values.
`questpie.error.code` is present only for compiler-known declared codes or
closed framework codes. Job queue delay is measured from the effective
eligibility instant `max(acceptedAt, notBefore)` to the successful claim that
starts the attempt; intentional delay before `notBefore` is not queue latency.
Drop cause is `event_limit` or `adapter_fault`. Batch-span queue drops remain
the OpenTelemetry SDK's self-observability and Envelope-limit drops remain a
kernel diagnostic; neither is copied into this instrument. No metric contains
an operational UUID, trace/span identity, Principal/Tenant fact, URL, SQL, or
error text.
