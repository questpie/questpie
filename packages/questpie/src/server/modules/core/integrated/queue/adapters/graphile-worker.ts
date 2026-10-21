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
import { withQueueAbort } from "../execution-signal.js";
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
	/** Recovery polling for scheduled jobs and retries, in milliseconds. Default: 1000. */
	pollInterval?: number;
	/** Requires the queue and application transaction to use the same database. */
	useApplicationTransaction?: boolean;
	/** Disable named prepared statements when using a transaction pooler. */
	noPreparedStatements?: boolean;
}

type Executor = (query: SQL) => Promise<Record<string, unknown>[]>;
type ScheduleOptions = Omit<
	PublishOptions,
	"idempotencyKey" | "startAfter" | "secretPayload"
>;
const dialect = new PgDialect();

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
	private readonly options: GraphileWorkerAdapterOptions;
	private readonly schema: string;
	private readonly errors = new Set<(error: Error) => void>();
	private pool?: pg.Pool;
	private runnerPool?: pg.Pool;
	private runner?: WorkerPool;
	private starting?: Promise<void>;
	private stopping?: Promise<void>;
	private listening = false;
	private listenStarting?: Promise<void>;
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

	private emitError(error: unknown): void {
		const normalized =
			error instanceof Error ? error : new Error(String(error));
		for (const handler of this.errors) handler(normalized);
	}

	on(_event: "error", handler: (error: Error) => void): void {
		this.errors.add(handler);
	}

	async start(): Promise<void> {
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
			await this.inTransaction(async (execute) => {
				await execute(
					sql`SELECT pg_advisory_xact_lock(hashtextextended(${"questpie-graphile:" + this.schema}, 0))`,
				);
				await execute(sql`CREATE TABLE IF NOT EXISTS ${this.table("questpie_dispatches")} (
					dispatch_id text PRIMARY KEY, job_name text NOT NULL, job_id bigint UNIQUE,
					singleton_key text, payload json, options json,
					status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
					generation integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
					available_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
					created_at timestamptz NOT NULL DEFAULT now()
				)`);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_lease ON ${this.table("questpie_dispatches")} (lease_until) WHERE status = 'active'`,
				);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_pending ON ${this.table("questpie_dispatches")} (available_at) WHERE status = 'pending'`,
				);
				await execute(
					sql`CREATE INDEX IF NOT EXISTS questpie_dispatches_finished ON ${this.table("questpie_dispatches")} (finished_at)`,
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
			});
		} catch (error) {
			await pool.end();
			this.pool = undefined;
			throw error;
		}
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
		const receipt = this.table("questpie_dispatches");
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
			max_attempts := 1,
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

	/** Rotate physical IDs so late Graphile settlement cannot touch a newer attempt. */
	private async settle(
		execute: Executor,
		record: Record<string, unknown>,
		outcome: "completed" | "failed" | "deferred",
		allowRetry = true,
	): Promise<void> {
		const options = record.options as PublishOptions;
		const retry =
			allowRetry &&
			(outcome === "deferred" ||
				(outcome === "failed" &&
					Number(record.attempts) <= (options.retryLimit ?? 2)));
		if (!retry) {
			const [settled] =
				await execute(sql`UPDATE ${this.table("questpie_dispatches")} SET status = ${outcome}, payload = NULL, options = NULL,
				lease_token = NULL, lease_until = NULL, finished_at = now() WHERE dispatch_id = ${String(record.dispatch_id)}
				AND (${outcome} <> 'completed' OR lease_until > clock_timestamp()) RETURNING dispatch_id`);
			// The row is already locked. Enforce expiry in the terminal write,
			// independently of delayed JavaScript timers or database round trips.
			if (!settled && outcome === "completed") {
				this.activeControllers.get(String(record.dispatch_id))?.abort();
				await this.settle(execute, record, "failed");
			}
			return;
		}
		await execute(
			sql`INSERT INTO ${this.table("questpie_retired_jobs")} (job_id) VALUES (${String(record.job_id)}::bigint) ON CONFLICT DO NOTHING`,
		);
		// remove_job clears a locked job's key and prevents another native attempt;
		// it never unlocks siblings that share Graphile's process-wide pool ID.
		await execute(
			sql`SELECT ${this.table("remove_job")}(${this.physicalKey(record)})`,
		);
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
			attempts = attempts - ${outcome === "deferred" && record.status === "active" ? 1 : 0}, lease_token = NULL, lease_until = NULL,
			available_at = now() + (${delay} * interval '1 second') WHERE dispatch_id = ${String(record.dispatch_id)} RETURNING *`);
		await this.materialize(execute, next!);
	}

	private async finish(
		dispatchId: string,
		token: string,
		outcome: "completed" | "failed" | "deferred",
	): Promise<void> {
		await this.inTransaction(async (execute) => {
			const [record] =
				await execute(sql`SELECT * FROM ${this.table("questpie_dispatches")} WHERE dispatch_id = ${dispatchId}
				AND status = 'active' AND lease_token = ${token}::uuid FOR UPDATE`);
			if (record) await this.settle(execute, record, outcome);
		});
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
			const expired =
				await execute(sql`SELECT d.*, (j.id IS NULL OR j.key IS DISTINCT FROM
					('questpie:' || d.dispatch_id || ':' || d.generation::text) OR
					(j.locked_at IS NULL AND j.attempts >= j.max_attempts)) AS transport_terminal
				FROM ${this.table("questpie_dispatches")} d
				LEFT JOIN ${this.table("jobs")} j ON j.id = d.job_id
				WHERE d.status IN ('pending', 'active') AND (j.id IS NULL OR
					j.key IS DISTINCT FROM ('questpie:' || d.dispatch_id || ':' || d.generation::text) OR
					(j.locked_at IS NULL AND j.attempts >= j.max_attempts) OR
					(d.status = 'active' AND d.lease_until <= clock_timestamp()) OR
					(d.status = 'pending' AND d.available_at <= now() AND
						j.locked_at + (COALESCE((d.options->>'expireInSeconds')::double precision, 900) * interval '1 second') <= clock_timestamp()))
				ORDER BY d.available_at LIMIT 100 FOR UPDATE OF d SKIP LOCKED`);
			for (const record of expired) {
				this.activeControllers.get(String(record.dispatch_id))?.abort();
				// A fetched job may still be waiting for a local permit/buffer slot
				// in a healthy runner. Reclaim transport without spending a handler
				// attempt; the old physical ID cannot activate the new generation.
				await this.settle(
					execute,
					record,
					record.transport_terminal || record.status === "active"
						? "failed"
						: "deferred",
					!record.transport_terminal,
				);
			}
		});
	}

	private armRecovery(): void {
		this.recoveryTimer = setTimeout(
			() => {
				this.recoveryTick = this.recoverLeases()
					.catch((error) => this.emitError(error))
					.finally(() => {
						this.recoveryTick = undefined;
						if (this.listening) this.armRecovery();
					});
			},
			Math.min(this.options.pollInterval ?? 1000, 1000),
		);
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
		await this.inTransaction(async (execute) => {
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
			// Keep receipts for seven days, and longer while their broker job exists.
			await execute(sql`DELETE FROM ${this.table("questpie_dispatches")} WHERE dispatch_id IN (
				SELECT d.dispatch_id FROM ${this.table("questpie_dispatches")} d
				WHERE d.finished_at < now() - interval '7 days'
				AND NOT EXISTS (SELECT FROM ${this.table("jobs")} j WHERE j.id = d.job_id)
				LIMIT 500)`);
			await execute(
				sql`SELECT ${this.table("complete_jobs")}(ARRAY(SELECT job_id FROM ${this.table("questpie_retired_jobs")} LIMIT 500))`,
			);
			await execute(
				sql`DELETE FROM ${this.table("questpie_retired_jobs")} r WHERE NOT EXISTS (SELECT FROM ${this.table("jobs")} j WHERE j.id = r.job_id)`,
			);
		});
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
		const batchSize = positiveInteger(
			options.batchSize ?? concurrency,
			"batchSize",
		);
		const tasks: TaskList = {};
		for (const [name, handler] of Object.entries(handlers)) {
			const permits = new HandlerPermits(teamSize);
			tasks[name] = async (payload, helpers) => {
				const release = await permits.acquire();
				let timer: ReturnType<typeof setTimeout> | undefined;
				let dispatchId: string | undefined;
				let controller: AbortController | undefined;
				try {
					if (!helpers.job.key?.startsWith("questpie:")) {
						await handler({
							id: String(helpers.job.id),
							data: payload,
							finalAttempt: helpers.job.attempts >= helpers.job.max_attempts,
							signal: helpers.abortSignal,
						});
						return;
					}
					const token = randomUUID();
					const [record] = await this
						.execute(sql`UPDATE ${this.table("questpie_dispatches")} SET status = 'active', attempts = attempts + 1,
						lease_token = ${token}::uuid, lease_until = now() + (COALESCE((options->>'expireInSeconds')::double precision, 900) * interval '1 second')
						WHERE job_id = ${String(helpers.job.id)}::bigint AND job_name = ${name} AND status = 'pending' RETURNING *`);
					if (!record) return;
					dispatchId = String(record.dispatch_id);
					controller = new AbortController();
					this.activeControllers.set(dispatchId, controller);
					const options = record.options as PublishOptions;
					const duration = (options.expireInSeconds ?? 900) * 1000;
					timer = setTimeout(() => controller!.abort(), duration);
					let deferred = false;
					try {
						await withQueueAbort(
							handler({
								id: dispatchId,
								...decodeQueueDispatchEnvelope(payload, dispatchId),
								finalAttempt:
									Number(record.attempts) > (options.retryLimit ?? 2),
								signal: controller.signal,
								executionLeaseMs: Math.max(
									1,
									Math.floor(Math.min(duration, 60_000)),
								),
								executionDeadline: new Date(record.lease_until as Date),
								defer: () => {
									deferred = true;
								},
							}),
							controller.signal,
						);
						await this.finish(
							dispatchId,
							token,
							deferred ? "deferred" : "completed",
						);
					} catch {
						await this.finish(dispatchId, token, "failed");
					}
				} finally {
					if (timer) clearTimeout(timer);
					if (
						dispatchId &&
						this.activeControllers.get(dispatchId) === controller
					)
						this.activeControllers.delete(dispatchId);
					release();
				}
			};
		}
		if (Object.keys(tasks).length === 0)
			throw new Error("Graphile Worker listen requires at least one handler");
		this.listening = true;
		let ready!: () => void;
		this.listenStarting = new Promise<void>((resolve) => (ready = resolve));
		try {
			const events = new EventEmitter() as WorkerEvents;
			for (const event of [
				"pool:listen:error",
				"worker:getJob:error",
				"pool:fatalError",
				"resetLocked:failure",
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
					logger: new Logger(() => () => {}),
					preset: {
						worker: {
							localQueue: { size: batchSize },
							completeJobBatchDelay: 0,
							failJobBatchDelay: 0,
						},
					},
				},
				tasks,
				runnerPool,
			);
			void this.runner.promise.catch((error) => this.emitError(error));
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

	private async closeRunner(): Promise<void> {
		try {
			await this.runner?.gracefulShutdown();
		} finally {
			this.runner = undefined;
			const runnerPool = this.runnerPool;
			this.runnerPool = undefined;
			if (runnerPool && runnerPool !== this.pool) await runnerPool.end();
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
	constructor(private readonly limit: number) {}
	async acquire(): Promise<() => void> {
		if (this.active >= this.limit)
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		else this.active++;
		return () => {
			const next = this.waiting.shift();
			if (next) next();
			else this.active--;
		};
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
