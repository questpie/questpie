# PB-03 PostgreSQL module interface design

- Status: selected internal prototype shape; no production or public API
  authority
- Re-derived against: `feat/v4-beta-12` at `6479c6cc`
- Input: PB-02 topology and lifecycle finding
- Next proof: executable implementation against disposable PostgreSQL 16, 17,
  and 18 plus a transaction-pool negative lane

## Decision

Prototype one private `@questpie/runtime/postgres` module backed only by
`pg@8.22.0`. The module exposes callback-scoped transaction capabilities for
ordinary work, a lifecycle-owned realtime listener, and a separately
constructed migration runner. It does not expose `pg.Pool`, `pg.Client`, raw
rows, SQL interpolation, a provider registry, or a fake database adapter.

The selected shape is a reduced capability design. It rejects two attractive
but shallower alternatives:

- one method per product concept (`query`, `mutation`, `durable`, `reconcile`)
  would make the database module change whenever QUESTPIE adds a caller even
  when its PostgreSQL transaction profile is unchanged;
- a single tagged `manage({ kind: ... })` control plane would reduce the method
  count while hiding materially different listener, rotation, diagnostics, and
  shutdown contracts behind one switch.

The seam follows PostgreSQL lifetimes instead: ordinary transaction, Runtime
listener/generation, and transient pinned migration. This preserves locality
without teaching the database layer about Query, Mutation, Job, or Reaction.

## Grounding

PB-02 fixes one bounded ordinary Pool, one direct listener per realtime Runtime,
and a separate transient direct migration session
(`postgres-connection-topology-primary-sources.md:12`-`:17`, `:195`-`:212`).
The current tree independently reimplements checkout and transactions in Query,
Mutation, Live Query, and Durable paths
(`packages/runtime/src/relational/postgres.ts:29`-`:112`,
`packages/runtime/src/mutation/postgres.ts:59`-`:75`, `:176`-`:185`,
`packages/runtime/src/live-query/postgres.ts:157`-`:278`,
`packages/runtime/src/durable/postgres-kernel.ts:143`-`:177`). Compiler
migrations additionally probe backend identity around committed work
(`packages/compiler/src/postgres-session.ts:153`-`:218`). Generated application
code still constructs and distributes Bun `SQL` itself
(`packages/compiler/src/runtime/application.ts:196`, `:272`-`:299`).

The driver does not provide a documented AbortSignal cancellation guarantee;
its client timeout can reject JavaScript while server work continues
(`postgres-connection-topology-primary-sources.md:97`-`:119`). PostgreSQL also
requires committed `LISTEN` followed by a state read to close the startup race
(`postgres-connection-topology-primary-sources.md:133`-`:149`). Those behaviors
must therefore live below this seam rather than in every caller.

## Selected interface

This is an internal interface. Only the eventually proved generated application
configuration `{ connectionUrl, directConnectionUrl }` is a candidate for
public projection.

```ts
declare const statementBrand: unique symbol;
declare const transactionBrand: unique symbol;
declare const channelBrand: unique symbol;

type PostgresParameter =
	| null
	| boolean
	| number
	| bigint
	| string
	| Date
	| Uint8Array
	| readonly PostgresParameter[]
	| PostgresJson;

type PostgresJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly PostgresJsonValue[]
	| Readonly<{ [key: string]: PostgresJsonValue }>;

type PostgresJson = Readonly<{
	kind: "json";
	value: PostgresJsonValue;
}>;

type PostgresChannel = string & { readonly [channelBrand]: true };

type PostgresStatement<Input, Output> = Readonly<{
	name: string; // stable safe diagnostic identity, never SQL text
	text: string; // trusted compiler/runtime-owned SQL with $n placeholders
	parameters(input: Input): readonly PostgresParameter[];
	decode(
		result: Readonly<{
			command: string;
			rowCount: number | null;
			rows: readonly (readonly unknown[])[];
		}>,
	): Output;
	readonly [statementBrand]: true;
}>;

type PostgresControl = Readonly<{
	signal?: AbortSignal;
	deadlineAt?: number; // absolute Unix epoch milliseconds
	statementTimeoutMs?: number; // can only narrow the configured maximum
	lockTimeoutMs?: number; // can only narrow the configured maximum
}>;

type PostgresTransactionMode = Readonly<{
	isolation: "readCommitted" | "repeatableRead" | "serializable";
	access: "readOnly" | "readWrite";
	deferrable?: boolean;
}>;

interface PostgresTransaction {
	readonly [transactionBrand]: true;
	execute<Input, Output>(
		statement: PostgresStatement<Input, Output>,
		input: Input,
	): Promise<Output>;
}

interface PostgresDatabase {
	transaction<Output>(
		input: Readonly<{
			mode: PostgresTransactionMode;
			control?: PostgresControl;
			use(transaction: PostgresTransaction): Promise<Output>;
		}>,
	): Promise<Output>;
}

interface RuntimePostgres extends PostgresDatabase {
	listen(
		input: Readonly<{
			channel: PostgresChannel;
			fallbackIntervalMs: number;
			reconcile(
				input: Readonly<{
					reason: "startup" | "notification" | "reconnect" | "periodic";
					database: PostgresDatabase;
					signal: AbortSignal;
				}>,
			): Promise<void>;
		}>,
	): Promise<PostgresListener>;

	rotate(
		input: Readonly<{
			connectionUrl: string;
			directConnectionUrl: string;
			deadlineAt: number;
			verify(candidate: PostgresDatabase): Promise<void>;
		}>,
	): Promise<void>;

	facts(): PostgresFacts;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

interface PostgresListener {
	facts(): Readonly<{
		state: "starting" | "healthy" | "degraded" | "closing" | "closed";
		generation: number;
		reconnects: number;
		lastReconciledAt: number | null;
	}>;
	requestReconcile(): void;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

type RuntimePostgresConfiguration = Readonly<{
	connectionUrl: string;
	directConnectionUrl: string;
	pool: Readonly<{
		max: number; // default 10
		connectTimeoutMs: number;
		checkoutTimeoutMs: number;
		idleTimeoutMs: number;
		maxLifetimeSeconds: number;
	}>;
	timeouts: Readonly<{
		statementMs: number;
		lockMs: number;
		idleInTransactionMs: number;
	}>;
}>;

interface MigrationPostgres {
	run<Output>(
		input: Readonly<{
			application: string;
			control?: PostgresControl;
			use(
				session: Readonly<{
					transaction<Value>(
						input: Readonly<{
							mode: PostgresTransactionMode;
							use(transaction: PostgresTransaction): Promise<Value>;
						}>,
					): Promise<Value>;
				}>,
			): Promise<Output>;
		}>,
	): Promise<Output>;
}

type PostgresFacts = Readonly<{
	state: "starting" | "ready" | "rotating" | "draining" | "closed";
	generation: number;
	pool: Readonly<{
		max: number;
		total: number;
		idle: number;
		waiting: number;
		inFlight: number;
	}>;
	listener: "disabled" | "starting" | "healthy" | "degraded" | "closed";
	counters: Readonly<{
		checkoutTimeouts: number;
		statementTimeouts: number;
		cancellations: number;
		destroyedConnections: number;
		rotations: number;
	}>;
}>;

type PostgresFailureCode =
	| "configuration"
	| "closed"
	| "draining"
	| "connectTimeout"
	| "checkoutTimeout"
	| "statementTimeout"
	| "lockTimeout"
	| "cancelled"
	| "connectionLost"
	| "queryFailed"
	| "serializationFailure"
	| "deadlock"
	| "constraint"
	| "invalidResult"
	| "sessionNotAffine"
	| "commitOutcomeUnknown";

declare class QuestpiePostgresError extends Error {
	readonly code: PostgresFailureCode;
	readonly phase:
		| "connect"
		| "checkout"
		| "begin"
		| "statement"
		| "commit"
		| "rollback"
		| "listen"
		| "reconcile"
		| "shutdown";
	readonly statementName?: string;
	readonly sqlState?: string;
	readonly retry: "never" | "safeBeforeCommit" | "callerMustResolveCommit";
}

declare function definePostgresStatement<Input, Output>(
	input: Readonly<{
		name: string;
		text: string;
		parameterCount: number;
		parameters(input: Input): readonly PostgresParameter[];
		decode: PostgresStatement<Input, Output>["decode"];
	}>,
): PostgresStatement<Input, Output>;

declare function definePostgresChannel(name: string): PostgresChannel;

declare function createRuntimePostgres(
	configuration: RuntimePostgresConfiguration,
): Promise<RuntimePostgres>;

declare function createMigrationPostgres(
	input: Readonly<{
		directConnectionUrl: string;
		timeouts: RuntimePostgresConfiguration["timeouts"];
	}>,
): MigrationPostgres;
```

`createMigrationPostgres` is separate because migrations do not share the
Runtime lifecycle or ordinary Pool. It is still the same module, statement
representation, transaction runner, decoding, cancellation, errors, and
diagnostics implementation. Seed uses the ordinary transaction path unless it
runs inside migration application, in which case it uses that pinned session.

## Invariants

1. Every statement is module-owned static SQL plus positional parameters and an
   exact decoder. No dynamic SQL fragment, identifier, raw row, Pool, Client, or
   global `pg.types` mutation crosses the seam. JSON uses the explicit
   `PostgresJson` wrapper and canonical serialization; arbitrary objects and
   `pg`'s implicit `toPostgres` hook are refused. Execution uses array row mode.
   Runtime Build statements cross only after their existing digest/inventory
   verification; the hostile proof includes a tampered-plan refusal.
2. A transaction owns exactly one checkout and physical connection from `BEGIN`
   through confirmed `COMMIT` or `ROLLBACK`. The callback handle is invalid once
   the callback settles. Nested transactions and savepoints are absent.
3. The module issues exact isolation/access control and `SET LOCAL`
   `statement_timeout`, `lock_timeout`, and
   `idle_in_transaction_session_timeout` before caller SQL. Timeouts are finite,
   nonzero, and bounded by the module configuration.
4. Callbacks are never transparently retried. Serialization and deadlock errors
   are classified for the Query, Mutation, or durable owner to resolve. After
   `COMMIT` is sent, loss is `commitOutcomeUnknown`, never a claimed rollback.
5. Abort before checkout performs no SQL. During active SQL, the implementation
   must prove cancel-or-destroy; the Client is not reusable until server work is
   known stopped or its connection is destroyed. Server `statement_timeout`
   remains the primary bound.
6. A Runtime admits at most one listener. It owns one direct session, installs
   handlers before becoming
   healthy, commits `LISTEN`, reconciles durable state, and only then resolves.
   Notifications are coalesced possible-progress hints. Reconnect repeats the
   full order while periodic reconciliation remains active.
7. Rotation creates and verifies a new generation, establishes and reconciles
   its listener, switches new admission, and drains the old generation. Failure
   before the switch leaves the old generation authoritative.
8. Migration uses only `directConnectionUrl`, proves backend identity across
   committed probes, owns the session advisory lock, rechecks identity around
   every transaction and unlock, and destroys the session on uncertain cleanup.
9. Shutdown stops admission, drains workers and transactions, closes the
   listener, and ends the Pool. Deadline expiry destroys remaining clients.
10. Safe facts contain counts, state, stable statement identities, and normalized
    failure classes only. They never contain URLs, credentials, parameters,
    rows, SQL text, notification payloads, or PostgreSQL detail/hints.

The normalized internal failures distinguish configuration, closed/draining,
connect timeout, checkout timeout, statement timeout, lock timeout, caller
cancellation, connection loss, serialization, deadlock, constraint, invalid
decode, lost session affinity, and unknown commit outcome. Operation layers map
those internal faults into their already accepted disclosure and wire rules;
the PostgreSQL module does not invent public Operation errors.

## Performance contract

The ordinary Pool is lazy, FIFO, and bounded at a starting default of 10. One
transaction uses one checkout; no Job or Reaction holds it while an external
Action executes. Listener work consumes one separate direct session and only
ordinary reconciliation uses the Pool. Notification bursts coalesce to at most
one in-flight and one queued reconciliation.

The initial prototype uses unnamed extended-protocol parameterized execution.
It does not create an unbounded per-connection prepared-statement cache. Decode
is one pass over array rows. Existing Query, Mutation, and durable row/byte
limits remain their owners; this module must not become a second product-budget
authority.

Rotation can temporarily double ordinary Pool and listener capacity. The proof
must make that operator headroom explicit; a hidden capacity spike is not an
acceptable implementation detail.

## Alternatives assessed

### Minimal tagged run/control plane

This alternative had `run({ kind: "transaction" | "migration-session" })` and
one overloaded `manage({ kind: "listen" | "rotate" | "snapshot" | "close" })`.
It has the smallest nominal method count and keeps product concepts out. Its
weakness is semantic compression: adding a lifecycle command grows one tagged
union and central switch, while call sites lose the distinct return and lifetime
shape of listener, rotation, status, and closure. Method count is not interface
depth, so this alternative is not selected.

### Product-purpose methods

This alternative offered `query`, `mutation`, `durable`, `reconcile`,
`migration`, and `startWake`. Its common callers are extremely legible and it
prevents invalid isolation choices. It is too coupled: Query and reconciliation
currently share a PostgreSQL profile, as do several short write transactions,
yet each becomes a database-module method. A new product capability would
appear to require a new PostgreSQL API even when it adds no database behavior.
That is the wrong reason for this module to change.

### Full capability graph

This alternative exposed explicit runtime, transaction, pinned-session,
listener, generation, rotation, and diagnostic handles. It represented lifetime
constraints most precisely but made ordinary callers understand more machinery
than they need and included a general `openPinnedSession` escape hatch. The
selected design retains its callback-scoped transaction and listener ownership,
then narrows pinned work into the migration runner and reduces configuration and
fact types to the PB-02 proof requirements.

## Dependency and proof strategy

Keep `pg@8.22.0` and compatible `@types/pg` behind the private Runtime module.
The compiler already depends on Runtime and can consume its private migration
entry point; generated application code resolves the Runtime entry point rather
than importing `pg`. No second workspace package is justified by the selected
interface alone.

Do not add a fake PostgreSQL adapter. Pure statement encoder/decoder and
lifecycle state-machine tests may inject private clocks, backoff, or sockets,
but behavioral substitution uses disposable real PostgreSQL. PGLite cannot
prove `LISTEN`, session advisory locks, backend PID affinity, or driver-level
cancellation. Required integration coverage is PostgreSQL 16, 17, and 18 plus a
transaction-PgBouncer lane for ordinary work and negative listener/migration
tests.

The executable PB-03 prototype must cover PB-02's seven hostile cases
(`postgres-connection-topology-primary-sources.md:238`-`:257`) and additionally
prove expired callback handles, decoder mismatch, notification during initial
reconciliation, commit-response loss, failed rotation retaining the old
generation, and complete diagnostic redaction.

## Executable progress

`59fa031c` adds the concrete `pg@8.22.0` transaction kernel and a real-database
witness. PostgreSQL 16, 17, and 18 each prove parameterized static execution,
array-row decoding, repeatable-read/read-only control, server
`statement_timeout`, callback-handle expiry, and preservation of an application
callback failure. This is the ordinary transaction foundation, not yet Runtime
adoption.

`63924ba7` adds the dedicated direct listener state machine. The same three
PostgreSQL versions prove committed `LISTEN` before startup reconciliation,
payload-free notification wake, forced backend termination, reconnect,
re-`LISTEN`, and reconciliation before healthy state. The witness does not yet
prove ledger convergence for a wake lost during the disconnect or the
transaction-PgBouncer negative boundary.

Still open in PB-03: bounded checkout saturation, AbortSignal cancel-or-destroy,
unknown COMMIT outcome, pinned migration affinity/lock ownership, rotation,
forced shutdown, safe diagnostics, PgBouncer, and migration of existing Bun SQL
callers. PB-04 remains blocked.

## Deletion test

Deleting this module must force all of the following to reappear independently
in generated application, relational Query, Mutation, Live Query, Durable,
compiler migration, and Seed code: Pool checkout/release, transaction control,
server timeouts, AbortSignal cancel-or-destroy, exact row decoding, SQLSTATE and
commit-ambiguity classification, connection cleanup, and shutdown.

Migration would additionally regain backend-PID checks and advisory-lock
cleanup; realtime would regain session ownership, LISTEN reconnect ordering,
and listen-then-reconcile; generated application would regain Pool construction,
rotation, and drain. The current tree already shows that spread. If the
prototype merely moves `pool.query()` without deleting those duplicated
responsibilities from the named callers, PB-03 fails.

## What would overturn this selection

- A representative implementation showing that transaction-profile flags cause
  repeated invalid combinations would justify purpose-specific methods.
- A real non-migration session-affine caller with different lifetime semantics
  would justify generalizing the pinned runner; hypothetical future use does
  not.
- Measured request starvation under one Pool would justify role pools only with
  a new aggregate capacity budget.
- A documented and hostile-tested `pg` AbortSignal or cancellation API could
  replace the internal cancel-or-destroy mechanism without changing the seam.
- A second accepted durable database product would justify a provider port;
  test mocking or package aesthetics do not.
