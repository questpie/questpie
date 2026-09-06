import { afterAll, expect, test } from "bun:test";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SQL } from "bun";
import type { Principal } from "questpie";

import { compileApplication } from "@questpie/compiler";

import { eventually, waitForOutputLine } from "../../../packages/testkit/src";
import {
	beta05Ids,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";
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
) {
	const name = `qp_checkpoint_recovery_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
	const url = connectionUrl(name);
	const previousDatabase = process.env.PGDATABASE;
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
		database = new SQL(url, { max: 4 });
		const [connected] =
			await database`SELECT current_database() AS name, current_setting('server_version_num')::integer AS version`;
		expect(connected.name).toBe(name);
		expectPostgresMajor(connected.version);
		prepared = await prepareBeta05PostgresApplication(database);
		const applicationRoot = resolve(prepared.generated.generatedRoot, "../..");
		await copyFile(
			resolve(
				import.meta.dir,
				"../../../docs/v4/prototypes/static-job-schedules/checkpoint-recovery-job.fixture.ts",
			),
			join(applicationRoot, "src/company-digest-job.ts"),
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
