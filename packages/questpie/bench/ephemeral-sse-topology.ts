/** Full shared Fetch/SSE path, including its existing PostgreSQL control rows.
 * Requires an isolated database with pg_stat_statements preloaded + installed.
 */
import pg from "pg";
import { z } from "zod";

import { createFetchHandler } from "../src/server/adapters/http.js";
import { channel } from "../src/server/channels/channel-builder.js";
import { createChannels } from "../src/server/channels/service.js";
import { parseCompatibleTypedEventWire } from "../src/shared/typed-wire.js";
import { buildMockApp } from "../test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../test/utils/test-db.js";

const url = process.env.QUESTPIE_EPHEMERAL_DATABASE_URL!;
if (!url) throw new Error("An isolated benchmark database is required");
const pool = new pg.Pool({ connectionString: url, max: 8 });
const setup = await buildMockApp(
	{
		channels: {
			page: channel("topology-bench-[id]")
				.events({ cursor: z.object({ actor: z.string(), sentAt: z.number() }) })
				.authorize({
					subscribe: async () =>
						(await pool.query("select true as allowed")).rows[0].allowed,
					publish: true,
				})
				.presence(({ session }) => ({ id: session!.user.id }))
				.ephemeral(),
		},
	},
	{ db: { url }, realtime: { retentionDays: 0 } },
);
const controllers: AbortController[] = [];
const readers: Promise<void>[] = [];
let ready = 0,
	frames = 0,
	closed = 0;
const unique = new Set<string>();
const latency: number[] = [];
const writes: number[] = [];
let stopped = false;
async function statements() {
	return (
		await pool.query(
			"select query, calls::float8, rows::float8, total_exec_time from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and (query like '%questpie_realtime_topology%' or query like 'select pg_notify(%') and query not like '%pg_stat_statements%' order by query",
		)
	).rows;
}
function delta(before: any[], after: any[]) {
	return after
		.map((a) => {
			const b = before.find((b) => b.query === a.query);
			return {
				query: a.query,
				calls: a.calls - (b?.calls ?? 0),
				rows: a.rows - (b?.rows ?? 0),
				executionMs: a.total_exec_time - (b?.total_exec_time ?? 0),
			};
		})
		.filter((a) => a.calls);
}
const p = (values: number[], fraction: number) =>
	values.sort((a, b) => a - b)[Math.floor(values.length * fraction)] ?? null;
try {
	await runTestDbMigrations(setup.app);
	await pool.query(
		"create table if not exists ephemeral_bench_writes(id bigserial primary key, payload text not null)",
	);
	const handler = createFetchHandler(setup.app, {
		getSession: async (request: Request) =>
			({
				user: { id: request.headers.get("x-actor")! },
				session: { id: request.headers.get("x-actor")! },
			}) as any,
	});
	const channels = createChannels(
		setup.app.config.channels,
		setup.app.realtime,
		{ accessMode: "system" } as any,
	);
	const beforeCounts = (
		await pool.query(
			"select (select count(*) from questpie_channel_event)::int as events, (select count(*) from questpie_channel_presence)::int as presence",
		)
	).rows[0];
	const beforeOpen = await statements();
	const openStart = performance.now();
	for (let i = 0; i < 50; i++) {
		const controller = new AbortController();
		controllers.push(controller);
		const response = await handler(
			new Request("http://localhost/realtime", {
				method: "POST",
				signal: controller.signal,
				headers: {
					"content-type": "application/json",
					"x-actor": `actor-${i}`,
				},
				body: JSON.stringify({
					channels: [
						{
							id: `cursor-${i}`,
							channel: "page",
							params: { id: String(i % 10) },
						},
					],
				}),
			}),
		);
		if (response.status !== 200)
			throw new Error(`${response.status}: ${await response.text()}`);
		readers.push(
			(async () => {
				const reader = response.body!.getReader();
				let buffer = "";
				try {
					while (true) {
						const next = await reader.read();
						if (next.done) break;
						buffer += new TextDecoder().decode(next.value);
						let end: number;
						while ((end = buffer.indexOf("\n\n")) >= 0) {
							const frame = buffer.slice(0, end);
							buffer = buffer.slice(end + 2);
							if (frame.startsWith("event: channel_ready")) ready++;
							if (!frame.startsWith("event: channel_ephemeral")) continue;
							const event = parseCompatibleTypedEventWire(
								frame
									.split("\n")
									.find((line) => line.startsWith("data: "))!
									.slice(6),
							) as any;
							frames++;
							if (!unique.has(event.eventId)) {
								unique.add(event.eventId);
								latency.push(Date.now() - event.data.sentAt);
							}
						}
					}
				} finally {
					closed++;
					reader.releaseLock();
				}
			})(),
		);
	}
	const readyDeadline = Date.now() + 10_000;
	for (;;) {
		if (ready >= 50 || Date.now() >= readyDeadline) break;
		await Bun.sleep(10);
	}
	if (ready !== 50) throw new Error(`Only ${ready}/50 streams ready`);
	const openMs = performance.now() - openStart;
	const afterOpen = await statements();
	const writers = Promise.all(
		Array.from({ length: 4 }, async () => {
			for (;;) {
				if (stopped) break;
				const start = performance.now();
				await pool.query(
					"insert into ephemeral_bench_writes(payload) values ($1)",
					["x".repeat(1024)],
				);
				writes.push(performance.now() - start);
				await Bun.sleep(Math.max(0, 5 - (performance.now() - start)));
			}
		}),
	);
	const start = Date.now();
	let offered = 0;
	// 21 seconds covers two default ten-second topology lease renewals.
	while (Date.now() - start < 21_000) {
		const tick = Date.now();
		await Promise.all(
			Array.from({ length: 50 }, (_, i) => {
				offered++;
				return channels
					.page({ id: String(i % 10) })
					.publish(
						"cursor",
						{ actor: `actor-${i}`, sentAt: Date.now() },
						{ coalesceKey: `actor-${i}` },
					);
			}),
		);
		await Bun.sleep(Math.max(0, 100 - (Date.now() - tick)));
	}
	await Bun.sleep(300);
	const elapsedMs = Date.now() - start;
	stopped = true;
	await writers;
	const afterRun = await statements();
	const tableCounts = (
		await pool.query(
			"select (select count(*) from questpie_realtime_topology)::int as topology, (select count(*) from questpie_channel_event)::int as events, (select count(*) from questpie_channel_presence)::int as presence",
		)
	).rows[0];
	console.log(
		JSON.stringify(
			{
				streams: 50,
				pages: 10,
				inputHz: 10,
				offered,
				openMs,
				elapsedMs,
				ready,
				closedDuringRun: closed,
				frames,
				retained: unique.size,
				latencyP95Ms: p(latency, 0.95),
				latencyP99Ms: p(latency, 0.99),
				writesPerSecond: writes.length / (elapsedMs / 1000),
				writeP95Ms: p(writes, 0.95),
				tableCounts,
				ledgerInserts: tableCounts.events - beforeCounts.events,
				presenceInserts: tableCounts.presence - beforeCounts.presence,
				openSql: delta(beforeOpen, afterOpen),
				steadySql: delta(afterOpen, afterRun),
			},
			null,
			2,
		),
	);
} finally {
	stopped = true;
	for (const controller of controllers) controller.abort();
	await Promise.allSettled(readers);
	await setup.cleanup();
	await pool.end();
}
