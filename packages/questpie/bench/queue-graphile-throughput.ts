/** Disposable PostgreSQL, one process, preloaded backlog, 5 ms handlers. */
import { randomUUID } from "node:crypto";

import { runMigrations, runTaskList } from "graphile-worker";
import pg from "pg";

import { GraphileWorkerAdapter } from "../src/exports/adapters/graphile-worker.js";

const url = process.env.QUESTPIE_GRAPHILE_POSTGRES_URL;
if (!url) throw new Error("QUESTPIE_GRAPHILE_POSTGRES_URL is required");
const pool = new pg.Pool({ connectionString: url });
const count = 300;
try {
	for (const teamSize of [1, 5]) {
		for (const implementation of ["adapter", "native"] as const) {
			for (let sample = 1; sample <= 3; sample++) {
				const schema = `throughput_${randomUUID().replaceAll("-", "")}`;
				let handled = 0;
				const handler = async () => {
					await Bun.sleep(5);
					handled++;
				};
				const adapter = new GraphileWorkerAdapter({
					connectionString: url,
					schema,
					concurrentJobs: teamSize,
					pollInterval: 100,
				});
				adapter.on("error", (error) => {
					throw error;
				});
				let runner: ReturnType<typeof runTaskList> | undefined;
				try {
					if (implementation === "adapter") {
						await adapter.start();
						for (let i = 0; i < count; i++)
							await adapter.publish("throughput", i);
					} else {
						await runMigrations({ pgPool: pool, schema });
						await pool.query(
							`SELECT "${schema}".add_job('throughput', n::text::json, queue_name := $1) FROM generate_series(1,$2::int) n`,
							[teamSize === 1 ? "serial" : null, count],
						);
					}
					const started = performance.now();
					if (implementation === "adapter")
						await adapter.listen({ throughput: handler }, { teamSize });
					else
						runner = runTaskList(
							{
								schema,
								concurrency: teamSize,
								pollInterval: 100,
								noHandleSignals: true,
								preset: { worker: { completeJobBatchDelay: 0 } },
							},
							{ throughput: handler },
							pool,
						);
					for (;;) {
						if (handled >= count) break;
						if (performance.now() - started > 60_000)
							throw new Error("Throughput stalled");
						await Bun.sleep(5);
					}
					if (implementation === "adapter") {
						while (
							Number(
								(
									await pool.query(
										`SELECT count(*) FROM "${schema}".questpie_dispatches WHERE status='completed'`,
									)
								).rows[0].count,
							) < count
						)
							await Bun.sleep(5);
					}
					const seconds = (performance.now() - started) / 1000;
					console.log(
						JSON.stringify({
							implementation,
							teamSize,
							sample,
							count,
							seconds,
							jobsPerSecond: count / seconds,
						}),
					);
				} finally {
					await adapter.stop();
					await runner?.gracefulShutdown();
					await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
				}
			}
		}
	}
} finally {
	await pool.end();
}
