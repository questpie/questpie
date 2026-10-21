# Transaction context and queue execution ownership

The Autopilot upgrade from patched QUESTPIE 3.35.7 to clean 3.37.0 requires
three generic contracts to become upstream source: explicit row lock mode,
transaction callback context binding and explicit node-postgres selection.
They ship together with the queue ownership correction because all four are
prerequisites for the same adapter cut-over. No dependency versions change.

## Transaction context

Drizzle 1.0.0-beta.6-4414a19's Bun SQL session delegates directly to
`client.begin`. Under Bun 1.4.2, a cold acquire or an idle reconnect invokes
that callback outside the caller's AsyncLocalStorage scope. A real PostgreSQL
17 test reproduces the lost caller and QUESTPIE transaction context without
binding. The concurrent cold-transaction control passes without binding for
node-postgres 8.22.0 and postgres-js 3.4.8; this is evidence for those tested
paths, not a guarantee about every driver/version.

`AsyncResource.bind` captures the scope inside `transactionStorage.run`, before
handing the callback to Drizzle. This restores both caller and transaction ALS.
Nested calls reuse the transaction, rollback suppresses after-commit effects,
and successful after-commit effects run back in the caller's scope, outside
the transaction. The original two Autopilot scenarios are covered using actual
Drizzle transactions: idle reconnect (asserting a changed backend PID), and a
foreign callback scope. The suite runs in the PostgreSQL CI job and also passes
with the repository's Bun 1.3.13. Driver configuration is checked under both
Bun and a real Node subprocess.

## Row locks

`lockMany` defaults to `FOR NO KEY UPDATE`. Its optional `mode: "update"`
requests `FOR UPDATE` when the aggregate must block foreign-key child inserts.
The test holds the parent transaction open while a second physical connection
inserts a child with an actual PostgreSQL foreign key. The default and explicit
`no key update` allow insertion; `update` waits for commit. Unknown modes are
rejected before querying, including an empty ID set.

## Queue ownership

The fresh secret loss is not retention. Queue `listen`, publication and explicit
`drain` invoke `reconcileQueueDispatchExecutions`. It scans secret `accepted`
framework receipts with an adapter job ID, without an age threshold. Previously,
Graphile inspection returned `missing` for an ID absent from its own schema's
`questpie_dispatches` ledger. Reconciliation interpreted that as terminal and
`failQueueDispatch` erased the wrapped key unless an execution claim was live.
A pg-boss job could remain pending while its fresh framework receipt became
failed and lost its key. An expired claim only delayed the destruction.

Inspection now distinguishes two cases:

- `unknown`: ownership is unproven. A missing adapter ledger entry, another
  schema or another broker cannot justify changing the framework receipt.
  Reconciliation leaves it intact.
- `missing`: an adapter-owned dispatch is known, but its broker job is absent.
  This remains terminal evidence alongside `failed` and `completed`.

Graphile has a durable ownership ledger, so it can distinguish these cases.
pg-boss has no independent ownership ledger; a missing pg-boss job returns
`unknown` too. This deliberately retains a secret receipt whose ownership can
no longer be established rather than irreversibly destroying its key. Explicit
terminal broker states and framework completion/failure still erase keys, and
Graphile administrative removal of a known job still reconciles terminally.

The real PostgreSQL regression starts Graphile over receipts published through
pg-boss and through a different Graphile schema, with absent, live and expired
execution claims. It checks every receipt field, the original broker's pending
state, publication-triggered reconciliation, and reverse startup with a new
not-yet-admitted secret job. Existing tests cover active executions, admission
failures, expired execution leases and owned terminal jobs.

This protects data during an adapter switch. It does not move jobs between
brokers or make two simultaneous consumers a supported migration strategy.
Pending broker work and dynamic schedules still need an operator-controlled
one-off transfer before they can execute on the replacement adapter.
