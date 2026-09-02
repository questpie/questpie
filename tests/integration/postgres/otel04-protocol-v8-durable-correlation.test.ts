import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";
import { principal } from "questpie";

import { projectPostgresMutationTransactionStatements } from "../../../packages/compiler/src/mutation";
import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	ensureInternalProtocolV7,
	verifyInternalProtocolV7,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v7";
import {
	ensureInternalProtocolV8,
	internalProtocolV8Catalog,
	internalProtocolV8Checksum,
	verifyInternalProtocolV8,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v8";
import {
	createJobAcceptance,
	type DurableWorkerOutcome,
} from "../../../packages/runtime/src/durable";
import { linkJobProjection } from "../../../packages/runtime/src/durable/job-projection";
import { runObservedDurableAttempt } from "../../../packages/runtime/src/durable/observation";
import { createPostgresDatabaseDurableClaim } from "../../../packages/runtime/src/durable/postgres-database-claim";
import { createPostgresDatabaseDurableTerminal } from "../../../packages/runtime/src/durable/postgres-database-terminal";
import { linkReactionProjection } from "../../../packages/runtime/src/durable/projection";
import {
	createPostgresJobAcceptanceTransaction,
	linkPostgresMutationTransactionStatements,
} from "../../../packages/runtime/src/mutation";
import {
	createObservationKernel,
	type NeutralTraceContextV1,
	type ObservationAdapterV1,
	type ObservationStartV1,
} from "../../../packages/runtime/src/observation";
import {
	createPostgresDatabase,
	definePostgresStatement,
} from "../../../packages/runtime/src/postgres";
import type {
	PostgresDatabase,
	PostgresTransaction,
} from "../../../packages/runtime/src/postgres";

const sql = process.env.PGHOST ? new SQL({ max: 4 }) : undefined;
const control = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 } as const;
const application = "application:otel04-correlation";
const tenantId = "tenant:otel04";
const principalId = "user:otel04";
const runtimeBuildDigest = "a".repeat(64);
const executableDigest = "b".repeat(64);
let acceptedAt = new Date(0);
const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/team-support-desk");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function runtimeDatabase(): PostgresDatabase {
	return createPostgresDatabase({
		connectionUrl: postgresUrl(),
		directConnectionUrl: postgresUrl(),
		pool: {
			max: 2,
			connectTimeoutMs: 2_000,
			checkoutTimeoutMs: 2_000,
			idleTimeoutMs: 2_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 5_000,
			lockMs: 2_000,
			idleInTransactionMs: 5_000,
		},
	});
}

async function databaseName(session: SQL): Promise<string> {
	const [row] = await session<{ name: string }[]>`
		select current_database() as name
	`;
	if (!row) throw new TypeError("PostgreSQL database identity is unavailable");
	return row.name;
}

async function installV7(session: SQL): Promise<void> {
	await ensureInternalProtocolV7(
		session,
		await databaseName(session),
		await backendPid(session),
		control,
	);
}

async function upgradeV8(session: SQL): Promise<void> {
	await ensureInternalProtocolV8(
		session,
		await databaseName(session),
		await backendPid(session),
		control,
		{ allowNonRollingProtocolV8: true },
	);
}

function trace(seed: number): NeutralTraceContextV1 {
	return Object.freeze({
		format: "questpie.trace-context",
		version: 1,
		traceId: new Uint8Array(16).fill(seed),
		spanId: new Uint8Array(8).fill(seed + 1),
		flags: seed,
	});
}

function traceHex(value: NeutralTraceContextV1 | null) {
	return value === null
		? null
		: {
				traceId: Buffer.from(value.traceId).toString("hex"),
				spanId: Buffer.from(value.spanId).toString("hex"),
				flags: value.flags,
			};
}

function observation(
	acceptedTrace: NeutralTraceContextV1 | null,
	starts: ObservationStartV1[] = [],
) {
	const adapter: ObservationAdapterV1 = Object.freeze({
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin(input) {
			starts.push(input);
			return Object.freeze({
				context:
					input.kind === "job.accept" || input.kind === "reaction.accept"
						? acceptedTrace
						: null,
				run: async <Result>(use: () => Result | Promise<Result>) => await use(),
				event: () => undefined,
				end: () => undefined,
			});
		},
	});
	return createObservationKernel({
		adapter,
		applicationIdentity: application,
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		runtimeBuildDigest,
	});
}

const jobs = linkJobProjection({
	format: "questpie.job-projection",
	version: 1,
	jobs: [
		{
			identity: "job:reports.digest",
			semanticVersion: 1,
			input: { kind: "object", properties: { report: { kind: "text" } } },
			output: { kind: "object", properties: {} },
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry: {
				maximumAttempts: 3,
				initialDelayMilliseconds: 1_000,
				backoff: "exponential",
				maximumDelayMilliseconds: 60_000,
				jitter: "full",
				horizonMilliseconds: 86_400_000,
			},
			signals: {},
			schedule: null,
			contractDigest: executableDigest,
			origin: {
				path: "src/reports.ts",
				exportName: "digest",
				packageId: null,
			},
		},
	],
});

const reactions = linkReactionProjection({
	format: "questpie.reaction-projection",
	version: 2,
	reactions: [
		{
			identity: "reaction:reports.created",
			input: { kind: "object", properties: { report: { kind: "text" } } },
			output: { kind: "object", properties: {} },
			declaredErrors: {},
			runAs: { actor: "caller", whenDenied: "fail" },
			retry: {
				maximumAttempts: 3,
				initialDelayMilliseconds: 1_000,
				backoff: "exponential",
				maximumDelayMilliseconds: 60_000,
				jitter: "full",
				horizonMilliseconds: 86_400_000,
			},
			effects: [],
			contractDigest: executableDigest,
			origin: {
				path: "src/reports.ts",
				exportName: "created",
				packageId: null,
			},
		},
	],
});

const projectedStatements = projectPostgresMutationTransactionStatements();
const statements = linkPostgresMutationTransactionStatements({
	artifact: JSON.stringify(projectedStatements),
	expectedDigest: projectedStatements.digest,
});

const hostileTraceUpdates = [
	[
		"partial",
		"trace_id = decode(repeat('01', 16), 'hex'), span_id = NULL, trace_flags = NULL",
	],
	[
		"zero-trace",
		"trace_id = decode(repeat('00', 16), 'hex'), span_id = decode(repeat('02', 8), 'hex'), trace_flags = 1",
	],
	[
		"short-trace",
		"trace_id = decode(repeat('01', 15), 'hex'), span_id = decode(repeat('02', 8), 'hex'), trace_flags = 1",
	],
	[
		"invalid-flags",
		"trace_id = decode(repeat('01', 16), 'hex'), span_id = decode(repeat('02', 8), 'hex'), trace_flags = 256",
	],
].map(([name, assignment]) =>
	definePostgresStatement<string, void>({
		name: `otel04.trace-context.${name}`,
		operation: "UPDATE",
		text: `UPDATE questpie_internal.durable_runs SET ${assignment} WHERE run_id = $1::uuid`,
		parameterCount: 1,
		parameters: (runId) => [runId],
		decode: () => undefined,
	}),
);

function statement(identity: string) {
	const linked = statements.get(identity);
	if (!linked) throw new TypeError(`missing statement ${identity}`);
	return linked.statement;
}

async function mark(transaction: PostgresTransaction): Promise<void> {
	const rows = await transaction.execute(
		statement("mutation.dispatch.kernel.mark"),
		[],
	);
	if (rows[0]?.enabled !== "on")
		throw new TypeError("Durable kernel marker is unavailable");
}

async function acceptJob(
	database: PostgresDatabase,
	input: Readonly<{
		acceptedTrace: NeutralTraceContextV1 | null;
		idempotencyKey: string;
		rollback?: boolean;
	}>,
) {
	const kernel = observation(input.acceptedTrace);
	const execution = kernel.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (!execution) throw new TypeError("observed Execution is unavailable");
	const job = jobs.byIdentity.get("job:reports.digest");
	if (!job) throw new TypeError("linked Job is unavailable");
	return database.transaction({
		mode: { isolation: "readCommitted", access: "readWrite" },
		use: (transaction) =>
			execution.scope.run(async () => {
				const owner = createJobAcceptance({
					application,
					tenantId,
					principal: principal.user({ id: principalId }),
					contextInput: {},
					contextInputCodec: { kind: "object", properties: {} },
					runtimeBuildDigest,
					acceptedAt,
					signal: new AbortController().signal,
					causation: {
						kind: "explicit",
						id: "explicit:otel04",
						correlationId: "explicit:otel04",
					},
					observation: execution.observation,
					transaction: createPostgresJobAcceptanceTransaction({
						transaction,
						statements,
						application,
						sourceOperation: "execution:jobs.accept",
						callId: "explicit:otel04",
					}),
				});
				const receipt = await owner.accept(
					job,
					{ report: "weekly" },
					{ idempotencyKey: input.idempotencyKey },
				);
				if (input.rollback) throw new Error(`rollback:${receipt.runId}`);
				return receipt;
			}),
	});
}

async function insertReactionRun(
	database: PostgresDatabase,
	input: Readonly<{
		dispatchId: string;
		runId: string;
		acceptedTrace: NeutralTraceContextV1 | null;
		insertDispatch?: boolean;
	}>,
): Promise<number> {
	const reaction = reactions.byIdentity.get("reaction:reports.created");
	if (!reaction) throw new TypeError("linked Reaction is unavailable");
	return database.transaction({
		mode: { isolation: "readCommitted", access: "readWrite" },
		use: async (transaction) => {
			await mark(transaction);
			if (input.insertDispatch !== false) {
				await transaction.execute(statement("mutation.dispatch.insert"), [
					application,
					tenantId,
					"mutation:reports.create",
					"user",
					principalId,
					"call:reaction",
					"created",
					input.dispatchId,
					"reaction",
					reaction.identity,
					"c".repeat(64),
					new TextEncoder().encode('{"report":"weekly"}\n'),
					acceptedAt,
				]);
				await mark(transaction);
				await transaction.execute(statement("mutation.dispatch.accept"), [
					application,
					input.dispatchId,
				]);
			}
			const rows = await transaction.execute(
				statement("mutation.dispatch.run.insert"),
				[
					application,
					input.runId,
					input.dispatchId,
					reaction.identity,
					1,
					tenantId,
					"user",
					principalId,
					new TextEncoder().encode("{}\n"),
					new TextEncoder().encode('{"report":"weekly"}\n'),
					new TextEncoder().encode(
						'{"backoff":"exponential","horizonMilliseconds":86400000,"initialDelayMilliseconds":1000,"jitter":"full","maximumAttempts":3,"maximumDelayMilliseconds":60000}\n',
					),
					runtimeBuildDigest,
					reaction.contractDigest,
					"mutationDispatch",
					"call:reaction",
					"call:reaction",
					"ready",
					acceptedAt,
					new Date(acceptedAt.getTime() + 86_400_000),
					acceptedAt,
					input.acceptedTrace?.traceId ?? null,
					input.acceptedTrace?.spanId ?? null,
					input.acceptedTrace?.flags ?? null,
				],
			);
			return rows.length;
		},
	});
}

async function storedTrace(session: SQL, runId: string) {
	const [row] = await session<
		Array<{
			traceId: Uint8Array | null;
			spanId: Uint8Array | null;
			flags: number | null;
		}>
	>`
		select trace_id as "traceId", span_id as "spanId", trace_flags as flags
		from questpie_internal.durable_runs
		where application_name = ${application} and run_id = ${runId}::uuid
	`;
	if (!row) return null;
	return {
		traceId:
			row.traceId === null ? null : Buffer.from(row.traceId).toString("hex"),
		spanId:
			row.spanId === null ? null : Buffer.from(row.spanId).toString("hex"),
		flags: row.flags,
	};
}

beforeEach(async () => {
	if (!sql) return;
	await sql.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	const [clock] = await sql<{ acceptedAt: Date }[]>`
		select transaction_timestamp() - interval '1 second' as "acceptedAt"
	`;
	if (!clock) throw new TypeError("PostgreSQL clock is unavailable");
	acceptedAt = clock.acceptedAt;
});

afterAll(async () => {
	await sql?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await sql?.close();
});

describe.skipIf(!sql)("OTEL-04 protocol-v8 Durable correlation", () => {
	test.serial(
		"cuts over only through the exact public CLI acknowledgement",
		async () => {
			const session = await sql!.reserve();
			try {
				const build = Bun.spawnSync(["bun", "run", "build"], {
					cwd: resolve(repositoryRoot, "packages/questpie"),
					stdout: "pipe",
					stderr: "pipe",
				});
				expect(
					build.exitCode,
					build.stdout.toString() + build.stderr.toString(),
				).toBe(0);
				await installV7(session);
				const invoke = (flag: string) =>
					Bun.spawnSync(["bun", cli, "migration", "apply", flag], {
						cwd: fixtureRoot,
						env: { ...process.env, DATABASE_URL: postgresUrl() },
						stdout: "pipe",
						stderr: "pipe",
					});
				const historical = invoke("--allow-non-rolling-protocol-v7");
				expect(historical.exitCode).not.toBe(0);
				await verifyInternalProtocolV7(session);
				const accepted = invoke("--allow-non-rolling-protocol-v8");
				expect(
					accepted.exitCode,
					accepted.stdout.toString() + accepted.stderr.toString(),
				).toBe(0);
				await verifyInternalProtocolV8(session);
			} finally {
				await session.unsafe("DROP SCHEMA IF EXISTS team_support_desk CASCADE");
				session.release();
			}
		},
		120_000,
	);

	test.serial(
		"cuts over the exact 21-table catalog and refuses both mixed directions",
		async () => {
			const session = await sql!.reserve();
			const second = new SQL({ max: 1 });
			try {
				await installV7(session);
				await expect(
					ensureInternalProtocolV8(
						session,
						await databaseName(session),
						await backendPid(session),
						control,
					),
				).rejects.toMatchObject({
					code: "QP-SCHEMA-020",
					diagnosticClass: "destructiveAcknowledgementRequired",
				});
				await upgradeV8(session);
				await verifyInternalProtocolV8(session);
				await verifyInternalProtocolV8(second);
				await expect(verifyInternalProtocolV7(session)).rejects.toMatchObject({
					code: "QP-SCHEMA-023",
				});
				const [protocol] = await session<
					{ version: number; checksum: string }[]
				>`
				select version, checksum from questpie_internal.protocol where singleton
			`;
				expect(protocol).toEqual({
					version: 8,
					checksum: internalProtocolV8Checksum,
				});
				expect(internalProtocolV8Catalog.tables).toHaveLength(21);
				const [live] = await session<
					{ tables: number; traceColumns: number; constraint: number }[]
				>`
				select
				  (select count(*)::int from pg_catalog.pg_class c
				   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
				   where n.nspname = 'questpie_internal' and c.relkind = 'r') as tables,
				  (select count(*)::int from information_schema.columns
				   where table_schema = 'questpie_internal' and table_name = 'durable_runs'
				     and column_name in ('trace_id', 'span_id', 'trace_flags')) as "traceColumns",
				  (select count(*)::int from pg_catalog.pg_constraint
				   where connamespace = 'questpie_internal'::regnamespace
				     and conname = 'durable_run_trace_context_complete') as constraint
			`;
				expect(live).toEqual({ tables: 21, traceColumns: 3, constraint: 1 });
			} finally {
				await second.close();
				session.release();
			}
		},
		120_000,
	);

	test.serial(
		"retains first Job and Reaction context across duplicate and rollback",
		async () => {
			const session = await sql!.reserve();
			const database = runtimeDatabase();
			try {
				await upgradeV8(session);
				const firstJob = trace(1);
				const jobReceipt = await acceptJob(database, {
					acceptedTrace: firstJob,
					idempotencyKey: "job:first",
				});
				await acceptJob(database, {
					acceptedTrace: trace(3),
					idempotencyKey: "job:first",
				});
				expect(await storedTrace(session, jobReceipt.runId)).toEqual(
					traceHex(firstJob),
				);

				const reactionDispatch = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6211";
				const reactionRun = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6212";
				const firstReaction = trace(5);
				expect(
					await insertReactionRun(database, {
						dispatchId: reactionDispatch,
						runId: reactionRun,
						acceptedTrace: firstReaction,
					}),
				).toBe(1);
				expect(
					await insertReactionRun(database, {
						dispatchId: reactionDispatch,
						runId: reactionRun,
						acceptedTrace: trace(7),
						insertDispatch: false,
					}),
				).toBe(0);
				expect(await storedTrace(session, reactionRun)).toEqual(
					traceHex(firstReaction),
				);

				let rolledBackRun: string | undefined;
				try {
					await acceptJob(database, {
						acceptedTrace: trace(9),
						idempotencyKey: "job:rollback",
						rollback: true,
					});
				} catch (error) {
					const match =
						error instanceof Error
							? /^rollback:([0-9a-f-]{36})$/u.exec(error.message)
							: null;
					rolledBackRun = match?.[1];
				}
				expect(rolledBackRun).toBeDefined();
				if (!rolledBackRun)
					throw new TypeError(
						"rolled-back Durable Run identity is unavailable",
					);
				expect(await storedTrace(session, rolledBackRun)).toBeNull();

				for (const hostile of hostileTraceUpdates)
					await expect(
						database.transaction({
							mode: { isolation: "readCommitted", access: "readWrite" },
							use: async (transaction) => {
								await mark(transaction);
								await transaction.execute(hostile, jobReceipt.runId);
							},
						}),
					).rejects.toMatchObject({ code: "constraint", phase: "statement" });
				expect(await storedTrace(session, jobReceipt.runId)).toEqual(
					traceHex(firstJob),
				);
			} finally {
				await database.close({ deadlineAt: Date.now() + 5_000 });
				session.release();
			}
		},
		120_000,
	);

	test.serial(
		"preserves null old rows and one link across retry, reclaim, prune, and complete-row restore",
		async () => {
			const session = await sql!.reserve();
			const firstDatabase = runtimeDatabase();
			const secondDatabase = runtimeDatabase();
			try {
				await installV7(session);
				const oldDispatch = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6221";
				const oldRun = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6222";
				await session.begin(async (transaction) => {
					await transaction`select set_config('questpie.durable_kernel', 'on', true)`;
					await transaction.unsafe(
						`INSERT INTO questpie_internal.durable_dispatches
  (application_name, tenant_id, source_operation, principal_kind, principal_id,
   call_id, dispatch_slot, record_id, resource_kind, resource_identity,
   input_digest, payload_bytes, transaction_id, recorded_at, state)
VALUES ($1, $2, 'mutation:legacy', 'user', $3, 'call:legacy', 'created',
        $4::uuid, 'reaction', 'reaction:reports.created', $5,
        convert_to('{"report":"legacy"}', 'UTF8'), pg_current_xact_id(),
        transaction_timestamp(), 'accepted')`,
						[application, tenantId, principalId, oldDispatch, "d".repeat(64)],
					);
					await transaction.unsafe(
						`INSERT INTO questpie_internal.durable_runs
  (application_name, run_id, dispatch_id, resource_identity, semantic_version,
   tenant_id, principal_kind, principal_id, run_as, context_input_bytes,
   payload_bytes, retry_bytes, runtime_build_digest, executable_digest,
   causation_kind, causation_id, correlation_id, state, attempt_count,
   available_at, horizon_at, cancellation_requested, event_sequence,
   dead_letter, accepted_at)
VALUES ($1, $2::uuid, $3::uuid, 'reaction:reports.created', 1, $4, 'user', $5,
        'caller', convert_to('{}', 'UTF8'), convert_to('{"report":"legacy"}', 'UTF8'),
        convert_to('{"backoff":"exponential","horizonMilliseconds":86400000,"initialDelayMilliseconds":1000,"jitter":"full","maximumAttempts":3,"maximumDelayMilliseconds":60000}', 'UTF8'),
        $6, $7, 'mutationDispatch', 'call:legacy', 'call:legacy', 'ready', 0,
        transaction_timestamp(), transaction_timestamp() + interval '1 day',
        false, 1, false, transaction_timestamp())`,
						[
							application,
							oldRun,
							oldDispatch,
							tenantId,
							principalId,
							runtimeBuildDigest,
							executableDigest,
						],
					);
				});
				await upgradeV8(session);
				expect(await storedTrace(session, oldRun)).toEqual({
					traceId: null,
					spanId: null,
					flags: null,
				});

				const linked = trace(11);
				const receipt = await acceptJob(firstDatabase, {
					acceptedTrace: linked,
					idempotencyKey: "job:reclaim",
				});
				const firstClaim = createPostgresDatabaseDurableClaim({
					database: firstDatabase,
					application,
					reactions,
					jobs,
					randomUUID: (() => {
						const values = [
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6231",
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6232",
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6235",
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6236",
						];
						return () => values.shift()!;
					})(),
				});
				const first = await firstClaim({
					runId: receipt.runId,
					workerId: "worker:v8-a",
					leaseMilliseconds: 1_000,
				});
				if (first.status !== "claimed")
					throw new TypeError("first claim failed");
				expect(traceHex(first.claim.acceptanceTrace)).toEqual(traceHex(linked));
				await session.begin(async (transaction) => {
					await transaction`select set_config('questpie.durable_kernel', 'on', true)`;
					await transaction`
					update questpie_internal.durable_runs
					set lease_expires_at = transaction_timestamp() - interval '1 second'
					where application_name = ${application} and run_id = ${receipt.runId}::uuid
				`;
				});
				const secondClaim = createPostgresDatabaseDurableClaim({
					database: secondDatabase,
					application,
					reactions,
					jobs,
					randomUUID: (() => {
						const values = [
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6233",
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6234",
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6237",
							"018f5f6e-5f2c-7b41-a854-3d9a6b6b6238",
						];
						return () => values.shift()!;
					})(),
				});
				const second = await secondClaim({
					runId: receipt.runId,
					workerId: "worker:v8-b",
					leaseMilliseconds: 1_000,
				});
				if (second.status !== "claimed") throw new TypeError("reclaim failed");
				expect(second.claim.attemptNumber).toBe(2);
				expect(second.claim.attemptId).not.toBe(first.claim.attemptId);
				expect(traceHex(second.claim.acceptanceTrace)).toEqual(
					traceHex(linked),
				);

				const retryReceipt = await acceptJob(firstDatabase, {
					acceptedTrace: linked,
					idempotencyKey: "job:retry",
				});
				const retryClaim = await firstClaim({
					runId: retryReceipt.runId,
					workerId: "worker:v8-retry-a",
					leaseMilliseconds: 1_000,
				});
				if (retryClaim.status !== "claimed")
					throw new TypeError("retry first claim failed");
				const terminal = createPostgresDatabaseDurableTerminal({
					database: firstDatabase,
					application,
					random: () => 0,
				});
				expect(
					await terminal.fail(retryClaim.claim, { code: "HANDLER_FAILED" }),
				).toMatchObject({ status: "applied", state: "delayed" });
				const retrySecondClaim = await secondClaim({
					runId: retryReceipt.runId,
					workerId: "worker:v8-retry-b",
					leaseMilliseconds: 1_000,
				});
				if (retrySecondClaim.status !== "claimed")
					throw new TypeError("retry second claim failed");
				expect(retrySecondClaim.claim.attemptNumber).toBe(2);
				expect(traceHex(retrySecondClaim.claim.acceptanceTrace)).toEqual(
					traceHex(linked),
				);

				const starts: ObservationStartV1[] = [];
				const observed = observation(null, starts).beginExecution({
					entry: "worker",
					kind: "execution",
					principalKind: "user",
					trace: { kind: "root" },
				});
				if (!observed) throw new TypeError("worker observation is unavailable");
				const outcome = {
					runId: receipt.runId,
					resource: second.claim.resource,
					attemptNumber: 2,
					failureCode: null,
					outcome: "succeeded",
				} as const satisfies DurableWorkerOutcome;
				await runObservedDurableAttempt({
					observation: observed.observation,
					request: {
						acceptanceTrace: second.claim.acceptanceTrace,
						capability: "job",
						attemptId: second.claim.attemptId,
						attemptNumber: second.claim.attemptNumber,
						queueDelayMilliseconds: second.claim.queueDelayMilliseconds,
						contextInput: {},
						dispatchId: second.claim.dispatchId,
						principal: second.claim.principal,
						resource: second.claim.resource,
						runId: second.claim.runId,
						signal: new AbortController().signal,
					},
					use: async () => outcome,
				});
				expect(starts.find(({ kind }) => kind === "job.attempt")).toMatchObject(
					{
						trace: { kind: "root-with-links", links: [linked] },
					},
				);

				const before = await storedTrace(session, receipt.runId);
				expect(before).not.toBeNull();
				await session.begin(async (transaction) => {
					await transaction`select set_config('questpie.durable_kernel', 'on', true)`;
					await transaction`
					delete from questpie_internal.durable_attempts
					where application_name = ${application} and run_id = ${receipt.runId}::uuid
				`;
				});
				expect(await storedTrace(session, receipt.runId)).toEqual(before);

				const backupReceipt = await acceptJob(firstDatabase, {
					acceptedTrace: linked,
					idempotencyKey: "job:backup",
				});
				const [backup] = await session<{ dispatchId: string; row: string }[]>`
				select dispatch_id::text as "dispatchId", row_to_json(r)::text as row
				from questpie_internal.durable_runs r
				where application_name = ${application}
				  and run_id = ${backupReceipt.runId}::uuid
			`;
				if (!backup) throw new TypeError("Durable Run backup is unavailable");
				const restoredDispatch = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6241";
				const restoredRun = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6242";
				await session.begin(async (transaction) => {
					await transaction`select set_config('questpie.durable_kernel', 'on', true)`;
					await transaction`
					insert into questpie_internal.durable_dispatches
					  (application_name, tenant_id, source_operation, principal_kind,
					   principal_id, call_id, dispatch_slot, record_id, resource_kind,
					   resource_identity, input_digest, payload_bytes, transaction_id,
					   recorded_at, state)
					select application_name, tenant_id, source_operation, principal_kind,
					       principal_id, call_id || ':restore', dispatch_slot || ':restore',
					       ${restoredDispatch}::uuid, resource_kind, resource_identity,
					       input_digest, payload_bytes, transaction_id, recorded_at, state
					from questpie_internal.durable_dispatches
					where application_name = ${application}
					  and record_id = ${backup.dispatchId}::uuid
				`;
					await transaction`INSERT INTO questpie_internal.durable_runs
SELECT (jsonb_populate_record(
  NULL::questpie_internal.durable_runs,
	(${backup.row}::jsonb #>> '{}')::jsonb || jsonb_build_object(
		'run_id', ${restoredRun}::text,
		'dispatch_id', ${restoredDispatch}::text
	)
)).*`;
				});
				const [restoredBackup] = await session<{ row: string }[]>`
				select row_to_json(r)::text as row
				from questpie_internal.durable_runs r
				where application_name = ${application} and run_id = ${restoredRun}::uuid
			`;
				if (!restoredBackup)
					throw new TypeError("restored Durable Run is unavailable");
				expect(JSON.parse(restoredBackup.row)).toEqual({
					...(JSON.parse(backup.row) as Record<string, unknown>),
					run_id: restoredRun,
					dispatch_id: restoredDispatch,
				});
				expect(await storedTrace(session, restoredRun)).toEqual(
					traceHex(linked),
				);
			} finally {
				await firstDatabase.close({ deadlineAt: Date.now() + 5_000 });
				await secondDatabase.close({ deadlineAt: Date.now() + 5_000 });
				session.release();
			}
		},
		120_000,
	);
});
