import { expect, test } from "bun:test";

import { SQL } from "bun";

import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
} from "./helpers/beta08-durable";

const postgres = process.env.PGHOST ? test : test.skip;

postgres(
	"retained compiler-built workers execute only their own accepted Reactions",
	async () => {
		const admin = new SQL({ max: 1 });
		const name = `qp_retained_${crypto.randomUUID().replaceAll("-", "")}`;
		const priorDatabase = process.env.PGDATABASE;
		const priorAlias = process.env.PG_DATABASE;
		let database: SQL | undefined;
		let created = false;
		try {
			await admin.unsafe(`CREATE DATABASE "${name}"`);
			created = true;
			process.env.PGDATABASE = name;
			process.env.PG_DATABASE = name;
			database = new SQL({ database: name, max: 4 });
			const [identity] = await database`SELECT current_database() AS name`;
			expect(identity.name).toBe(name);
			const prepared = await beta08Harness(database);
			const retained = await prepared.createRetainedApplication();
			for (const [index, application] of [prepared.app, retained].entries()) {
				await application.execution(
					{
						principal: prepared.principal,
						context: { companyId: beta05Ids.company },
					},
					({ mutations }) =>
						mutations.message.publish(
							{
								channelId: beta05Ids.channel,
								body: `retained ownership ${index}`,
							},
							{ callId: `retained-ownership-${index}` },
						),
				);
			}
			const runs = await database.unsafe<{ runId: string; build: string }[]>(
				`SELECT run_id::text AS "runId", runtime_build_digest AS build
			 FROM questpie_internal.durable_runs ORDER BY run_id`,
			);
			expect(runs).toHaveLength(2);
			expect(new Set(runs.map((run) => run.build)).size).toBe(2);
			const currentRun = runs.find(
				(run) => run.build === prepared.runtimeBuildDigest,
			)!;
			const retainedRun = runs.find(
				(run) => run.build !== prepared.runtimeBuildDigest,
			)!;
			expect(currentRun).toBeDefined();
			expect(retainedRun).toBeDefined();
			const currentPoll = await prepared.app.durable.poll();
			expect(currentPoll.claimed).toBe(1);
			expect(currentPoll.outcomes.map((outcome) => outcome.runId)).toEqual([
				currentRun.runId,
			]);
			expect(await retained.durable.inspect(retainedRun.runId)).toMatchObject({
				state: "ready",
				attemptCount: 0,
			});
			await retained.close();
			const restarted = await prepared.createRetainedApplication();
			const retainedPoll = await restarted.durable.poll();
			expect(retainedPoll.claimed).toBe(1);
			expect(retainedPoll.outcomes.map((outcome) => outcome.runId)).toEqual([
				retainedRun.runId,
			]);
			const currentResult = await prepared.app.durable.inspect(
				currentRun.runId,
			);
			const retainedResult = await restarted.durable.inspect(retainedRun.runId);
			expect(currentResult).toMatchObject({
				state: "succeeded",
				attemptCount: 1,
			});
			expect(retainedResult).toMatchObject({
				state: "succeeded",
				attemptCount: 1,
			});
			const decode = (bytes: Uint8Array | null | undefined) =>
				JSON.parse(new TextDecoder().decode(bytes ?? undefined)) as {
					deliveryReceipt: string;
				};
			expect(
				decode(currentResult?.resultBytes).deliveryReceipt.startsWith(
					"retained:",
				),
			).toBe(false);
			expect(
				decode(retainedResult?.resultBytes).deliveryReceipt.startsWith(
					"retained:",
				),
			).toBe(true);
		} finally {
			try {
				await disposeBeta08Harness();
			} finally {
				try {
					await database?.close({ timeout: 0 });
				} finally {
					if (priorDatabase === undefined) delete process.env.PGDATABASE;
					else process.env.PGDATABASE = priorDatabase;
					if (priorAlias === undefined) delete process.env.PG_DATABASE;
					else process.env.PG_DATABASE = priorAlias;
					try {
						if (created)
							await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
					} finally {
						await admin.close({ timeout: 0 });
					}
				}
			}
		}
	},
	120_000,
);
