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
			for (const corruption of ["missing", "changed"] as const) {
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
				else
					await database`UPDATE questpie_internal.mutation_call_receipts SET result_bytes = ${new TextEncoder().encode('{"id":"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2"}')} WHERE call_id = ${checkpoint.call_id}`;
				await Bun.sleep(1100);
				const resumed = await application.durable.poll({
					workerId: `resumed-${corruption}-${suffix}`,
					claimBatch: 64,
				});
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
		} catch (error) {
			failures.push(error);
		} finally {
			for (const close of [
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
