# PB-05 generated Runtime PostgreSQL operational profile

- Status: provisional implementation profile; not a stable production latency
  guarantee
- Re-derived against: `feat/v4-beta-12` at `f2bfbabf`
- Scope: generated Runtime construction while PB-05 removes Bun SQL
- Public surface: exactly `connectionUrl` and `directConnectionUrl`; every value
  below remains framework-owned

## Decision

The generated application will eventually construct exactly one
`RuntimePostgres`. It must not add a `pg` Pool beside the current Bun SQL Pool.
The production ownership switch happens only when Context bootstrap, readiness,
Query, Mutation, realtime reconciliation, and Durable database phases can all
use the one ordinary Pool.

The coherent ownership switch is blocked until the unresolved server timeout
ceilings have per-path evidence. The currently grounded and provisional values
are:

| Setting                     |      Value |
| --------------------------- | ---------: |
| ordinary Pool maximum       |         10 |
| connect timeout             |       10 s |
| checkout timeout            |       10 s |
| idle connection timeout     |       10 s |
| maximum connection lifetime |      300 s |
| statement safety ceiling    | unresolved |
| lock safety ceiling         | unresolved |
| idle-in-transaction ceiling | unresolved |
| application close horizon   |       30 s |

The numeric values are finite operational judgments, not measured service-level
objectives. The unresolved values cannot inherit unbounded PostgreSQL server
defaults, but inventing finite numbers would kill or interrupt an unknown
population of legitimate work. Generated production construction requires three
different evidence classes: Query, Mutation, and Durable statement tails for
`statement_timeout`; contended lock-acquisition and wait evidence for
`lock_timeout`; and transaction-idle phase plus lifecycle evidence for
`idle_in_transaction_session_timeout`.

The application close horizon means one absolute `deadlineAt`, captured once at
the outer generated `app.close()` boundary. Runtime admission/drain, realtime
listener/coordinator shutdown, and `RuntimePostgres.close()` must consume the
same deadline. A layer must not restart another relative 30-second window.

## What is grounded and what is judgment

The topology is fixed: all ordinary database phases share one Pool, its starting
maximum is 10, and realtime uses one additional direct listener
(`postgres-connection-topology-primary-sources.md:215`-`:240`). The pinned
driver also defaults its Pool maximum and idle timeout to 10 and 10 seconds,
respectively (`postgres-connection-topology-primary-sources.md:80`-`:105`). A
nonzero connect/checkout bound and finite transaction-local server ceilings are
required (`:243`-`:251`).

The current module requires every profile member
(`packages/runtime/src/postgres/contract.ts:122`-`:137`) and applies the smaller
connect/checkout value as node-postgres's single `connectionTimeoutMillis`
(`packages/runtime/src/postgres/index.ts:280`-`:293`). Therefore 10 seconds
bounds both phases, but they are not independently enforced. A full Pool may
queue any number of callers until their checkout expires: Pool clients and
queue residence are bounded, queue cardinality is not.

The 300-second lifetime is a provisional judgment. It does not promise
credential-rotation latency and may need fleet jitter after deployment
measurement. Statement and lock timeouts are concurrent per-statement bounds;
they do not sum to a transaction or shutdown budget. A Mutation may issue many
individually bounded statements. Only the shared absolute lifecycle deadline and
its cancellation/destruction path can bound application close.

The shared close deadline is not implemented today. Runtime creates its own
relative drain window (`packages/runtime/src/application/index.ts:205`-`:207`,
`:589`-`:618`), while the realtime coordinator separately computes another
30-second deadline
(`packages/runtime/src/application/realtime/postgres-coordinator-runtime.ts:130`-`:139`).
`RuntimePostgres.close()` already accepts an absolute deadline. PB-05 must join
these owners before it can claim a bounded application shutdown.

## Measurement before promotion

The first executable measurement extends the existing authorized Query
performance scenario. Against the collaboration fixture's authored 100-row page
maximum it will:

1. seed 10,001 Messages outside the timed region;
2. warm 100 linked static-statement executions;
3. alternate 500 first-page and 500 cursor-page statements;
4. repeat the process three times;
5. retain all 3,000 statement durations and derive nearest-rank p50, p95, p99,
   and maximum;
6. assert zero statement timeouts and zero server statements left running.

The measurement reports the distribution before selecting a multiplier or
rounding quantum. The current `10x / 50 ms` budget belongs to an aggregate of 20
Query executions, not an individual statement maximum, so transferring it would
be a new unsupported judgment. Local PostgreSQL validates the instrument and
yields evidence only. A built-in production value also needs cold-cache,
concurrent, representative tenant-cardinality, plan/statistics drift, and
post-deploy profiles on the selected managed PostgreSQL target. The generated
Fetch/client timing is a separate end-to-end regression signal and does not
define the server statement ceiling.

Mutation and Durable measurements remain separately owned because their
transaction and statement populations differ. A Mutation's 5-second transaction
budget and a Durable attempt deadline are not PostgreSQL statement-timeout
values (`docs/v4/prototypes/statement-timeout-gate/DECISION.md:402`-`:475`).

## PB-05 order

1. retain the linked Query artifact as the only SQL authority;
2. measure Query, Mutation, and Durable statement tails without adding a public
   observer;
3. separately measure contended lock waits and transaction-idle lifecycle
   phases;
4. derive and hostile-test each server timeout ceiling from its own evidence;
5. make one absolute application close deadline executable;
6. migrate internal callers behind `PostgresDatabase` while the generated app
   still owns only the Bun compatibility Pool;
7. flip generated construction once to the completed `RuntimePostgres`
   profile and delete its Bun SQL owner;
8. run representative Query, Mutation, realtime, Durable, startup, saturation,
   rotation, and shutdown evidence before promoting defaults.

## Overturn conditions

Change this profile when stable-local plus managed measurements derive a
different per-path ceiling, fleet evidence shows synchronized connection
lifetime churn, checkout saturation requires a different aggregate Pool budget,
or the driver gains independently enforceable connect and checkout controls.
Expose an operational knob publicly only when at least one representative
deployment cannot be operated safely with a framework-owned value.

Do not overturn the one-Pool rule merely to make migration smaller. A temporary
second production Pool would spend an unowned connection budget and duplicate
lifecycle and failure semantics.
