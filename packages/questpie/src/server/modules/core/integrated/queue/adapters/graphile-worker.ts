import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	Logger,
	parseCronItem,
	runMigrations,
	runTaskList,
	type TaskList,
	type WorkerEvents,
	type WorkerPool,
} from "graphile-worker";
import pg from "pg";

import type {
	QueueAdapter,
	QueueExecutionState,
	QueueHandlerMap,
	QueueListenOptions,
} from "../adapter.js";
import {
	decodeQueueDispatchEnvelope,
	encodeQueueDispatchEnvelope,
} from "../dispatch-envelope.js";
import {
	QueueAdmissionError,
	QueueExecutionTimeoutError,
	withQueueAbort,
} from "../execution-signal.js";
import type { PublishOptions } from "../types.js";

export interface GraphileWorkerAdapterOptions {
	connectionString: string;
	/** Direct/session-pooled URL for the runner, including its LISTEN connection. */
	listenConnectionString?: string;
	schema?: string;
	/** Process-wide handler limit, shared by all job names. Default: 10. */
	concurrentJobs?: number;
	/** Maximum connections per pool (one is reserved for LISTEN). Default: 10. */
	maxPoolSize?: number;
	/** Shared fetch polling for future jobs and retries, in milliseconds. Default: 1000. */
	pollInterval?: number;
	/** Requires the queue and application transaction to use the same database. */
	useApplicationTransaction?: boolean;
	/** Disable named prepared statements when using a transaction pooler. */
	noPreparedStatements?: boolean;
	/** Host-owned fatal termination hook. Default: log and process.exit(1). Must terminate the host. */
	onFatalError?: (error: Error) => void;
}

type Executor = (query: SQL) => Promise<Record<string, unknown>[]>;
type ScheduleOptions = Omit<
	PublishOptions,
	"idempotencyKey" | "startAfter" | "secretPayload"
>;
const dialect = new PgDialect();
const capacityTask = "__questpie_graphile_capacity__";
const capacityRetryTask = "__questpie_graphile_capacity_retry__";

function reservedTask(name: string): boolean {
	return name === capacityTask || name === capacityRetryTask;
}

/**
 * Graphile Worker 0.18 adapter. All job names share one LISTEN-driven pool and
 * one fetch buffer; teamSize limits actual handlers independently per name.
 */
export class GraphileWorkerAdapter implements QueueAdapter {
	readonly capabilities = {
		longRunningConsumer: true,
		runOnceConsumer: false,
		pushConsumer: false,
		scheduling: true,
		singleton: true,
		executionTerminalState: true,
	} as const;
	readonly transactionalPublishing: boolean;
	readonly transactionalSecretPublishing = false;
	readonly uniqueDispatchIds = true;
	private readonly options: GraphileWorkerAdapterOptions;
	private readonly schema: string;
	private readonly errors = new Set<(error: Error) => void>();
	private pool?: pg.Pool;
	private runnerPool?: pg.Pool;
	private executionClient?: pg.Client;
	private readonly executing = new Set<string>();
	private readonly activeTasks = new Set<Promise<unknown>>();
	private executionCommands: Promise<void> = Promise.resolve();
	private fatalError?: Error;
	private migrationRevision = 0;
	private auditCursor = "";
	private retiredPass?: { cursor?: string; end: string };
	private lastAuditAt = 0;
	private readonly warnedPolicies = new Set<string>();
	private runner?: WorkerPool;
	private starting?: Promise<void>;
	private stopping?: Promise<void>;
	private listening = false;
	private listenStarting?: Promise<void>;
	private runnerClosing = false;
	private bufferWaiting = false;
	private bufferDrained?: () => void;
	private scheduleTimer?: ReturnType<typeof setTimeout>;
	private scheduleTick?: Promise<void>;
	private recoveryTimer?: ReturnType<typeof setTimeout>;
	private recoveryTick?: Promise<void>;
	private readonly activeControllers = new Map<string, AbortController>();

	constructor(options: GraphileWorkerAdapterOptions) {
		this.options = options;
		this.schema = options.schema ?? "graphile_worker";
		if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(this.schema)) {
			throw new Error(
				"Graphile Worker schema must be a PostgreSQL identifier of at most 63 characters",
			);
		}
		positiveInteger(options.concurrentJobs ?? 10, "concurrentJobs");
		positiveInteger(options.maxPoolSize ?? 10, "maxPoolSize");
		if ((options.maxPoolSize ?? 10) < 2)
			throw new Error(
				"maxPoolSize must leave a connection available beside LISTEN (minimum 2)",
			);
		positiveInteger(options.pollInterval ?? 1000, "pollInterval");
		this.transactionalPublishing = options.useApplicationTransaction === true;
	}

	private table(name: string): SQL {
		return sql`${sql.identifier(this.schema)}.${sql.identifier(name)}`;
	}

	private fatal(error: unknown, lostFence = false): void {
		if (
			this.fatalError ||
			(!lostFence && (this.stopping || this.runnerClosing))
		)
			return;
		this.fatalError = new Error(
			"QUESTPIE Graphile Worker stopped unexpectedly; terminating the host",
			{ cause: error },
		);
		this.listening = false;
		if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
		for (const controller of this.activeControllers.values())
			controller.abort();
		try {
			this.emitError(this.fatalError);
		} finally {
			if (this.options.onFatalError) this.options.onFatalError(this.fatalError);
			else {
				console.error(this.fatalError);
				process.exit(1);
			}
		}
	}

	private executionKey(dispatchId: string): string {
		return `questpie-execution:${this.schema}:${dispatchId}`;
	}

	private executionCommand(
		text: string,
		values: string[],
	): Promise<pg.QueryResult> {
		const query = this.executionCommands.then(async () => {
			await this.connectExecutionClient();
			return this.executionClient!.query(text, values);
		});
		this.executionCommands = query.then(
			() => {},
			() => {},
		);
		return query;
	}

	private async connectExecutionClient(): Promise<void> {
		if (this.executionClient) return;
		const client = new pg.Client({
			connectionString:
				this.options.listenConnectionString ?? this.options.connectionString,
			keepAlive: true,
			keepAliveInitialDelayMillis: 10_000,
		});
		this.executionClient = client;
		const lost = (error: Error) => {
			if (this.executionClient !== client) return;
			this.executionClient = undefined;
			void client.end().catch(() => {});
			if (this.executing.size > 0) this.fatal(error, true);
			else this.emitError(error);
		};
		client.on("error", lost);
		client.on("end", () =>
			lost(new Error("Execution fence connection closed")),
		);
		try {
			await client.connect();
		} catch (error) {
			if (this.executionClient === client) this.executionClient = undefined;
			await client.end().catch(() => {});
			throw error;
		}
	}

	async ensureQueue(
		jobName: string,
		opts?: { policy?: PublishOptions["queuePolicy"] },
	): Promise<void> {
		if (opts?.policy && !this.warnedPolicies.has(jobName)) {
			this.warnedPolicies.add(jobName);
			console.warn(
				`Queue "${jobName}": Graphile Worker ignores queuePolicy; use singletonKey for duplicate suppression.`,
			);
		}
	}

	private emitError(error: unknown): void {
		const normalized =
			error instanceof Error ? error : new Error(String(error));
		for (const handler of this.errors) handler(normalized);
	}

	on(_event: "error", handler: (error: Error) => void): void {
		this.errors.add(handler);
	}

	async start(): Promise<void> {
		if (this.fatalError) throw this.fatalError;
		if (this.stopping) throw new Error("Graphile Worker adapter is stopping");
		if (!this.starting) {
			this.starting = this.initialize().catch((error) => {
				this.starting = undefined;
				throw error;
			});
		}
		await this.starting;
		if (this.stopping) throw new Error("Graphile Worker adapter is stopping");
	}

	private async initialize(): Promise<void> {
		const pool = new pg.Pool({
			connectionString: this.options.connectionString,
			max: this.options.maxPoolSize ?? 10,
		});
		pool.on("error", (error) => this.emitError(error));
		pool.on("connect", (client) =>
			client.on("error", (error) => this.emitError(error)),
		);
		this.pool = pool;
		try {
			await runMigrations({
				pgPool: pool,
				schema: this.schema,
				noPreparedStatements: this.options.noPreparedStatements,
				preset: {
					plugins: [
						{
							name: "QuestpieGraphileVersion",
							worker: {
								middleware: {
									init(next, event) {
										if (event.ctx.version !== "0.18.0")
											throw new Error(
												`QUESTPIE requires graphile-worker 0.18.0; installed ${event.ctx.version}`,
											);
										return next();
									},
								},
							},
						},
					],
				},
			});
			const [revision] = await this.execute(
				sql`SELECT max(id) AS id FROM ${this.table("migrations")}`,
			);
			this.migrationRevision = Number(revision!.id);
			if (await this.adapterSchemaCurrent()) return;
			await this.inTransaction(async (execute) => {
				await execute(
					sql`SELECT pg_advisory_xact_lock(hashtextextended(${"questpie-graphile:" + this.schema}, 0))`,
				);
				if (await this.adapterSchemaCurrent(execute)) return;
				await execute(sql`CREATE TABLE IF NOT EXISTS ${this.table("questpie_dispatches")} (
					dispatch_id text PRIMARY KEY, job_name text NOT NULL, job_id bigint UNIQUE,
					singleton_key text, payload json, options json,
					status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
					handler_started boolean NOT NULL DEFAULT true,
					generation integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
					available_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
					created_at timestamptz NOT NULL DEFAULT now()
				)`);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_transport_locked ON ${this.table("_private_jobs")} (locked_at, id) WHERE locked_at IS NOT NULL`,
				);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_audit ON ${this.table("questpie_dispatches")} (dispatch_id) WHERE status IN ('pending', 'active')`,
				);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_lease ON ${this.table("questpie_dispatches")} (lease_until) WHERE status = 'active'`,
				);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_pending ON ${this.table("questpie_dispatches")} (available_at) WHERE status = 'pending'`,
				);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_retention ON ${this.table("questpie_dispatches")} (created_at) WHERE status IN ('completed', 'failed')`,
				);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_singleton ON ${this.table("questpie_dispatches")} (singleton_key) WHERE status IN ('pending', 'active')`,
				);
				await execute(
					sql`CREATE TABLE IF NOT EXISTS ${this.table("questpie_retired_jobs")} (job_id bigint PRIMARY KEY)`,
				);
				await execute(sql`CREATE TABLE IF NOT EXISTS ${this.table("questpie_schedules")} (
					job_name text PRIMARY KEY, cron text NOT NULL, payload json NOT NULL,
					options json NOT NULL, last_run timestamptz NOT NULL DEFAULT date_trunc('minute', now())
				)`);
				await execute(
					sql`CREATE TABLE IF NOT EXISTS ${this.table("questpie_adapter_migrations")} (version integer PRIMARY KEY)`,
				);
				await execute(
					sql`INSERT INTO ${this.table("questpie_adapter_migrations")} (version) VALUES (1) ON CONFLICT DO NOTHING`,
				);
			});
		} catch (error) {
			await pool.end();
			this.pool = undefined;
			throw error;
		}
	}

	private async adapterSchemaCurrent(
		execute: Executor = this.execute,
	): Promise<boolean> {
		const [table] = await execute(
			sql`SELECT to_regclass(${'"' + this.schema + '".questpie_adapter_migrations'}) AS name`,
		);
		if (!table?.name) return false;
		const [version] = await execute(
			sql`SELECT version FROM ${this.table("questpie_adapter_migrations")} WHERE version = 1`,
		);
		return Boolean(version);
	}

	private execute: Executor = async (query) => {
		if (!this.pool) throw new Error("Graphile Worker adapter is not started");
		const { sql: text, params } = dialect.sqlToQuery(query);
		return (await this.pool.query(text, params)).rows;
	};

	private async inTransaction<T>(
		callback: (execute: Executor) => Promise<T>,
	): Promise<T> {
		if (!this.pool) throw new Error("Graphile Worker adapter is not started");
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const result = await callback(async (query) => {
				const { sql: text, params } = dialect.sqlToQuery(query);
				return (await client.query(text, params)).rows;
			});
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async publish(
		jobName: string,
		payload: unknown,
		options?: PublishOptions,
		dispatchId?: string,
	): Promise<string> {
		await this.start();
		return this.inTransaction((execute) =>
			this.enqueue(execute, jobName, payload, options, dispatchId),
		);
	}

	async publishInTransaction(
		tx: unknown,
		jobName: string,
		payload: unknown,
		options: PublishOptions | undefined,
		dispatchId: string,
	): Promise<string> {
		await this.start();
		if (!this.transactionalPublishing)
			throw new Error("useApplicationTransaction must be enabled");
		if (
			!tx ||
			typeof tx !== "object" ||
			!("execute" in tx) ||
			typeof tx.execute !== "function"
		) {
			throw new Error(
				"Graphile Worker requires a Drizzle PostgreSQL transaction",
			);
		}
		const transaction = tx as { execute(query: SQL): Promise<unknown> };
		return this.enqueue(
			async (query) => rows(await transaction.execute(query)),
			jobName,
			payload,
			options,
			dispatchId,
		);
	}

	private async enqueue(
		execute: Executor,
		jobName: string,
		payload: unknown,
		options: PublishOptions = {},
		dispatchId: string = randomUUID(),
	): Promise<string> {
		validatePublication(jobName, options);
		await this.ensureQueue(jobName, { policy: options.queuePolicy });
		const receipt = this.table("questpie_dispatches");
		// Framework retention admits the key again after hand-off (or later for
		// secrets). Remove an expired terminal receipt in this transaction rather
		// than acknowledging old work until the independent cleanup timer runs.
		const [expired] =
			await execute(sql`SELECT * FROM ${receipt} WHERE dispatch_id = ${dispatchId}
			AND status IN ('completed', 'failed') AND created_at < clock_timestamp() - interval '7 days' FOR UPDATE`);
		if (expired) {
			// Failed native jobs may be retained indefinitely, and a settled
			// wrapper can still hold its transport lock. Retire its key before
			// replacing the expired lifetime; physical IDs fence late settlement.
			await execute(
				sql`SELECT ${this.table("remove_job")}(${this.physicalKey(expired)})`,
			);
			await execute(sql`INSERT INTO ${this.table("questpie_retired_jobs")} (job_id)
				VALUES (${String(expired.job_id)}::bigint) ON CONFLICT DO NOTHING`);
			await execute(
				sql`DELETE FROM ${receipt} WHERE dispatch_id = ${dispatchId}`,
			);
		}
		const singleton =
			options.singletonKey === undefined
				? null
				: createHash("sha256")
						.update(JSON.stringify([jobName, options.singletonKey]))
						.digest("hex");
		if (singleton) {
			await execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${singleton}, 0))`,
			);
			const [busy] = await execute(
				sql`SELECT dispatch_id FROM ${receipt} WHERE singleton_key = ${singleton} AND status IN ('pending', 'active') AND dispatch_id <> ${dispatchId} LIMIT 1`,
			);
			if (busy)
				throw new SingletonSuppressedError(
					"Graphile Worker singleton publication was suppressed",
				);
		}
		const envelope = encodeQueueDispatchEnvelope(
			payload,
			dispatchId,
			options.idempotencyKey,
			options.secretPayload,
		);
		const inserted =
			await execute(sql`INSERT INTO ${receipt} (dispatch_id, job_name, singleton_key, payload, options, available_at)
			VALUES (${dispatchId}, ${jobName}, ${singleton}, ${JSON.stringify(envelope)}::text::json, ${JSON.stringify(options)}::text::json, ${runAt(options.startAfter)}::text::timestamptz)
			ON CONFLICT DO NOTHING RETURNING *`);
		if (!inserted[0]) {
			const [existing] = await execute(
				sql`SELECT dispatch_id FROM ${receipt} WHERE dispatch_id = ${dispatchId} AND job_name = ${jobName}`,
			);
			if (!existing)
				throw new Error("Graphile Worker dispatch identity conflict");
			return dispatchId;
		}
		await this.materialize(execute, inserted[0]);
		return dispatchId;
	}

	private async materialize(
		execute: Executor,
		record: Record<string, unknown>,
	): Promise<void> {
		const options = record.options as PublishOptions;
		const [job] = await execute(sql`SELECT id FROM ${this.table("add_job")}(
			identifier := ${String(record.job_name)}::text,
			payload := ${JSON.stringify(record.payload)}::text::json,
			run_at := ${record.available_at instanceof Date ? record.available_at.toISOString() : new Date(String(record.available_at)).toISOString()}::text::timestamptz,
			max_attempts := 32767,
			job_key := ${this.physicalKey(record)}::text,
			priority := ${-(options.priority ?? 0)}::int,
			job_key_mode := 'unsafe_dedupe'
		)`);
		if (!job?.id)
			throw new Error("Graphile Worker publication was not accepted");
		await execute(
			sql`UPDATE ${this.table("questpie_dispatches")} SET job_id = ${String(job.id)}::bigint WHERE dispatch_id = ${String(record.dispatch_id)}`,
		);
	}

	private physicalKey(record: Record<string, unknown>): string {
		return `questpie:${String(record.dispatch_id)}:${Number(record.generation)}`;
	}

	private async brokerIsTerminal(
		execute: Executor,
		record: Record<string, unknown>,
	): Promise<boolean> {
		// The public jobs view contains an outer join and cannot be row-locked.
		// Lock the version-checked 0.18 transport row without mutating it, so
		// public administrative operations serialize with admission/settlement.
		const [broker] =
			await execute(sql`SELECT key, locked_at, attempts, max_attempts
			FROM ${this.table("_private_jobs")} WHERE id = ${String(record.job_id)}::bigint FOR UPDATE`);
		return (
			!broker ||
			broker.key !== this.physicalKey(record) ||
			(!broker.locked_at &&
				Number(broker.attempts) >= Number(broker.max_attempts))
		);
	}

	private async admit(
		name: string,
		jobId: string,
		token: string,
	): Promise<Record<string, unknown> | undefined> {
		return this.inTransaction(async (execute) => {
			const [record] =
				await execute(sql`SELECT * FROM ${this.table("questpie_dispatches")}
				WHERE job_id = ${jobId}::bigint AND job_name = ${name} AND status IN ('pending', 'active') FOR UPDATE`);
			if (!record) return;
			if (await this.brokerIsTerminal(execute, record)) {
				await this.settle(execute, record, "failed", false);
				return;
			}
			if (record.status === "active")
				throw new Error("Graphile Worker execution is awaiting lease recovery");
			const started = (record.options as PublishOptions).secretPayload !== true;
			const [active] =
				await execute(sql`UPDATE ${this.table("questpie_dispatches")} SET status = 'active', attempts = attempts + ${started ? 1 : 0}, handler_started = ${started},
				lease_token = ${token}::uuid, lease_until = clock_timestamp() + (COALESCE((options->>'expireInSeconds')::double precision, 900) * interval '1 second')
				WHERE dispatch_id = ${String(record.dispatch_id)} RETURNING *`);
			return active;
		});
	}

	private async beginExecution(
		dispatchId: string,
		token: string,
	): Promise<void> {
		const admitted = await this.inTransaction(async (execute) => {
			const [record] =
				await execute(sql`SELECT * FROM ${this.table("questpie_dispatches")}
				WHERE dispatch_id = ${dispatchId} AND status = 'active' AND lease_token = ${token}::uuid FOR UPDATE`);
			if (!record)
				throw new Error("Graphile Worker execution admission expired");
			if (await this.brokerIsTerminal(execute, record)) {
				await this.settle(execute, record, "failed", false);
				return false;
			}
			const [started] =
				await execute(sql`UPDATE ${this.table("questpie_dispatches")}
				SET handler_started = true, attempts = attempts + ${record.handler_started ? 0 : 1}
				WHERE dispatch_id = ${dispatchId} AND lease_until > clock_timestamp() RETURNING dispatch_id`);
			if (!started)
				throw new Error("Graphile Worker execution admission expired");
			return true;
		});
		if (!admitted) throw new Error("Graphile Worker execution was cancelled");
	}

	/** Rotate physical IDs so late Graphile settlement cannot touch a newer attempt. */
	private async settle(
		execute: Executor,
		record: Record<string, unknown>,
		outcome: "completed" | "failed" | "deferred",
		allowRetry = true,
	): Promise<void> {
		// Every settlement path, including buffered capacity deferral, locks the
		// current transport after the ledger. Recheck public cancellation after
		// the lock wait, before deciding whether a successor may be published.
		if (allowRetry && (await this.brokerIsTerminal(execute, record))) {
			await this.settle(execute, record, "failed", false);
			return;
		}
		const options = record.options as PublishOptions;
		const retry =
			allowRetry &&
			(outcome === "deferred" ||
				(outcome === "failed" &&
					Number(record.attempts) <= (options.retryLimit ?? 2)));
		if (!retry) {
			await execute(sql`UPDATE ${this.table("questpie_dispatches")} SET status = ${outcome}, payload = NULL, options = NULL,
				lease_token = NULL, lease_until = NULL, finished_at = now() WHERE dispatch_id = ${String(record.dispatch_id)}`);
			return;
		}
		await execute(
			sql`INSERT INTO ${this.table("questpie_retired_jobs")} (job_id) VALUES (${String(record.job_id)}::bigint) ON CONFLICT DO NOTHING`,
		);
		// remove_job retires the physical key without unlocking active siblings.
		// returnJobs can make that old row runnable again; ownership below uses
		// the ledger/envelope, so retired rows are acknowledged without user code.
		const [removed] = await execute(
			sql`SELECT id FROM ${this.table("remove_job")}(${this.physicalKey(record)})`,
		);
		// remove_job atomically claims the old key and holds its row lock until
		// commit. If an administrator already removed it, no successor is admitted.
		if (!removed?.id) {
			await this.settle(execute, record, "failed", false);
			return;
		}
		const delay =
			outcome === "deferred"
				? record.status === "active"
					? 1
					: 0
				: Math.min(
						86400,
						(options.retryDelay ?? 0) *
							(options.retryBackoff
								? 2 ** Math.min(Number(record.attempts) - 1, 30)
								: 1),
					);
		const [next] =
			await execute(sql`UPDATE ${this.table("questpie_dispatches")} SET status = 'pending', generation = generation + 1,
			attempts = attempts - ${outcome === "deferred" && record.status === "active" && record.handler_started ? 1 : 0}, lease_token = NULL, lease_until = NULL,
			available_at = now() + (${delay} * interval '1 second') WHERE dispatch_id = ${String(record.dispatch_id)} RETURNING *`);
		await this.materialize(execute, next!);
	}

	private async finish(
		dispatchId: string,
		token: string,
		outcome: "completed" | "failed" | "deferred",
		deadline: Date,
		allowRetry = true,
	): Promise<void> {
		for (;;) {
			try {
				await this.inTransaction(async (execute) => {
					const [record] =
						await execute(sql`SELECT * FROM ${this.table("questpie_dispatches")} WHERE dispatch_id = ${dispatchId}
				AND status = 'active' AND lease_token = ${token}::uuid FOR UPDATE`);
					if (record) {
						await this.settle(execute, record, outcome, allowRetry);
					}
				});
				return;
			} catch (error) {
				this.emitError(error);
				// Preserve success while this token and its session fence remain owned.
				// A database error is not an application failure or a new attempt.
				if (
					this.fatalError ||
					(outcome !== "completed" && Date.now() >= deadline.getTime())
				)
					throw error;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
	}

	async inspectExecutionState(
		jobName: string,
		adapterJobId: string,
	): Promise<QueueExecutionState> {
		await this.start();
		const [record] = await this
			.execute(sql`SELECT d.status, d.dispatch_id, d.generation, j.id AS broker_id, j.key, j.locked_at, j.attempts, j.max_attempts FROM ${this.table("questpie_dispatches")} d
			LEFT JOIN ${this.table("jobs")} j ON j.id = d.job_id WHERE d.dispatch_id = ${adapterJobId} AND d.job_name = ${jobName}`);
		if (!record) return "missing";
		if (record.status === "completed" || record.status === "failed")
			return record.status;
		if (!record.broker_id) return "missing";
		if (
			record.key !== this.physicalKey(record) ||
			(!record.locked_at &&
				Number(record.attempts) >= Number(record.max_attempts))
		)
			return "failed";
		return record.status === "active" ? "active" : "pending";
	}

	private async recoverLeases(): Promise<void> {
		await this.inTransaction(async (execute) => {
			// The two deadline scans use partial indexes; pending backlog never
			// participates in a full join against Graphile's public jobs view.
			const expired =
				await execute(sql`SELECT d.* FROM ${this.table("questpie_dispatches")} d
				WHERE d.dispatch_id IN (
					(SELECT dispatch_id FROM ${this.table("questpie_dispatches")}
					 WHERE status = 'active' AND lease_until <= now()
					 AND pg_try_advisory_xact_lock(hashtextextended(${"questpie-execution:" + this.schema + ":"} || dispatch_id, 0))
					 ORDER BY lease_until LIMIT 100)
					UNION ALL
					(SELECT p.dispatch_id FROM ${this.table("_private_jobs")} j
					 JOIN ${this.table("questpie_dispatches")} p ON p.job_id = j.id
					 WHERE j.locked_at IS NOT NULL AND j.locked_at <= now()
					 AND p.status = 'pending'
					 AND j.locked_at + (COALESCE((p.options->>'expireInSeconds')::double precision, 900) * interval '1 second') <= now()
					 ORDER BY j.locked_at LIMIT 100)
				) LIMIT 100 FOR UPDATE OF d SKIP LOCKED`);
			for (const record of expired) {
				const [lock] = await execute(
					sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${this.executionKey(String(record.dispatch_id))}, 0)) AS acquired`,
				);
				if (!lock?.acquired) continue;
				await this.settle(
					execute,
					record,
					record.status === "active" && record.handler_started
						? "failed"
						: "deferred",
				);
			}
		});
		if (Date.now() - this.lastAuditAt < 5000) return;
		await this.inTransaction(async (execute) => {
			// Keyset audit catches administrative removals without repeatedly
			// scanning 100k healthy pending rows in every worker process.
			const records = await execute(sql`WITH batch AS MATERIALIZED (
				SELECT * FROM ${this.table("questpie_dispatches")}
				WHERE status IN ('pending', 'active') AND dispatch_id > ${this.auditCursor}
				ORDER BY dispatch_id LIMIT 100 FOR UPDATE SKIP LOCKED
			) SELECT batch.*, (j.id IS NULL OR j.key IS DISTINCT FROM ('questpie:' || batch.dispatch_id || ':' || batch.generation::text)
				OR (j.locked_at IS NULL AND j.attempts >= j.max_attempts)) AS broker_terminal
				FROM batch LEFT JOIN ${this.table("_private_jobs")} j ON j.id = batch.job_id ORDER BY batch.dispatch_id`);
			for (const record of records) {
				if (
					record.broker_terminal &&
					(await this.brokerIsTerminal(execute, record))
				)
					await this.settle(execute, record, "failed", false);
			}
			this.auditCursor =
				records.length === 100 ? String(records.at(-1)!.dispatch_id) : "";
		});
		this.lastAuditAt = Date.now();
	}

	private armRecovery(): void {
		this.recoveryTimer = setTimeout(() => {
			this.recoveryTick = this.recoverLeases()
				.catch((error) => this.emitError(error))
				.finally(() => {
					this.recoveryTick = undefined;
					if (this.listening) this.armRecovery();
				});
		}, 1000);
		this.recoveryTimer.unref();
	}

	async schedule(
		jobName: string,
		cron: string,
		payload: unknown,
		options: ScheduleOptions = {},
	): Promise<void> {
		await this.start();
		validatePublication(jobName, options);
		await this.ensureQueue(jobName, { policy: options.queuePolicy });
		parseCronItem({ task: jobName, match: cron });
		await this
			.execute(sql`INSERT INTO ${this.table("questpie_schedules")} (job_name, cron, payload, options)
			VALUES (${jobName}, ${cron}, ${JSON.stringify(payload)}::text::json, ${JSON.stringify(options)}::text::json)
			ON CONFLICT (job_name) DO UPDATE SET cron = EXCLUDED.cron, payload = EXCLUDED.payload, options = EXCLUDED.options`);
	}

	async unschedule(jobName: string): Promise<void> {
		await this.start();
		await this.execute(
			sql`DELETE FROM ${this.table("questpie_schedules")} WHERE job_name = ${jobName}`,
		);
	}

	private async tickSchedules(): Promise<void> {
		const retiredPass = await this.inTransaction(async (execute) => {
			const schedules =
				await execute(sql`SELECT *, date_trunc('minute', now()) AS current_minute FROM ${this.table("questpie_schedules")}
				WHERE last_run < date_trunc('minute', now()) FOR UPDATE SKIP LOCKED`);
			for (const schedule of schedules) {
				const date = new Date(String(schedule.current_minute));
				const name = String(schedule.job_name);
				const cron = parseCronItem({
					task: name,
					match: String(schedule.cron),
				});
				if (
					cron.match({
						min: date.getUTCMinutes(),
						hour: date.getUTCHours(),
						date: date.getUTCDate(),
						month: date.getUTCMonth() + 1,
						dow: date.getUTCDay(),
					})
				) {
					await execute(sql`SAVEPOINT questpie_schedule`);
					try {
						await this.enqueue(
							execute,
							name,
							schedule.payload,
							schedule.options as ScheduleOptions,
						);
					} catch (error) {
						if (!(error instanceof SingletonSuppressedError)) throw error;
						await execute(sql`ROLLBACK TO SAVEPOINT questpie_schedule`);
					}
					await execute(sql`RELEASE SAVEPOINT questpie_schedule`);
				}
				await execute(
					sql`UPDATE ${this.table("questpie_schedules")} SET last_run = ${date.toISOString()}::timestamptz WHERE job_name = ${name}`,
				);
			}
			// Framework receipts guard longer secret completion windows. Adapter
			// retention starts at admission so it cannot outlive a newly admitted
			// framework lifetime solely because its own completion happened later.
			await execute(sql`DELETE FROM ${this.table("questpie_dispatches")} WHERE dispatch_id IN (
				SELECT d.dispatch_id FROM ${this.table("questpie_dispatches")} d
				WHERE d.status IN ('completed', 'failed') AND d.created_at < now() - interval '7 days'
				AND NOT EXISTS (SELECT FROM ${this.table("jobs")} j WHERE j.id = d.job_id)
				LIMIT 500)`);
			// Freeze the pass endpoint so higher arrivals cannot postpone wrapping.
			let pass = this.retiredPass;
			if (!pass) {
				const [last] =
					await execute(sql`SELECT job_id AS pass_end FROM ${this.table("questpie_retired_jobs")}
					ORDER BY job_id DESC LIMIT 1`);
				if (!last) return undefined;
				pass = { end: String(last.pass_end) };
			}
			const lowerBound =
				pass.cursor === undefined
					? sql`job_id >= ${"-9223372036854775808"}::bigint`
					: sql`job_id > ${pass.cursor}::bigint`;
			// Bound ledger reads before checking native locks, and advance even
			// across fully locked pages. LATERAL bounds native PK probes as well.
			const retired = await execute(sql`SELECT r.job_id, j.removable FROM (
				SELECT job_id FROM ${this.table("questpie_retired_jobs")}
				WHERE ${lowerBound} AND job_id <= ${pass.end}::bigint ORDER BY job_id LIMIT 500
			) r LEFT JOIN LATERAL (
				SELECT (locked_at IS NULL OR locked_at < now() - interval '4 hours') AS removable
				FROM ${this.table("_private_jobs")} WHERE id = r.job_id LIMIT 1
			) j ON true ORDER BY r.job_id`);
			if (retired.length > 0) {
				const lastId = String(retired.at(-1)!.job_id);
				const removable = retired
					.filter((row) => row.removable)
					.map((row) => String(row.job_id));
				if (removable.length > 0)
					await execute(
						sql`SELECT ${this.table("complete_jobs")}(${sql.param(removable)}::bigint[])`,
					);
				// Resolve tuple locations inside this statement: Tid Scan avoids a
				// second, unbounded ledger scan when deleting the bounded page.
				await execute(sql`DELETE FROM ${this.table("questpie_retired_jobs")} r
					WHERE r.ctid = ANY(ARRAY(
						SELECT ctid FROM ${this.table("questpie_retired_jobs")}
						WHERE ${lowerBound} AND job_id <= ${lastId}::bigint
						ORDER BY job_id LIMIT 500
					)) AND (SELECT j.id FROM ${this.table("_private_jobs")} j WHERE j.id = r.job_id LIMIT 1) IS NULL`);
				return retired.length === 500 && BigInt(lastId) < BigInt(pass.end)
					? { cursor: lastId, end: pass.end }
					: undefined;
			}
			return undefined;
		});
		this.retiredPass = retiredPass;
	}

	private armSchedules(): void {
		this.scheduleTimer = setTimeout(
			() => {
				this.scheduleTick = this.tickSchedules()
					.catch((error) => this.emitError(error))
					.finally(() => {
						this.scheduleTick = undefined;
						if (this.listening) this.armSchedules();
					});
			},
			60_000 - (Date.now() % 60_000),
		);
		this.scheduleTimer.unref();
	}

	async listen(
		handlers: QueueHandlerMap,
		options: QueueListenOptions = {},
	): Promise<void> {
		await this.start();
		if (this.stopping) throw new Error("Graphile Worker adapter is stopping");
		if (this.listening)
			throw new Error("Graphile Worker adapter already has a runner");
		const teamSize = positiveInteger(options.teamSize ?? 1, "teamSize");
		const concurrency = this.options.concurrentJobs ?? 10;
		positiveInteger(options.batchSize ?? concurrency, "batchSize");
		const tasks: TaskList = {};
		const reservations = new Map<string, () => void>();
		const limits = new Map<string, HandlerPermits>();
		for (const [name, handler] of Object.entries(handlers)) {
			if (reservedTask(name))
				throw new Error("Graphile Worker job name is reserved");
			const permits = new HandlerPermits(teamSize, () => {
				if (this.listening && !this.runnerClosing)
					this.runner?.nudge(concurrency);
			});
			limits.set(name, permits);
			const executeTask: TaskList[string] = async (payload, helpers) => {
				const release =
					reservations.get(String(helpers.job.id)) ?? (await permits.acquire());
				reservations.delete(String(helpers.job.id));

				let timer: ReturnType<typeof setTimeout> | undefined;
				let dispatchId: string | undefined;
				let controller: AbortController | undefined;
				let lockedDispatch: string | undefined;
				let fenceAcquired = false;
				try {
					const [identity] = await this.execute(
						sql`SELECT dispatch_id FROM ${this.table("questpie_dispatches")} WHERE job_id = ${String(helpers.job.id)}::bigint
						UNION ALL SELECT NULL AS dispatch_id FROM ${this.table("questpie_retired_jobs")} WHERE job_id = ${String(helpers.job.id)}::bigint`,
					);
					const owned =
						Boolean(identity) ||
						Boolean(
							payload &&
							typeof payload === "object" &&
							"__questpieQueue" in payload,
						);
					if (this.runnerClosing && owned) {
						await this.inTransaction(async (execute) => {
							const [record] = await execute(
								sql`SELECT * FROM ${this.table("questpie_dispatches")} WHERE job_id = ${String(helpers.job.id)}::bigint AND status = 'pending' FOR UPDATE`,
							);
							if (record) await this.settle(execute, record, "deferred");
						});
						return;
					}
					if (!owned) {
						await handler({
							id: String(helpers.job.id),
							data: payload,
							finalAttempt: helpers.job.attempts >= helpers.job.max_attempts,
							signal: helpers.abortSignal,
						});
						return;
					}

					if (!identity?.dispatch_id) return;
					const key = this.executionKey(String(identity.dispatch_id));
					if (this.executing.has(key))
						throw new Error("Graphile Worker dispatch is still executing");
					this.executing.add(key);
					lockedDispatch = key;
					const lock = await this.executionCommand(
						"SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
						[key],
					);
					if (!lock.rows[0].acquired)
						throw new Error("Graphile Worker dispatch is still executing");
					fenceAcquired = true;
					const token = randomUUID();
					const record = await this.admit(name, String(helpers.job.id), token);
					if (!record) return;
					dispatchId = String(record.dispatch_id);
					controller = new AbortController();
					this.activeControllers.set(dispatchId, controller);
					const options = record.options as PublishOptions;
					const duration = (options.expireInSeconds ?? 900) * 1000;
					timer = setTimeout(
						() => controller!.abort(new QueueExecutionTimeoutError()),
						duration,
					);
					let deferred = false;
					let handlerStarted = record.handler_started === true;
					let outcome: "completed" | "failed" = "completed";
					let permanent = false;
					try {
						const decoded = decodeQueueDispatchEnvelope(payload, dispatchId);
						if (
							decoded.dispatchId !== dispatchId ||
							(options.secretPayload === true && !decoded.secretPayload)
						)
							throw new QueueAdmissionError(
								"Graphile Worker dispatch envelope is invalid",
							);
						await withQueueAbort(
							handler({
								id: dispatchId,
								...decoded,
								finalAttempt:
									Number(record.attempts) + (handlerStarted ? 0 : 1) >
									(options.retryLimit ?? 2),
								signal: controller.signal,
								executionLeaseMs: Math.max(
									1,
									Math.floor(Math.min(duration, 60_000)),
								),
								executionDeadline: new Date(record.lease_until as Date),
								defer: () => {
									deferred = true;
								},
								beginExecution: async () => {
									await this.beginExecution(dispatchId!, token);
									handlerStarted = true;
								},
							}),
							controller.signal,
						);
						if (Date.now() >= new Date(record.lease_until as Date).getTime())
							throw new Error("QUESTPIE Queue execution expired");
					} catch (error) {
						permanent = error instanceof QueueAdmissionError;
						if (!handlerStarted && !permanent) throw error;
						outcome = "failed";
					}
					await this.finish(
						dispatchId,
						token,
						!permanent &&
							(deferred || (this.stopping && controller.signal.aborted))
							? "deferred"
							: outcome,
						new Date(record.lease_until as Date),
						!permanent,
					);
				} finally {
					if (timer) clearTimeout(timer);
					if (
						dispatchId &&
						this.activeControllers.get(dispatchId) === controller
					)
						this.activeControllers.delete(dispatchId);
					try {
						if (lockedDispatch && fenceAcquired)
							await this.executionCommand(
								"SELECT pg_advisory_unlock(hashtextextended($1, 0))",
								[lockedDispatch],
							);
					} finally {
						if (lockedDispatch) this.executing.delete(lockedDispatch);
						release();
					}
				}
			};
			tasks[name] = (payload, helpers) => {
				const running = Promise.resolve().then(() =>
					executeTask(payload, helpers),
				);
				this.activeTasks.add(running);
				void running.then(
					() => this.activeTasks.delete(running),
					() => this.activeTasks.delete(running),
				);
				return running;
			};
		}
		if (Object.keys(tasks).length === 0)
			throw new Error("Graphile Worker listen requires at least one handler");
		// Graphile re-reads enumerable TaskList names for each shared fetch.
		// Keep buffered handlers addressable while omitting saturated names from
		// future batches. The idle task keeps the supported list nonempty.
		tasks[capacityTask] = async () => {};
		tasks[capacityRetryTask] = async () => {};
		let discoveryRetry = false;
		const runnableTasks = new Proxy(tasks, {
			ownKeys: (target) => {
				const names = Object.keys(target).filter(
					(name) =>
						reservedTask(name) ||
						(!this.runnerClosing && !limits.get(name)?.full),
				);
				return discoveryRetry ? [...names.slice(1), names[0]!] : names;
			},
		});
		this.listening = true;
		let ready!: () => void;
		this.listenStarting = new Promise<void>((resolve) => (ready = resolve));
		try {
			await this.connectExecutionClient();
			const events = new EventEmitter() as WorkerEvents;
			events.on("pool:listen:notification", ({ message }) => {
				if (message.channel !== "worker:migrate") return;
				// 0.18 notifies database-wide without a schema. Its synchronous event
				// runs before main.js reads this payload; suppress that unscoped check
				// and check the migration ledger of our schema instead.
				message.payload = "{}";
				void this.execute(
					sql`SELECT id FROM ${this.table("migrations")} WHERE breaking AND id > ${this.migrationRevision} LIMIT 1`,
				)
					.then((rows) => {
						if (rows.length)
							this.fatal(
								new Error("Breaking migration of the Graphile Worker schema"),
							);
					})
					.catch((error) => this.fatal(error));
			});
			events.on("pool:gracefulShutdown", () =>
				this.fatal(new Error("Graphile Worker initiated shutdown")),
			);
			events.on("localQueue:getJobs:complete", ({ jobs }) => {
				for (const job of jobs) {
					const release = limits.get(job.task_identifier)?.tryAcquire();
					if (release) reservations.set(String(job.id), release);
				}
			});
			events.on("localQueue:returnJobs", ({ jobs }) => {
				for (const job of jobs) {
					const id = String(job.id);
					const release = reservations.get(id);
					reservations.delete(id);
					release?.();
				}
			});
			events.on("localQueue:setMode", ({ newMode }) => {
				this.bufferWaiting = newMode === "WAITING";
				if (!this.bufferWaiting) this.bufferDrained?.();
			});
			for (const event of [
				"pool:listen:error",
				"worker:getJob:error",
				"pool:fatalError",
				"resetLocked:failure",
				"job:error",
			] as const) {
				events.on(event, ({ error }) => this.emitError(error));
			}
			const runnerPool = this.options.listenConnectionString
				? new pg.Pool({
						connectionString: this.options.listenConnectionString,
						max: this.options.maxPoolSize ?? 10,
					})
				: this.pool!;
			this.runnerPool = runnerPool;
			if (runnerPool !== this.pool)
				runnerPool.on("error", (error) => this.emitError(error));
			if (runnerPool !== this.pool)
				runnerPool.on("connect", (client) =>
					client.on("error", (error) => this.emitError(error)),
				);
			this.runner = runTaskList(
				{
					pgPool: runnerPool,
					schema: this.schema,
					concurrency,
					pollInterval: this.options.pollInterval ?? 1000,
					noHandleSignals: true,
					noPreparedStatements: this.options.noPreparedStatements,
					events,
					logger: new Logger(() => (level, message, metadata) => {
						if (level !== "error") return;
						// Graphile logs concurrent joins of the same shutdown
						// promise as errors, although the operation succeeds.
						if (
							message ===
							"gracefulShutdown called when gracefulShutdown is already in progress"
						)
							return;
						// 0.18 caches a rejected task-discovery promise until the
						// enumerable list changes. Reorder the same supported names
						// after an error so the next shared fetch retries discovery.
						// Two reserved idle tasks keep this possible even at capacity.
						discoveryRetry = !discoveryRetry;
						this.emitError(metadata.error ?? new Error(message));
					}),
					preset: {
						worker: {
							localQueue: { size: 1 },
							completeJobBatchDelay: 0,
							failJobBatchDelay: 0,
						},
					},
				},
				runnableTasks,
				runnerPool,
			);
			void this.runner.promise.then(
				() => this.fatal(new Error("Graphile Worker runner terminated")),
				(error) => this.fatal(error),
			);
			await this.checkListener(events);
			await this.recoverLeases();
			if (this.listening) {
				this.armRecovery();
				this.armSchedules();
			}
		} catch (error) {
			try {
				await this.closeRunner();
			} finally {
				this.listening = false;
			}
			throw error;
		} finally {
			this.listenStarting = undefined;
			ready();
		}
	}

	private async checkListener(events: WorkerEvents): Promise<void> {
		const probe = randomUUID();
		await new Promise<void>((resolve, reject) => {
			let listener: pg.PoolClient | undefined;
			const timer = setTimeout(() => {
				cleanup();
				reject(
					new Error(
						"Graphile Worker LISTEN self-check timed out; listenConnectionString must use a direct or session-pooled connection",
					),
				);
			}, 3000);
			const cleanup = () => {
				clearTimeout(timer);
				events.off("pool:listen:notification", received);
				events.off("pool:listen:success", listening);
				listener?.off("drain", send);
			};
			const received: (event: { message: pg.Notification }) => void = ({
				message,
			}) => {
				if (
					message.channel === "jobs:insert" &&
					message.payload === JSON.stringify({ count: 0, probe })
				) {
					cleanup();
					resolve();
				}
			};
			const send = () => {
				void this.execute(
					sql`SELECT pg_notify('jobs:insert', ${JSON.stringify({ count: 0, probe })})`,
				).catch((error) => {
					cleanup();
					reject(error);
				});
			};
			const listening = ({ client }: { client: pg.PoolClient }) => {
				listener?.off("drain", send);
				listener = client;
				// Graphile emits success before it queues LISTEN. pg's drain event
				// runs after that query has committed, before the probe is sent.
				client.once("drain", send);
			};
			events.on("pool:listen:notification", received);
			events.on("pool:listen:success", listening);
		});
	}

	private async closeRunner(): Promise<void> {
		this.runnerClosing = true;
		try {
			// Graphile 0.18's WAITING -> RELEASED path backgrounds returned jobs
			// after marking the queue released, and can throw. Drain its existing
			// buffer through retry-free admission while the TaskList exposes only
			// the idle task; no new real work is fetched during this phase.
			if (this.bufferWaiting)
				await new Promise<void>((resolve) => {
					this.bufferDrained = resolve;
				});
			await this.runner?.gracefulShutdown();
		} finally {
			// Graphile can detach task promises during shutdown after its own
			// abort timeout. Keep fences until the actual handlers have settled.
			await Promise.allSettled(this.activeTasks);
			this.runner = undefined;
			const executionClient = this.executionClient;
			this.executionClient = undefined;
			await executionClient?.end();
			const runnerPool = this.runnerPool;
			this.runnerPool = undefined;
			try {
				if (runnerPool && runnerPool !== this.pool) await runnerPool.end();
			} finally {
				this.runnerClosing = false;
				this.bufferWaiting = false;
				this.bufferDrained = undefined;
			}
		}
	}

	async stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.stopping = this.shutdown();
		try {
			await this.stopping;
		} finally {
			this.stopping = undefined;
		}
	}

	private async shutdown(): Promise<void> {
		this.listening = false;
		this.runnerClosing = true;
		for (const controller of this.activeControllers.values())
			controller.abort();
		if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
		await this.starting;
		await this.listenStarting;
		await this.scheduleTick;
		await this.recoveryTick;
		try {
			await this.closeRunner();
		} finally {
			await this.pool?.end();
			this.pool = undefined;
			this.starting = undefined;
		}
	}
}

class HandlerPermits {
	private active = 0;
	private readonly waiting: Array<() => void> = [];
	constructor(
		private readonly limit: number,
		private readonly onRelease: () => void,
	) {}
	get full(): boolean {
		return this.active >= this.limit;
	}
	private release = () => {
		const next = this.waiting.shift();
		if (next) next();
		else this.active--;
		this.onRelease();
	};
	tryAcquire(): (() => void) | undefined {
		if (this.full) return;
		this.active++;
		return this.release;
	}
	async acquire(): Promise<() => void> {
		if (this.active >= this.limit)
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		else this.active++;
		return this.release;
	}
}

function rows(result: unknown): Record<string, unknown>[] {
	if (Array.isArray(result)) return result;
	if (
		result &&
		typeof result === "object" &&
		"rows" in result &&
		Array.isArray(result.rows)
	)
		return result.rows;
	throw new Error(
		"Graphile Worker requires a Drizzle PostgreSQL execute result",
	);
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new Error(`${name} must be a positive integer`);
	return value;
}

function runAt(value: PublishOptions["startAfter"]): string {
	const date =
		value === undefined
			? new Date()
			: typeof value === "number"
				? new Date(Date.now() + value * 1000)
				: new Date(value);
	if (!Number.isFinite(date.getTime()))
		throw new Error("startAfter must be a valid date or delay in seconds");
	return date.toISOString();
}

function validatePublication(jobName: string, options: PublishOptions): void {
	if (reservedTask(jobName))
		throw new Error("Graphile Worker job name is reserved");
	if (!jobName || jobName.length > 128)
		throw new Error("Graphile Worker job names must contain 1–128 characters");
	if (
		options.retryLimit !== undefined &&
		(!Number.isSafeInteger(options.retryLimit) ||
			options.retryLimit < 0 ||
			options.retryLimit > 32766)
	)
		throw new Error("retryLimit must be an integer between 0 and 32766");
	if (
		options.retryDelay !== undefined &&
		(!Number.isFinite(options.retryDelay) ||
			options.retryDelay < 0 ||
			options.retryDelay > 86400)
	)
		throw new Error("retryDelay must be between 0 and 86400 seconds");
	if (
		options.priority !== undefined &&
		(!Number.isInteger(options.priority) ||
			options.priority < -32767 ||
			options.priority > 32768)
	)
		throw new Error("priority must be an integer between -32767 and 32768");
	if (
		options.expireInSeconds !== undefined &&
		(!Number.isFinite(options.expireInSeconds) ||
			options.expireInSeconds <= 0 ||
			options.expireInSeconds > 2147483)
	)
		throw new Error(
			"expireInSeconds must be positive and at most 2147483 seconds",
		);
}

export function graphileWorkerAdapter(
	options: GraphileWorkerAdapterOptions,
): GraphileWorkerAdapter {
	return new GraphileWorkerAdapter(options);
}

class SingletonSuppressedError extends Error {}
