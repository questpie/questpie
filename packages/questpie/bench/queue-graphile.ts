/** Real PostgreSQL comparison; use a disposable database with pg_stat_statements loaded. */
import { randomUUID } from "node:crypto";

import pg from "pg";

import { GraphileWorkerAdapter } from "../src/exports/adapters/graphile-worker.js";
import { PgBossAdapter } from "../src/exports/adapters/pg-boss.js";
import type { QueueAdapter } from "../src/server/modules/core/integrated/queue/adapter.js";

const url = process.env.QUESTPIE_GRAPHILE_POSTGRES_URL;
if (!url) throw new Error("QUESTPIE_GRAPHILE_POSTGRES_URL is required");
const pool = new pg.Pool({ connectionString: url });
await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
const token = randomUUID().replaceAll("-", "").slice(0, 12);
const names = Array.from({ length: 79 }, (_, index) => `job-${index}`);
const results: unknown[] = [];
try {
	for (const type of ["pg-boss", "graphile-worker"] as const) {
		const schema = `bench_${type.replaceAll("-", "")}_${token}`;
		const adapter: QueueAdapter =
			type === "pg-boss"
				? new PgBossAdapter({
						connectionString: url,
						schema,
						useApplicationTransaction: false,
						max: 50,
						connectionTimeoutMillis: 60_000,
					})
				: new GraphileWorkerAdapter({
						connectionString: url,
						schema,
						concurrentJobs: 395,
						maxPoolSize: 50,
					});
		adapter.on("error", (error) => {
			throw error;
		});
		let acknowledged: (() => void) | undefined;
		const handlers = Object.fromEntries(
			names.map((name) => [
				name,
				async () => {
					acknowledged?.();
				},
			]),
		);
		try {
			await adapter.start();
			await adapter.listen!(handlers, { teamSize: 5 });
			await Bun.sleep(2500);
			const calls = async () =>
				Number(
					(
						await pool.query(
							"SELECT coalesce(sum(calls),0) AS calls FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query LIKE $1",
							[`%${schema}%`],
						)
					).rows[0].calls,
				);
			console.log(JSON.stringify({ phase: "idle", adapter: type }));
			const before = await calls();
			const start = performance.now();
			await Bun.sleep(10_000);
			const idleSeconds = (performance.now() - start) / 1000;
			const idleCalls = (await calls()) - before;
			const latency: number[] = [];
			for (let index = 0; index < 10; index++) {
				console.log(
					JSON.stringify({ phase: "pickup", adapter: type, sample: index }),
				);
				const done = new Promise<void>((resolve) => {
					acknowledged = resolve;
				});
				const began = performance.now();
				await adapter.publish(names[index]!, { index });
				await Promise.race([
					done,
					Bun.sleep(30_000).then(() => {
						throw new Error("Pickup exceeded 30 seconds");
					}),
				]);
				latency.push(performance.now() - began);
			}
			latency.sort((a, b) => a - b);
			const result = {
				adapter: type,
				jobNames: 79,
				teamSize: 5,
				graphileConcurrentJobs: type === "graphile-worker" ? 395 : undefined,
				idleSeconds,
				idleQueries: idleCalls,
				idleQueriesPerSecond: idleCalls / idleSeconds,
				pickupSamples: latency.length,
				pickupP50Ms: latency[4],
				pickupP95Ms: latency[9],
				pickupMinMs: latency[0],
				pickupMaxMs: latency[9],
			};
			results.push(result);
			console.log(JSON.stringify(result));
		} finally {
			await adapter.stop();
			await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
		}
	}
} finally {
	await pool.end();
}
console.log(JSON.stringify({ results }));
