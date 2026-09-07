import { afterAll, expect, test } from "bun:test";
import { copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SQL } from "bun";
import type { Principal } from "questpie";

import { compileApplication } from "@questpie/compiler";

import { eventually, waitForOutputLine } from "../../../packages/testkit/src";
import {
	beta05Ids,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";
import { provePostgresOwnerDeadline } from "./helpers/owner-deadline";
import { expectPostgresMajor } from "./helpers/postgres-major";

const admin = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = admin ? test.serial : test.skip;
afterAll(async () => {
	await admin?.close({ timeout: 0 });
});

type Outcome = Readonly<{
	runId: string;
	outcome: string;
	failureCode: string | null;
	attemptNumber: number;
}>;
type Application = Readonly<{
	execution<Result>(
		root: Readonly<{ principal: Principal; context: { companyId: string } }>,
		use: (
			scope: Readonly<{
				jobs: {
					reports: {
						companyDigest: {
							accept(
								input: { companyId: string; restartProbe: string },
								options: { idempotencyKey: string },
							): Promise<{ runId: string }>;
						};
					};
				};
				mutations: {
					message: {
						publish(
							input: { channelId: string; body: string },
							options: { callId: string },
						): Promise<{ id: string }>;
					};
				};
			}>,
		) => Promise<Result>,
	): Promise<Result>;
	durable: {
		worker(options: {
			workerId: string;
			claimBatch: number;
			leaseMilliseconds: number;
			heartbeatMilliseconds: number;
		}): { poll(): Promise<{ outcomes: readonly Outcome[] }> };
		poll(options: {
			workerId: string;
			claimBatch: number;
		}): Promise<{ outcomes: readonly Outcome[] }>;
		cancelRun(input: {
			runId: string;
			reason: string;
			actor: Principal;
		}): Promise<{ outcome: string }>;
		inspect(
			runId: string,
		): Promise<{ state: string; resultBytes: Uint8Array | null } | null>;
	};
	close(): Promise<void>;
}>;

function connectionUrl(name: string) {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	url.pathname = `/${name}`;
	return url.toString();
}

async function withApplication(
	use: (harness: {
		app: Application;
		database: SQL;
		generatedModule: string;
		generatedRoot: string;
		connectionUrl: string;
		root: { principal: Principal; context: { companyId: string } };
		accept(body: string): Promise<string>;
		hold(
			table:
				| "collaboration.messages"
				| "questpie_internal.mutation_checkpoints",
			exclusive?: boolean,
		): Promise<() => Promise<void>>;
		children: ReturnType<typeof Bun.spawn>[];
	}) => Promise<void>,
	fixtures?: Readonly<{ job: string; mutation: string }>,
) {
	const name = `qp_checkpoint_recovery_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
	const url = connectionUrl(name);
	const previousDatabase = process.env.PGDATABASE;
	const previousDatabaseAlias = process.env.PG_DATABASE;
	let owned = false;
	let database: SQL | undefined;
	let prepared:
		| Awaited<ReturnType<typeof prepareBeta05PostgresApplication>>
		| undefined;
	let app: Application | undefined;
	const releases: Array<() => Promise<void>> = [];
	const children: ReturnType<typeof Bun.spawn>[] = [];
	const failures: unknown[] = [];
	try {
		await admin!.unsafe(`CREATE DATABASE "${name}"`);
		owned = true;
		process.env.PGDATABASE = name;
		process.env.PG_DATABASE = name;
		database = new SQL(url, { database: name, max: 4 });
		const [connected] =
			await database`SELECT current_database() AS name, current_setting('server_version_num')::integer AS version`;
		expect(connected.name).toBe(name);
		expectPostgresMajor(connected.version);
		prepared = await prepareBeta05PostgresApplication(database);
		const applicationRoot = resolve(prepared.generated.generatedRoot, "../..");
		await copyFile(
			fixtures?.job ??
				resolve(
					import.meta.dir,
					"../../support/checkpoint-recovery-job.fixture.ts",
				),
			join(applicationRoot, "src/company-digest-job.ts"),
		);
		if (fixtures)
			await copyFile(
				fixtures.mutation,
				join(applicationRoot, "src/message-publish.ts"),
			);
		await compileApplication({ applicationRoot });
		const internal = (await prepared.generated.loadInternal()) as {
			createApplication(input: {
				postgres: { connectionUrl: string; directConnectionUrl: string };
				realtime: { hmacKey: Uint8Array };
				maintenance: { authorize(): boolean };
			}): Promise<Application>;
		};
		app = await internal.createApplication({
			postgres: { connectionUrl: url, directConnectionUrl: url },
			realtime: { hmacKey: new Uint8Array(32).fill(47) },
			maintenance: { authorize: () => true },
		});
		const framework = prepared.generated.framework as {
			principal: { user(input: { id: string }): Principal };
		};
		const root = {
			principal: framework.principal.user({ id: beta05Ids.principal }),
			context: { companyId: beta05Ids.company },
		};
		const liveDatabase = database;
		await use({
			app,
			database,
			root,
			children,
			generatedRoot: prepared.generated.generatedRoot,
			connectionUrl: url,
			generatedModule: join(
				prepared.generated.generatedRoot,
				"internal/application.js",
			),
			accept: async (body) =>
				(
					await app!.execution(root, ({ jobs }) =>
						jobs.reports.companyDigest.accept(
							{ companyId: beta05Ids.company, restartProbe: body },
							{ idempotencyKey: body },
						),
					)
				).runId,
			async hold(table, exclusive = false) {
				const session = await liveDatabase.reserve();
				let released = false;
				const release = async () => {
					if (released) return;
					released = true;
					try {
						await session.unsafe("ROLLBACK");
					} finally {
						session.release();
					}
				};
				releases.push(release);
				await session.unsafe("BEGIN");
				await session.unsafe(
					`LOCK TABLE ${table} IN ${exclusive || table === "collaboration.messages" ? "ACCESS EXCLUSIVE" : "SHARE"} MODE`,
				);
				return release;
			},
		});
	} catch (error) {
		failures.push(error);
	} finally {
		for (const child of children) {
			if (child.exitCode === null && child.signalCode === null)
				child.kill("SIGKILL");
			await child.exited;
		}
		for (const close of [
			...releases.toReversed(),
			() => app?.close(),
			() => prepared?.dispose(),
			() => database?.close({ timeout: 0 }),
		]) {
			try {
				await close();
			} catch (error) {
				failures.push(error);
			}
		}
		if (previousDatabase === undefined) delete process.env.PGDATABASE;
		else process.env.PGDATABASE = previousDatabase;
		if (previousDatabaseAlias === undefined) delete process.env.PG_DATABASE;
		else process.env.PG_DATABASE = previousDatabaseAlias;
		if (owned) {
			try {
				await admin!.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
			} catch (error) {
				failures.push(error);
			}
		}
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1)
		throw new AggregateError(
			failures,
			"checkpoint recovery and cleanup failed",
		);
}

async function waitingMutation(database: SQL, runId: string) {
	return eventually(
		async () => {
			const rows =
				await database`SELECT a.pid, a.backend_xid::text AS xid FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid WHERE a.datname = current_database() AND l.relation = 'collaboration.messages'::regclass AND NOT l.granted AND a.wait_event_type = 'Lock' AND EXISTS (SELECT 1 FROM questpie_internal.mutation_checkpoints WHERE run_id = ${runId} AND state = 'reserved')`;
			return rows[0] as { pid: number; xid: string } | undefined;
		},
		{
			description: "actual Mutation waiting for its messages table lock",
			timeoutMilliseconds: 8000,
			accept: (row) => row !== undefined,
		},
	);
}

postgresTest(
	"generated worker rolls back a caught declared Mutation error and preserves two nested-codec checkpoints",
	async () => {
		await withApplication(
			async ({ app, database, accept }) => {
				const body = `nested-checkpoint-${crypto.randomUUID()}`;
				const runId = await accept(body);
				const trace = await app.durable.poll({
					workerId: "nested-checkpoint",
					claimBatch: 1,
				});
				expect(
					trace.outcomes.find((outcome) => outcome.runId === runId),
				).toMatchObject({ outcome: "succeeded", failureCode: null });
				const result = await app.durable.inspect(runId);
				expect(
					JSON.parse(new TextDecoder().decode(result!.resultBytes!)),
				).toMatchObject({
					firstAt: "2026-09-06T12:34:56.789Z",
					secondAt: "2026-09-07T12:34:56.789Z",
				});
				const history = await database<
					{
						ordinal: number;
						checkpoint_name: string;
						state: string;
						call_id: string;
						transaction_id: string;
					}[]
				>`SELECT c.ordinal, c.checkpoint_name, c.state, c.call_id, r.transaction_id::text AS transaction_id FROM questpie_internal.mutation_checkpoints c JOIN questpie_internal.mutation_call_receipts r USING (application_name, tenant_id, operation_name, principal_kind, principal_id, call_id, input_digest) WHERE c.run_id = ${runId} ORDER BY c.ordinal`;
				expect(
					history.map((row) => [row.ordinal, row.checkpoint_name, row.state]),
				).toEqual([
					[1, "first", "completed"],
					[2, "second", "completed"],
				]);
				expect(history[0]!.call_id).not.toBe(history[1]!.call_id);
				expect(history[0]!.transaction_id).not.toBe(history[1]!.transaction_id);
				const [localResult] =
					await database`SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_schema = 'questpie_internal' AND table_name = 'mutation_checkpoints' AND column_name = 'result_bytes'`;
				expect(localResult.count).toBe(0);
				const writes = await database<
					{ body: string; created_at: Date }[]
				>`SELECT body, created_at FROM collaboration.messages WHERE body IN (${body}, ${`${body}-second`}) ORDER BY created_at`;
				expect(
					writes.map((row) => [row.body, row.created_at.toISOString()]),
				).toEqual([
					[body, "2026-09-06T12:34:56.789Z"],
					[`${body}-second`, "2026-09-07T12:34:56.789Z"],
				]);
				const rejectedBody = `declared-rollback-${crypto.randomUUID()}`;
				const rejectedId = await accept(rejectedBody);
				const rejected = await app.durable.poll({
					workerId: "declared-rollback",
					claimBatch: 1,
				});
				expect(
					rejected.outcomes.find((outcome) => outcome.runId === rejectedId),
				).toMatchObject({ outcome: "failed", failureCode: "REACTION_ERROR" });
				expect((await app.durable.inspect(rejectedId))?.state).toBe("failed");
				const [facts] = await database`SELECT
				(SELECT count(*)::integer FROM collaboration.messages WHERE body IN (${rejectedBody}, ${`${rejectedBody}-later`})) AS writes,
				(SELECT count(*)::integer FROM questpie_internal.mutation_checkpoints WHERE run_id = ${rejectedId}) AS history,
				(SELECT state FROM questpie_internal.mutation_checkpoints WHERE run_id = ${rejectedId}) AS state,
				(SELECT count(*)::integer FROM questpie_internal.mutation_call_receipts WHERE call_id IN (SELECT call_id FROM questpie_internal.mutation_checkpoints WHERE run_id = ${rejectedId})) AS receipts`;
				expect(facts).toEqual({
					writes: 0,
					history: 1,
					state: "reserved",
					receipts: 0,
				});
				const invalidBody = `invalid-codec-${crypto.randomUUID()}`;
				const invalidId = await accept(invalidBody);
				const invalid = await app.durable.poll({
					workerId: "invalid-codec",
					claimBatch: 1,
				});
				expect(
					invalid.outcomes.find((outcome) => outcome.runId === invalidId),
				).toMatchObject({ outcome: "failed", failureCode: "HANDLER_FAILED" });
				const [invalidFacts] = await database`SELECT
					(SELECT count(*)::integer FROM collaboration.messages WHERE body = ${invalidBody}) AS writes,
					(SELECT count(*)::integer FROM questpie_internal.mutation_checkpoints WHERE run_id = ${invalidId}) AS history`;
				expect(invalidFacts).toEqual({ writes: 0, history: 0 });
				for (const size of ["at", "over"] as const) {
					const boundedBody = `result-limit-${size}-${crypto.randomUUID()}`;
					const boundedId = await accept(boundedBody);
					const bounded = await app.durable.poll({
						workerId: "result-limit",
						claimBatch: 1,
					});
					expect(
						bounded.outcomes.find((outcome) => outcome.runId === boundedId),
					).toMatchObject(
						size === "at"
							? { outcome: "succeeded", failureCode: null }
							: { outcome: "failed", failureCode: "HANDLER_FAILED" },
					);
					const [boundedFacts] = await database`SELECT
						(SELECT count(*)::integer FROM collaboration.messages WHERE body = ${boundedBody}) AS writes,
						(SELECT state FROM questpie_internal.mutation_checkpoints WHERE run_id = ${boundedId}) AS state,
						(SELECT octet_length(result_bytes) FROM questpie_internal.mutation_call_receipts WHERE call_id = (SELECT call_id FROM questpie_internal.mutation_checkpoints WHERE run_id = ${boundedId})) AS bytes`;
					expect(boundedFacts).toEqual(
						size === "at"
							? { writes: 1, state: "completed", bytes: 1_048_576 }
							: { writes: 0, state: "reserved", bytes: null },
					);
				}
			},
			{
				job: resolve(
					import.meta.dir,
					"../../support/checkpoint-nested-job.fixture.ts",
				),
				mutation: resolve(
					import.meta.dir,
					"../../support/checkpoint-publish.fixture.ts",
				),
			},
		);
	},
	120_000,
);

postgresTest.each([
	[
		"superseded checkpoint holder cannot complete the successor's committed Mutation receipt",
		false,
	],
	[
		"checkpoint owner deadlines roll back history and preserve a committed Mutation receipt",
		true,
	],
] as const)(
	"%s",
	async (_name, deadlineProof) => {
		await withApplication(
			async ({ app, database, root, accept, generatedRoot, connectionUrl }) => {
				// Load the independent source owner only after the generated application
				// has initialized its bundled pg module.
				const { createRuntimePostgres } =
					await import("../../../packages/runtime/src/postgres");
				const {
					createPostgresDatabaseDurableAttemptObservation,
					createPostgresDatabaseDurableKernel,
					createPostgresMutationCheckpointStore,
					linkJobProjection,
					linkReactionProjection,
				} = await import("../../../packages/runtime/src/durable");
				const { decodeRuntimeArtifacts } =
					await import("../../../packages/runtime/src/application/artifacts");
				const { verifyRuntimeArtifactFiles } =
					await import("../../../packages/runtime/src/application/artifact-files");
				const { encodeRuntimeCodec } =
					await import("../../../packages/runtime/src/codec");
				const { canonicalMutationBytes, mutationDigest } =
					await import("../../../packages/runtime/src/mutation/canonical");
				const json = async (path: string): Promise<unknown> =>
					JSON.parse(await readFile(join(generatedRoot, path), "utf8"));
				const artifacts = decodeRuntimeArtifacts({
					runtimeBuild: await json("runtime-build.json"),
					runtimeExecutables: await json("runtime-executables.json"),
					operationContracts: await json("operation-contracts.json"),
					httpContract: await json("operation-http-contract.json"),
				});
				const files = Object.fromEntries(
					await Promise.all(
						artifacts.runtimeBuild.inventory.map(async ({ path }) => [
							path,
							await readFile(join(generatedRoot, path), "utf8"),
						]),
					),
				);
				verifyRuntimeArtifactFiles(artifacts, files);
				const executable = artifacts.runtimeExecutables.slots.find(
					(slot) => slot.identity === "mutation:message.publish",
				);
				const contract = artifacts.operationContracts.operations.find(
					(operation) => operation.identity === "mutation:message.publish",
				);
				if (!executable || !contract)
					throw new Error("compiled checkpoint Mutation missing");
				const runtimeDatabase = createRuntimePostgres({
					connectionUrl,
					directConnectionUrl: connectionUrl,
					pool: {
						max: 2,
						connectTimeoutMs: 5000,
						checkoutTimeoutMs: 5000,
						idleTimeoutMs: 1000,
						maxLifetimeSeconds: 60,
					},
					timeouts: {
						statementMs: deadlineProof ? 30000 : 10000,
						lockMs: deadlineProof ? 30000 : 2000,
						idleInTransactionMs: deadlineProof ? 30000 : 10000,
					},
				});
				try {
					const observation = createPostgresDatabaseDurableAttemptObservation({
						database: runtimeDatabase,
					});
					const kernel = createPostgresDatabaseDurableKernel({
						database: runtimeDatabase,
						attemptDatabase: observation.database,
						application: artifacts.runtimeBuild.application,
						runtimeBuildDigest: artifacts.runtimeBuild.digest,
						jobs: linkJobProjection(JSON.parse(files["job-projection.json"]!)),
						reactions: linkReactionProjection(
							JSON.parse(files["reaction-projection.json"]!),
						),
					});
					const store = createPostgresMutationCheckpointStore({
						database: runtimeDatabase,
						application: artifacts.runtimeBuild.application,
					});
					const body = `stale-completion-${crypto.randomUUID()}`;
					const runId = await accept(body);
					const first = await kernel.claim({
						runId,
						workerId: "stale-holder",
						leaseMilliseconds: deadlineProof ? 30000 : 1000,
					});
					if (first.status !== "claimed")
						throw new Error("first checkpoint claim missing");
					const command = {
						ordinal: 1,
						name: "publish",
						operation: "mutation:message.publish" as const,
						input: { channelId: beta05Ids.channel, body },
						inputCodec: contract.input,
						contractDigest: executable.contractDigest,
						runtimeGraphDigest: executable.runtimeGraphDigest,
					};
					if (deadlineProof) {
						for (const stage of ["history", "reserve"] as const) {
							await provePostgresOwnerDeadline({
								database: runtimeDatabase,
								connectionUrl,
								statementName: `checkpoint.${stage}`,
								milliseconds: 5000,
								use: (runner) => {
									const bounded = createPostgresMutationCheckpointStore({
										database: runner,
										application: artifacts.runtimeBuild.application,
									});
									return stage === "history"
										? bounded.load(first.claim)
										: bounded.reserve(first.claim, command);
								},
							});
							expect(await store.load(first.claim)).toBe(0);
						}
					}
					expect(await store.load(first.claim)).toBe(0);
					const reservation = await store.reserve(first.claim, command);
					if (reservation.status !== "reserved")
						throw new Error("checkpoint reservation missing");
					const result = await app.execution(root, ({ mutations }) =>
						mutations.message.publish(command.input, {
							callId: reservation.callId,
						}),
					);
					const digest = mutationDigest(
						canonicalMutationBytes(encodeRuntimeCodec(contract.output, result)),
					);
					if (deadlineProof) {
						const receiptFacts = () =>
							database`SELECT transaction_id::text, input_digest, result_bytes FROM questpie_internal.mutation_call_receipts WHERE call_id = ${reservation.callId}`;
						const committed = await receiptFacts();
						expect(committed).toHaveLength(1);
						await provePostgresOwnerDeadline({
							database: runtimeDatabase,
							connectionUrl,
							statementName: "checkpoint.complete",
							milliseconds: 5000,
							use: (runner) =>
								createPostgresMutationCheckpointStore({
									database: runner,
									application: artifacts.runtimeBuild.application,
								}).complete(first.claim, command, digest),
						});
						expect(await receiptFacts()).toEqual(committed);
						const [rolledBack] = await database`SELECT
							(SELECT count(*)::int FROM collaboration.messages WHERE body = ${body}) AS writes,
							state, receipt_transaction_id, receipt_result_digest FROM questpie_internal.mutation_checkpoints WHERE run_id = ${runId}`;
						expect(rolledBack).toEqual({
							writes: 1,
							state: "reserved",
							receipt_transaction_id: null,
							receipt_result_digest: null,
						});
						expect(
							await store.complete(first.claim, command, digest),
						).toMatchObject({ status: "completed" });
						expect(await receiptFacts()).toEqual(committed);
						return;
					}
					await eventually(
						async () => {
							const [row] =
								await database`SELECT lease_expires_at < clock_timestamp() AS expired FROM questpie_internal.durable_runs WHERE run_id = ${runId}`;
							return row.expired as boolean;
						},
						{
							description: "old checkpoint holder lease expires",
							timeoutMilliseconds: 4000,
							accept: (expired) => expired,
						},
					);
					const successor = await kernel.claim({
						runId,
						workerId: "successor-holder",
						leaseMilliseconds: 30000,
					});
					if (successor.status !== "claimed")
						throw new Error("successor checkpoint claim missing");
					expect(await store.load(successor.claim)).toBe(1);
					expect(await store.reserve(successor.claim, command)).toMatchObject({
						status: "reserved",
						callId: reservation.callId,
					});
					expect(await store.complete(first.claim, command, digest)).toEqual({
						status: "fenced",
					});
					const [before] =
						await database`SELECT state FROM questpie_internal.mutation_checkpoints WHERE run_id = ${runId}`;
					expect(before.state).toBe("reserved");
					expect(
						await store.complete(successor.claim, command, digest),
					).toMatchObject({ status: "completed" });
					const [facts] =
						await database`SELECT (SELECT count(*)::integer FROM collaboration.messages WHERE body = ${body}) AS writes, (SELECT count(*)::integer FROM questpie_internal.mutation_call_receipts WHERE call_id = ${reservation.callId}) AS receipts, (SELECT state FROM questpie_internal.mutation_checkpoints WHERE run_id = ${runId}) AS state`;
					expect(facts).toEqual({
						writes: 1,
						receipts: 1,
						state: "completed",
					});
				} finally {
					await runtimeDatabase.close({ deadlineAt: Date.now() + 5000 });
				}
			},
		);
	},
	120_000,
);

postgresTest(
	"worker cancellation joins its blocked checkpoint Mutation before returning terminal state",
	async () => {
		await withApplication(async ({ app, database, root, accept, hold }) => {
			const body = `cancel-checkpoint-${crypto.randomUUID()}`;
			const runId = await accept(body);
			const release = await hold("collaboration.messages");
			const pending = app.durable
				.worker({
					workerId: "cancel-checkpoint",
					claimBatch: 1,
					leaseMilliseconds: 1000,
					heartbeatMilliseconds: 100,
				})
				.poll();
			void pending.catch(() => undefined);
			const blocked = await waitingMutation(database, runId);
			expect(blocked?.xid).toBeString();
			const [before] =
				await database`SELECT r.state AS run_state, c.state AS checkpoint_state FROM questpie_internal.durable_runs r JOIN questpie_internal.mutation_checkpoints c USING (application_name, run_id) WHERE r.run_id = ${runId}`;
			expect(before).toEqual({
				run_state: "running",
				checkpoint_state: "reserved",
			});
			expect(
				await app.durable.cancelRun({
					runId,
					reason: "cancel blocked checkpoint",
					actor: root.principal,
				}),
			).toMatchObject({ outcome: "applied" });
			const trace = await pending;
			expect(
				trace.outcomes.find((outcome) => outcome.runId === runId),
			).toMatchObject({ outcome: "cancelled", failureCode: null });
			const [joined] =
				await database`SELECT count(*)::integer AS active FROM pg_stat_activity WHERE pid = ${blocked!.pid} AND backend_xid::text = ${blocked!.xid}`;
			expect(joined.active).toBe(0);
			await release();
			const [facts] =
				await database`SELECT (SELECT count(*)::integer FROM collaboration.messages WHERE body = ${body}) AS writes, (SELECT count(*)::integer FROM questpie_internal.mutation_call_receipts WHERE call_id = (SELECT call_id FROM questpie_internal.mutation_checkpoints WHERE run_id = ${runId})) AS receipts, (SELECT state FROM questpie_internal.mutation_checkpoints WHERE run_id = ${runId}) AS checkpoint`;
			expect(facts).toEqual({ writes: 0, receipts: 0, checkpoint: "reserved" });
		});
	},
	120_000,
);

for (const authority of ["collection", "context"] as const) {
	postgresTest(
		`successor worker recovers commit-before-checkpoint with fresh ${authority} authority`,
		async () => {
			await withApplication(
				async ({
					app,
					database,
					root,
					accept,
					hold,
					children,
					generatedModule,
				}) => {
					const body = `recover-checkpoint-${authority}-${crypto.randomUUID()}`;
					const runId = await accept(body);
					const child = Bun.spawn(
						[
							process.execPath,
							resolve(import.meta.dir, "helpers/checkpoint-worker-child.ts"),
							generatedModule,
						],
						{ env: process.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
					);
					children.push(child);
					await waitForOutputLine(child.stdout, {
						accept: (line) => line === "checkpoint-worker-ready",
						description:
							"child Runtime ready before introducing the Mutation lock",
					});
					const releaseMessages = await hold("collaboration.messages");
					child.stdin.write("start\n");
					child.stdin.end();
					await waitingMutation(database, runId);
					const releaseCheckpoint = await hold(
						"questpie_internal.mutation_checkpoints",
					);
					await releaseMessages();
					const committed = await eventually(
						async () => {
							const rows =
								await database`SELECT c.state, c.call_id, m.id AS message_id, r.transaction_id::text AS transaction_id FROM questpie_internal.mutation_checkpoints c JOIN questpie_internal.mutation_call_receipts r USING (application_name, tenant_id, operation_name, principal_kind, principal_id, call_id, input_digest) JOIN collaboration.messages m ON m.body = ${body} WHERE c.run_id = ${runId} AND r.outcome = 'committed'`;
							return rows[0] as
								| {
										state: string;
										call_id: string;
										message_id: string;
										transaction_id: string;
								  }
								| undefined;
						},
						{
							description:
								"committed Mutation receipt while checkpoint completion waits",
							timeoutMilliseconds: 3000,
							accept: (value) => value !== undefined,
						},
					);
					expect(committed?.state).toBe("reserved");
					child.kill("SIGKILL");
					await child.exited;
					expect(child.signalCode).toBe("SIGKILL");
					await releaseCheckpoint();
					if (authority === "collection")
						await database`UPDATE collaboration.memberships SET role = 'member' WHERE id = ${beta05Ids.membership}`;
					await eventually(
						async () => {
							const [row] =
								await database`SELECT lease_expires_at < clock_timestamp() AS expired FROM questpie_internal.durable_runs WHERE run_id = ${runId}`;
							return row.expired as boolean;
						},
						{
							description: "crashed worker lease expires",
							timeoutMilliseconds: 4000,
							accept: (expired) => expired,
						},
					);
					const releaseHistory =
						authority === "context"
							? await hold("questpie_internal.mutation_checkpoints", true)
							: undefined;
					const pendingRecovery = app.durable.poll({
						workerId: `successor-${authority}`,
						claimBatch: 64,
					});
					void pendingRecovery.catch(() => undefined);
					if (releaseHistory) {
						// History loading follows the successor Job's Context resolution.
						// Revoke now to isolate the checkpoint's separate Mutation Context.
						await eventually(
							async () => {
								const [row] =
									await database`SELECT count(*)::integer AS waiting FROM pg_stat_activity a JOIN pg_locks l ON l.pid = a.pid WHERE a.datname = current_database() AND l.relation = 'questpie_internal.mutation_checkpoints'::regclass AND NOT l.granted AND a.query LIKE 'SELECT ordinal, checkpoint_name, operation_name%'`;
								return row.waiting as number;
							},
							{
								accept: (waiting) => waiting === 1,
								timeoutMilliseconds: 3000,
								description:
									"successor history load after Job Context resolution",
							},
						);
						await database`UPDATE collaboration.memberships SET status = 'inactive' WHERE id = ${beta05Ids.membership}`;
						await releaseHistory();
					}
					const recovered = await pendingRecovery;
					expect(
						recovered.outcomes.find((outcome) => outcome.runId === runId),
					).toMatchObject(
						authority === "collection"
							? { outcome: "succeeded", failureCode: null, attemptNumber: 2 }
							: {
									outcome: "failed",
									failureCode: "RUN_AS_DENIED",
									attemptNumber: 2,
								},
					);
					if (authority === "collection") {
						const state = await app.durable.inspect(runId);
						const result = JSON.parse(
							new TextDecoder().decode(state!.resultBytes!),
						);
						expect(result).toMatchObject({
							invocationId: committed!.message_id,
							role: "member",
							attemptNumber: 2,
						});
						await expect(
							app.execution(root, ({ mutations }) =>
								mutations.message.publish(
									{ channelId: beta05Ids.channel, body },
									{ callId: `fresh-${body}` },
								),
							),
						).rejects.toMatchObject({
							code: "CHANNEL_UNAVAILABLE",
							status: 404,
						});
					}
					const [facts] =
						await database`SELECT (SELECT count(*)::integer FROM collaboration.messages WHERE body = ${body}) AS writes, (SELECT count(*)::integer FROM questpie_internal.mutation_call_receipts WHERE call_id = ${committed!.call_id}) AS receipts, (SELECT transaction_id::text FROM questpie_internal.mutation_call_receipts WHERE call_id = ${committed!.call_id}) AS transaction_id, (SELECT state FROM questpie_internal.mutation_checkpoints WHERE run_id = ${runId}) AS checkpoint`;
					expect(facts).toEqual({
						writes: 1,
						receipts: 1,
						transaction_id: committed!.transaction_id,
						checkpoint: authority === "collection" ? "completed" : "reserved",
					});
				},
			);
		},
		120_000,
	);
}
