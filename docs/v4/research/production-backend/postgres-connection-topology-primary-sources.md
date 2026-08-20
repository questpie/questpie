# PostgreSQL connection topology: primary-source finding

- Status: research finding for PB-02; not implementation or interface authority
- Scope: `pg` 8.22.0, PostgreSQL `LISTEN`/`NOTIFY`, PgBouncer pooling modes,
  and the current QUESTPIE topology
- Decision-map question:
  `docs/v4/research/production-backend/DECISION-MAP.md:63`-`:91`
- Re-derived against: `feat/v4-beta-12` at `cd2043e5`

## Finding

Use one explicitly bounded `pg.Pool` per long-lived Runtime process for
ordinary traffic and one dedicated direct/session-affine `pg.Client` per
realtime-enabled process for `LISTEN`. Migrations use a separate transient,
session-affine path. `LISTEN` is only a wake optimization: after startup and
every reconnect, commit `LISTEN` first and then reconcile the durable Change
Ledger before trusting later wakes.

The public connection configuration should require both spellings:

```ts
postgres: {
	connectionUrl: string;
	directConnectionUrl: string;
}
```

There should be **no implicit production fallback** from
`directConnectionUrl` to `connectionUrl`. A transaction-pool URL accepts SQL
but cannot preserve `LISTEN`, session advisory locks, or other session state;
the Runtime cannot infer pooling mode reliably from a generic PostgreSQL URL.
For local PostgreSQL, the caller may deliberately pass the same direct URL in
both fields. A session-mode pooler may also be supplied as the direct value if
the operator accepts that provider's session guarantees. This explicit
duplication is smaller and safer than another public `connectionMode` switch.

## Current repository topology

The generated application imports Bun `SQL`, constructs one pool from the
single `input.postgres.url`, and passes it to bootstrap, relational execution,
mutation, durable work, maintenance, and Live Query coordination
(`packages/compiler/src/runtime/application.ts:196`, `:272`-`:315`,
`:337`-`:408`). The public generated input exposes only
`postgres: { url: string }` (`packages/compiler/src/generate.ts:418`-`:427`).
Shutdown drains Runtime work, aborts PostgreSQL coordination, and closes that
one pool (`packages/compiler/src/runtime/application.ts:482`-`:500`).

The query path reserves a connection for a repeatable-read transaction
(`packages/runtime/src/relational/postgres.ts:70`-`:112`), mutation reserves a
connection before its read-committed transaction
(`packages/runtime/src/mutation/postgres.ts:133`-`:185`), and Change Ledger
reconciliation reserves another repeatable-read transaction
(`packages/runtime/src/live-query/postgres.ts:157`-`:278`). Durable kernel,
effect-ledger, and maintenance operations also open transactions on the shared
pool (`packages/runtime/src/durable/postgres-kernel.ts:143`-`:177`,
`packages/runtime/src/durable/postgres-effects.ts:66`-`:79`,
`packages/runtime/src/durable/postgres-maintenance.ts:121`-`:138`). Cron timers
and external Action execution do not need to hold a database connection.

Realtime currently performs a startup reconciliation and then only a
10-second polling scan; there is no database listener
(`packages/runtime/src/live-query/postgres-wake.ts:14`-`:25`, `:109`-`:124`).

Migrations already demonstrate why their endpoint must be session-affine. The
compiler reserves one session, probes its backend PID, takes a session advisory
lock, asserts the PID through the work and unlock, then releases and closes the
pool (`packages/compiler/src/schema/postgres/apply.ts:238`-`:276`,
`:499`-`:506`). The shared helper probes across committed transactions and
rejects a changed PID (`packages/compiler/src/postgres-session.ts:153`-`:218`).
Abort cancellation uses the pool for a separate `pg_cancel_backend` query
(`packages/compiler/src/postgres-session.ts:78`-`:89`), so migration capacity
can transiently require the pinned session plus one cancellation session.

## What `pg` 8.22.0 actually guarantees

The researched version is the official
[`pg` 8.22.0 tag](https://github.com/brianc/node-postgres/blob/pg%408.22.0/packages/pg/package.json).
Its Pool is lazy, queues checkout FIFO when full, and must receive released
clients. `pool.end()` drains clients and internal timers. The documented
defaults are `max: 10`, `idleTimeoutMillis: 10_000`, an unbounded
`connectionTimeoutMillis: 0`, and disabled connection lifetime rotation
([Pool API](https://node-postgres.com/apis/pool),
[`pg-pool` 8.22 source](https://github.com/brianc/node-postgres/blob/pg%408.22.0/packages/pg-pool/index.js#L89-L104)).
Transactions must use one checked-out client from `BEGIN` through
`COMMIT`/`ROLLBACK`; separate `pool.query` calls are not a transaction
([transactions](https://node-postgres.com/features/transactions)).

Pool size is an aggregate deployment budget, not a per-request promise. The
node-postgres sizing guide says to account for every service instance and keep
headroom for scaling and administration; it identifies 10 as a reasonable
starting value, not a universal optimum
([pool sizing](https://node-postgres.com/guides/pool-sizing)). PostgreSQL's
`max_connections` is finite and its reserved slots exist so privileged
operators can still connect
([PostgreSQL connection settings](https://www.postgresql.org/docs/current/runtime-config-connection.html#GUC-MAX-CONNECTIONS)).

`connectionTimeoutMillis` bounds both physical connect and waiting for a full
Pool checkout in 8.22.0
([tagged checkout source](https://github.com/brianc/node-postgres/blob/pg%408.22.0/packages/pg-pool/index.js#L190-L262)).
`statement_timeout`, `lock_timeout`, and
`idle_in_transaction_session_timeout` are server settings exposed by the
Client, while `query_timeout` is client-side
([Client API](https://node-postgres.com/apis/client),
[PostgreSQL statement settings](https://www.postgresql.org/docs/current/runtime-config-client.html#RUNTIME-CONFIG-CLIENT-STATEMENT)).
In 8.22.0, `query_timeout` rejects the JavaScript query callback but does not
send a PostgreSQL CancelRequest for active server work
([tagged source](https://github.com/brianc/node-postgres/blob/pg%408.22.0/packages/pg/lib/client.js#L660-L689)).
Therefore a passing outer timeout is not proof that the server stopped.

The package contains an undocumented `Client.cancel(client, query)` that opens
a separate connection and sends the backend PID/secret
([tagged source](https://github.com/brianc/node-postgres/blob/pg%408.22.0/packages/pg/lib/client.js#L565-L580));
native `AbortSignal` query support remains an
[open upstream request](https://github.com/brianc/node-postgres/issues/2774).
PostgreSQL also says a CancelRequest uses a new connection, has no direct
success reply, and can arrive too late
([protocol cancellation](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-CANCELING-REQUESTS)).
QUESTPIE must consequently prove any `AbortSignal` adapter rather than
describing it as a built-in `pg` guarantee.

`pg` supports a synchronous or asynchronous password callback for short-lived
credentials
([programmatic connection](https://node-postgres.com/features/connecting#programmatic)).
The callback runs while a newly created Client authenticates and its resolved
password belongs to that Client
([tagged source](https://github.com/brianc/node-postgres/blob/pg%408.22.0/packages/pg/lib/client.js#L269-L289)).
`maxLifetimeSeconds` can evict old pooled clients
([Pool API](https://node-postgres.com/apis/pool#new-pool)). Thus credential
rotation means: obtain fresh credentials on new connections and set a bounded
lifetime below the credential's rotation horizon. It does not refresh an
already-connected listener; that client must reconnect explicitly.

## `LISTEN`/`NOTIFY` lifecycle

`LISTEN` registers the current session, takes effect only at commit, and is
cleared when that session ends. PostgreSQL's race-safe initialization rule is:
commit `LISTEN`, then inspect database state in a new transaction, then use
notifications for later changes
([LISTEN](https://www.postgresql.org/docs/current/sql-listen.html)). Applying
that rule after every disconnect yields the required reconnect sequence:

1. Create a new dedicated Client and attach `error`, `end`, and `notification`
   handlers before declaring it healthy.
2. Execute and commit `LISTEN`.
3. Reconcile from the durable Change Ledger cursor. This closes the disconnect
   window and tolerates early duplicate notifications.
4. Treat every notification as `requestScan()`, not as the changed record.
5. On `error` or `end`, mark immediate wake degraded, retry with bounded
   exponential backoff and jitter, and keep periodic reconciliation active.

`NOTIFY` is delivered after commit. Identical channel/payload messages in one
transaction may be folded, payloads are bounded, and a long-running listener
transaction can prevent notification queue cleanup
([NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)). The
dedicated listener should therefore remain idle outside the short `LISTEN`
setup; all ledger reads stay on the ordinary Pool. Notification loss,
duplication, or coalescing cannot change correctness because PostgreSQL state
and the Change Ledger remain authoritative.

node-postgres delivers `notification` on the Client that owns the session and
warns that long-lived clients eventually disconnect under partitions,
failovers, or backend crashes; it does not document automatic reconnect
([Client events](https://node-postgres.com/apis/client#events)).

## PgBouncer boundary

PgBouncer session pooling assigns a server connection for the whole client
session and supports all PostgreSQL features. Transaction pooling returns the
server connection at transaction end and explicitly marks `LISTEN`, session
advisory locks, SQL `PREPARE`, preserved temporary tables, and `SET`/`RESET` as
unsupported; `NOTIFY` itself is supported
([official feature matrix](https://www.pgbouncer.org/features.html)). A
transaction pool is therefore valid for bounded ordinary QUESTPIE
transactions, but never for the listener or migrations.

PgBouncer's `max_client_conn` counts accepted client sockets, while
`default_pool_size` and related per-user/per-database caps govern backend
connections
([configuration](https://www.pgbouncer.org/config)). Consequently:

- without a server-side pooler, backend demand is the sum of every Runtime
  Pool maximum, every dedicated listener, transient migration/operations
  sessions, other applications, and reserved headroom;
- with transaction PgBouncer, Runtime `pool.max` counts client-to-pooler
  sockets, while backend demand is bounded by all PgBouncer server-pool caps
  plus direct listeners, migrations, operations, and headroom.

Supabase's primary documentation independently exposes the same topology:
transaction mode for application traffic and a direct connection for
migrations and long-lived native sessions
([Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)).
Provider ports and IP availability are deployment details; they do not belong
in the QUESTPIE contract.

## Recommended per-Runtime budget

The first production default should be explicit and conservative:

| Consumer                                                                                      | URL                                     | Maximum sessions per Runtime instance |
| --------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------: |
| Query, Mutation, Context bootstrap, maintenance, reconciliation, Job/Reaction database phases | `connectionUrl` through one shared Pool |                                    10 |
| Job/Reaction claims within that Pool                                                          | `connectionUrl`                         |         concurrency 2; included in 10 |
| Reconciliation within that Pool                                                               | `connectionUrl`                         |         concurrency 1; included in 10 |
| Realtime listener                                                                             | `directConnectionUrl`                   |     1 steady when realtime is enabled |
| Cron wait                                                                                     | none                                    |                                     0 |
| Migration pinned work                                                                         | `directConnectionUrl`                   |          1 transient, outside Runtime |
| Migration cancellation                                                                        | `directConnectionUrl`                   |  up to 1 additional transient session |

This gives a normal steady client budget of **10 + 1 listener** for a
realtime-enabled process, **10** without realtime, and up to **2 separate
direct sessions** in a migration process. Jobs must not hold a connection
while an external Action runs. `max: 10` is a starting default grounded in
`pg`, not a performance conclusion: operators must lower it so

```text
instances * ordinaryPoolMax
+ realtimeInstances
+ migration/ops concurrency
+ provider and administrative headroom
<= effective PostgreSQL or pooler budget
```

The deep PostgreSQL module should expose pool saturation (`totalCount`,
`idleCount`, `waitingCount`), listener state/reconnect count, and timeout
classes. A nonzero checkout/connect timeout is required; an unbounded `pg`
default is not acceptable framework behavior. Server `statement_timeout`
should expire before the outer request deadline, with `lock_timeout` and
`idle_in_transaction_session_timeout` set independently. On shutdown, stop
admission, drain workers and in-flight transactions, close the listener, then
`pool.end()` under a bounded host shutdown deadline. Forced expiry destroys
the affected Client so PostgreSQL rolls back any open transaction.

For credential or endpoint rotation, construct new Pool/listener objects,
establish and reconcile the new listener, route new work to the new Pool, and
drain the old objects. Mutating a live Pool's connection string is not a
supported lifecycle.

## Required proof before projection

1. Two Runtime instances behind transaction PgBouncer complete Query,
   Mutation, Job claim/settle, and Change Ledger reconciliation while a direct
   Client supplies immediate wakes.
2. A negative test points the listener and migration path at transaction
   pooling and fails before either is reported healthy.
3. Listener disconnect loses at least one wake; reconnect, committed `LISTEN`,
   and ledger catch-up still converge before the periodic poll.
4. Saturate all ten Pool clients: checkout fails on the bounded timeout,
   recovers after release, and records waiting pressure without leaking a
   Client.
5. Prove server work stops through `statement_timeout`; separately prove the
   chosen AbortSignal-to-cancel/destroy behavior, including late cancellation
   and transaction rollback.
6. Rotate credentials/endpoints while work is active; new connections use the
   new credential, old work drains, the listener re-establishes, and no secret
   reaches diagnostics.
7. Shutdown with an active query, transaction, listener reconnect, and worker;
   prove bounded drain and no remaining sessions owned by the process.

## What would overturn this recommendation

- A primary provider guarantee that transaction pooling preserves `LISTEN` or
  session advisory locks would reopen the required direct endpoint. Current
  PgBouncer documentation says the opposite.
- A representative deployment proving that the default 10 ordinary clients
  either starves latency-critical work or consumes unsafe database capacity
  would change the number or require role-specific Runtime pools. The formula,
  not 10, is the invariant.
- A documented `pg` cancellation/AbortSignal API with hostile proxy and
  multi-pooler proof could replace the cancel-or-destroy seam.
- Evidence that one shared ordinary Pool cannot isolate Job pressure without
  harming request latency would justify separate role pools, but only with a
  new aggregate budget and split-role deployment contract.
- A production workload showing that mandatory URL duplication causes more
  failures than an optional direct field, together with a reliable generic
  session-capability negotiation, would reopen the no-fallback rule.
