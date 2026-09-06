import { afterAll, expect, test } from "bun:test";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SQL } from "bun";
import type { Principal } from "questpie";

import { compileApplication } from "@questpie/compiler";

import {
	beta05Ids,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const admin = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = admin ? test.serial : test.skip;
afterAll(async () => {
	await admin?.close({ timeout: 0 });
});

type LoadedApplication = Readonly<{
	execution<Result>(
		root: Readonly<{
			principal: Principal;
			context: Readonly<{ companyId: string }>;
		}>,
		use: (
			scope: Readonly<{
				jobs: Readonly<{
					reports: Readonly<{
						companyDigest: Readonly<{
							accept(
								input: Readonly<{ companyId: string; restartProbe?: string }>,
								options: Readonly<{ idempotencyKey: string }>,
							): Promise<Readonly<{ runId: string }>>;
						}>;
					}>;
				}>;
			}>,
		) => Promise<Result>,
	): Promise<Result>;
	durable: Readonly<{
		schedules: Readonly<{
			activate(
				input: Readonly<{ expectedRevision: string }>,
			): Promise<Readonly<{ acceptedRevision: string; replayed: boolean }>>;
			reconcile(): Promise<Readonly<{ accepted: number; status: string }>>;
		}>;
		poll(options: Readonly<{ workerId: string; claimBatch: number }>): Promise<
			Readonly<{
				outcomes: readonly Readonly<{
					runId: string;
					outcome: string;
					failureCode?: string | null;
				}>[];
			}>
		>;
		inspect(runId: string): Promise<Readonly<{
			state: string;
			resultBytes: Uint8Array | null;
		}> | null>;
	}>;
	close(): Promise<void>;
}>;

function connectionUrl(name: string) {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.password = process.env.PGPASSWORD ?? "";
	url.pathname = `/${name}`;
	return url.toString();
}

postgresTest(
	"generated Job checkpoint joins the real worker, Mutation receipt and terminal settlement",
	async () => {
		const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
		const name = `qp_checkpoint_worker_${suffix}`;
		const url = connectionUrl(name);
		const previousDatabase = process.env.PGDATABASE;
		let owned = false;
		let database: SQL | undefined;
		let application: LoadedApplication | undefined;
		const contenders: LoadedApplication[] = [];
		let prepared:
			| Awaited<ReturnType<typeof prepareBeta05PostgresApplication>>
			| undefined;
		const failures: unknown[] = [];
		try {
			await admin!.unsafe(`CREATE DATABASE "${name}"`);
			owned = true;
			process.env.PGDATABASE = name;
			database = new SQL(url, { max: 2 });
			const [connected] =
				await database`SELECT current_database() AS name, current_setting('server_version_num')::integer AS version`;
			expect(connected.name).toBe(name);
			expect(connected.version).toBeGreaterThanOrEqual(170_000);
			expect(connected.version).toBeLessThan(180_000);
			prepared = await prepareBeta05PostgresApplication(database);
			const applicationRoot = resolve(
				prepared.generated.generatedRoot,
				"../..",
			);
			await copyFile(
				resolve(
					import.meta.dir,
					"../../../docs/v4/prototypes/static-job-schedules/checkpoint-worker.fixture.ts",
				),
				join(applicationRoot, "src/company-digest-job.ts"),
			);
			await compileApplication({ applicationRoot });
			const internal = (await prepared.generated.loadInternal()) as Readonly<{
				createApplication(
					input: Readonly<{
						postgres: Readonly<{
							connectionUrl: string;
							directConnectionUrl: string;
						}>;
						realtime: Readonly<{ hmacKey: Uint8Array }>;
						maintenance: Readonly<{ authorize(): boolean }>;
					}>,
				): Promise<LoadedApplication>;
			}>;
			application = await internal.createApplication({
				postgres: { connectionUrl: url, directConnectionUrl: url },
				realtime: { hmacKey: new Uint8Array(32).fill(45) },
				maintenance: { authorize: () => false },
			});
			const framework = prepared.generated.framework as Readonly<{
				principal: Readonly<{
					user(input: Readonly<{ id: string }>): Principal;
				}>;
			}>;
			const root = {
				principal: framework.principal.user({ id: beta05Ids.principal }),
				context: { companyId: beta05Ids.company },
			};
			const body = `worker-checkpoint-${suffix}`;
			const receipt = await application.execution(root, ({ jobs }) =>
				jobs.reports.companyDigest.accept(
					{ companyId: beta05Ids.company, restartProbe: body },
					{ idempotencyKey: suffix },
				),
			);
			const trace = await application.durable.poll({
				workerId: `checkpoint-${suffix}`,
				claimBatch: 1,
			});
			expect(trace.outcomes).toContainEqual({
				runId: receipt.runId,
				resource: "job:reports.companyDigest",
				attemptNumber: 1,
				outcome: "succeeded",
				failureCode: null,
			});
			expect((await application.durable.inspect(receipt.runId))?.state).toBe(
				"succeeded",
			);
			const [facts] = await database`SELECT
			(SELECT count(*)::integer FROM collaboration.messages WHERE body = ${body}) AS writes,
			(SELECT count(*)::integer FROM questpie_internal.mutation_checkpoints WHERE run_id = ${receipt.runId} AND state = 'completed') AS completed`;
			expect(facts).toEqual({ writes: 1, completed: 1 });
			for (const corruption of [
				"transient",
				"missing",
				"changed",
				"truncated",
				"renamed",
				"changed-input",
			] as const) {
				const restartProbe = `retry-after-checkpoint-${corruption}-${suffix}`;
				const retryReceipt = await application.execution(root, ({ jobs }) =>
					jobs.reports.companyDigest.accept(
						{ companyId: beta05Ids.company, restartProbe },
						{ idempotencyKey: `${suffix}-${corruption}` },
					),
				);
				const first = await application.durable.poll({
					workerId: `first-${corruption}-${suffix}`,
					claimBatch: 64,
				});
				expect(
					first.outcomes.find((outcome) => outcome.runId === retryReceipt.runId)
						?.outcome,
				).toBe("retryScheduled");
				const [checkpoint] =
					await database`SELECT call_id, state FROM questpie_internal.mutation_checkpoints WHERE run_id = ${retryReceipt.runId}`;
				expect(checkpoint.state).toBe("completed");
				if (corruption === "missing")
					await database`DELETE FROM questpie_internal.mutation_call_receipts WHERE call_id = ${checkpoint.call_id}`;
				else if (corruption === "changed")
					await database`UPDATE questpie_internal.mutation_call_receipts SET result_bytes = ${new TextEncoder().encode('{"id":"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2"}')} WHERE call_id = ${checkpoint.call_id}`;
				await Bun.sleep(1100);
				const resumed = await application.durable.poll({
					workerId: `resumed-${corruption}-${suffix}`,
					claimBatch: 64,
				});
				if (corruption === "transient") {
					expect(
						resumed.outcomes.find(
							(outcome) => outcome.runId === retryReceipt.runId,
						),
					).toMatchObject({
						outcome: "retryScheduled",
						failureCode: "HANDLER_FAILED",
					});
					await Bun.sleep(2100);
					const recovered = await application.durable.poll({
						workerId: `recovered-${suffix}`,
						claimBatch: 64,
					});
					expect(
						recovered.outcomes.find(
							(outcome) => outcome.runId === retryReceipt.runId,
						),
					).toMatchObject({ outcome: "succeeded", failureCode: null });
				} else
					expect(
						resumed.outcomes.find(
							(outcome) => outcome.runId === retryReceipt.runId,
						),
					).toMatchObject({
						outcome: "failed",
						failureCode: "CHECKPOINT_INVALID",
					});
				const [writes] =
					await database`SELECT count(*)::integer AS count FROM collaboration.messages WHERE body = ${restartProbe}`;
				expect(writes.count).toBe(1);
			}
			for (const mode of [
				"forged",
				"unawaited",
				"concurrent",
				"duplicate",
				"captured",
			] as const) {
				const restartProbe = `${mode}-${suffix}`;
				const hostile = await application.execution(root, ({ jobs }) =>
					jobs.reports.companyDigest.accept(
						{ companyId: beta05Ids.company, restartProbe },
						{ idempotencyKey: restartProbe },
					),
				);
				const run = await application.durable.poll({
					workerId: restartProbe,
					claimBatch: 64,
				});
				expect(
					run.outcomes.find((outcome) => outcome.runId === hostile.runId),
				).toMatchObject(
					mode === "captured"
						? { outcome: "succeeded", failureCode: null }
						: { outcome: "failed", failureCode: "CHECKPOINT_INVALID" },
				);
				const [writes] =
					await database`SELECT count(*)::integer AS count FROM collaboration.messages WHERE body = ${restartProbe}`;
				expect(writes.count).toBe(
					mode === "duplicate" || mode === "captured" ? 1 : 0,
				);
			}
			const activation = await application.durable.schedules.activate({
				expectedRevision: "0",
			});
			expect(activation).toMatchObject({
				acceptedRevision: "1",
				replayed: false,
			});
			expect(
				await application.durable.schedules.activate({ expectedRevision: "0" }),
			).toMatchObject({ acceptedRevision: "1", replayed: true });
			await database`UPDATE questpie_internal.schedule_frontiers SET frontier_minute = date_trunc('minute', clock_timestamp()) - interval '10 minutes'`;
			const [frontier] =
				await database`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`;
			await database`UPDATE collaboration.memberships SET status = 'inactive' WHERE id = ${beta05Ids.membership}`;
			const denied = await application.durable.poll({
				workerId: `denied-producer-${suffix}`,
				claimBatch: 1,
			});
			expect(denied).toMatchObject({
				producer: { status: "failed", code: "SCHEDULE_PRODUCER_FAILED" },
			});
			const [unchanged] =
				await database`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`;
			expect(unchanged.frontier_minute).toEqual(frontier.frontier_minute);
			await database`UPDATE collaboration.memberships SET status = 'active' WHERE id = ${beta05Ids.membership}`;
			for (let index = 0; index < 9; index++)
				contenders.push(
					await internal.createApplication({
						postgres: { connectionUrl: url, directConnectionUrl: url },
						realtime: { hmacKey: new Uint8Array(32).fill(45) },
						maintenance: { authorize: () => false },
					}),
				);
			const producers = await Promise.all(
				[application, ...contenders].map((candidate) =>
					candidate.durable.schedules.reconcile(),
				),
			);
			expect(producers.reduce((sum, value) => sum + value.accepted, 0)).toBe(1);
			const ticks =
				await database`SELECT tick.run_id, run.principal_kind, run.principal_id FROM questpie_internal.schedule_ticks tick JOIN questpie_internal.durable_runs run USING (application_name, run_id)`;
			expect(ticks).toHaveLength(1);
			expect(ticks[0]).toMatchObject({
				principal_kind: "service",
				principal_id: beta05Ids.principal,
			});
			const scheduled = await application.durable.poll({
				workerId: `scheduled-${suffix}`,
				claimBatch: 64,
			});
			expect(
				scheduled.outcomes.find((outcome) => outcome.runId === ticks[0].run_id),
			).toMatchObject({ outcome: "succeeded", failureCode: null });
			const [scheduledWrites] =
				await database`SELECT count(*)::integer AS count FROM collaboration.messages WHERE body = 'scheduled-checkpoint'`;
			expect(scheduledWrites.count).toBe(1);
		} catch (error) {
			failures.push(error);
		} finally {
			for (const close of [
				...contenders.map((candidate) => () => candidate.close()),
				() => application?.close(),
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
				"checkpoint worker proof and cleanup failed",
			);
	},
	120_000,
);
