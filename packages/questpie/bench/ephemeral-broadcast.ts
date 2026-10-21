/** Isolated disposable PostgreSQL database required. See docs/research/ephemeral-broadcast.md. */
import os from "node:os";

import pg from "pg";

import { buildMockApp } from "../test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../test/utils/test-db.js";

const url = process.env.QUESTPIE_EPHEMERAL_DATABASE_URL;
if (!url)
	throw new Error(
		"QUESTPIE_EPHEMERAL_DATABASE_URL must point to an isolated test database",
	);
const durationMs = Number(process.env.EPHEMERAL_BENCH_DURATION_MS ?? 10_000);
const cursors = Number(process.env.EPHEMERAL_BENCH_CURSORS ?? 50);
const inputHz = Number(process.env.EPHEMERAL_BENCH_INPUT_HZ ?? 10);
const pool = new pg.Pool({ connectionString: url, max: 8 });
await pool.query("create extension if not exists pg_trgm");
const setup = await buildMockApp({}, { db: { url } });
await runTestDbMigrations(setup.app);
await setup.cleanup();
await pool.query(
	"create table if not exists ephemeral_bench_writes (id bigserial primary key, payload text not null)",
);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 90_000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (check()) return;
		await wait(10);
	}
	throw new Error("Benchmark process timed out");
}
function percentile(values: number[], p: number) {
	return (
		values.sort((a, b) => a - b)[
			Math.min(values.length - 1, Math.floor(values.length * p))
		] ?? null
	);
}
function worker(mode: string, channel: string) {
	const messages: any[] = [];
	const child = Bun.spawn(
		[
			process.execPath,
			new URL("./ephemeral-worker.ts", import.meta.url).pathname,
		],
		{
			env: {
				...process.env,
				EPHEMERAL_BENCH_MODE: mode,
				EPHEMERAL_BENCH_CHANNEL: channel,
			},
			stdout: "ignore",
			stderr: "inherit",
			ipc(message) {
				messages.push(message);
			},
		},
	);
	return {
		child,
		messages,
		async send(message: object) {
			const request = crypto.randomUUID();
			child.send({ ...message, request });
			await until(() => messages.some((m) => m.request === request));
			const response = messages.find((m) => m.request === request);
			if (response.error) throw new Error(response.error);
			return response;
		},
	};
}
async function writeLoad(stop: () => boolean) {
	const timings: number[] = [];
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			while (!stop()) {
				const start = performance.now();
				await pool.query(
					"insert into ephemeral_bench_writes(payload) values ($1)",
					["x".repeat(1024)],
				);
				timings.push(performance.now() - start);
				await wait(Math.max(0, 5 - (performance.now() - start)));
			}
		}),
	);
	return timings;
}
async function sampleWaits(stop: () => boolean) {
	const samples: Record<string, number> = {};
	while (!stop()) {
		const rows = await pool.query(
			"select coalesce(wait_event_type, 'CPU') || '/' || coalesce(wait_event, 'running') as event, count(*)::int as count from pg_stat_activity where datname=current_database() and state='active' and pid<>pg_backend_pid() group by 1",
		);
		for (const row of rows.rows)
			samples[row.event] = (samples[row.event] ?? 0) + row.count;
		await wait(200);
	}
	return samples;
}

const results: any[] = [];
try {
	for (const mode of (
		process.env.EPHEMERAL_BENCH_MODES ?? "writes-only,ephemeral,channels"
	).split(",")) {
		const channel = `bench_${crypto.randomUUID().replaceAll("-", "")}`;
		const publisher = mode === "writes-only" ? null : worker(mode, channel);
		const subscriber = mode === "writes-only" ? null : worker(mode, channel);
		try {
			if (publisher && subscriber) {
				await until(
					() =>
						publisher.messages.some((m) => m.ready) &&
						subscriber.messages.some((m) => m.ready),
				);
				await subscriber.send({ operation: "subscribe", cursors });
			}
			const before = await pool.query(
				"select count(*)::int as count from questpie_channel_event",
			);
			let stop = false;
			const start = Date.now();
			const writes = writeLoad(() => stop);
			const waitSamples = sampleWaits(() => stop);
			const publication = publisher
				? await publisher.send({
						operation: "run",
						cursors,
						durationMs,
						inputHz,
					})
				: (await wait(durationMs), {});
			const elapsedMs = Date.now() - start;
			stop = true;
			const writeMs = await writes;
			const waits = await waitSamples;
			const delivery = subscriber
				? await subscriber.send({ operation: "stats" })
				: { latencies: [], received: 0 };
			const after = await pool.query(
				"select count(*)::int as count from questpie_channel_event",
			);
			const errors = [
				...(publisher?.messages ?? []),
				...(subscriber?.messages ?? []),
			].filter((m) => m.error);
			const row = {
				mode,
				cursors,
				pages: 10,
				inputHz: mode === "channels-throttled" ? 10 : inputHz,
				elapsedMs,
				offered: publication.offered ?? 0,
				accepted: publication.completed ?? 0,
				cursorNotifies: publication.notifies ?? 0,
				presenceNotifies: delivery.notifies ?? 0,
				notifies: (publication.notifies ?? 0) + (delivery.notifies ?? 0),
				fanoutRoundTrips:
					(publication.fanoutRoundTrips ?? 0) +
					(delivery.fanoutRoundTrips ?? 0),
				failedFanout:
					(publication.failedFanout ?? 0) + (delivery.failedFanout ?? 0),
				pendingFanout:
					(publication.pendingFanout ?? 0) + (delivery.pendingFanout ?? 0),
				notifyPerSecond:
					((publication.notifies ?? 0) + (delivery.notifies ?? 0)) /
					(elapsedMs / 1000),
				receivedUnique: delivery.latencies.length,
				deliveredFrames: delivery.received,
				latencyP50Ms: percentile(delivery.latencies, 0.5),
				latencyP95Ms: percentile(delivery.latencies, 0.95),
				latencyP99Ms: percentile(delivery.latencies, 0.99),
				ledgerInserts: after.rows[0].count - before.rows[0].count,
				writes: writeMs.length,
				writesPerSecond: writeMs.length / (elapsedMs / 1000),
				writeP95Ms: percentile(writeMs, 0.95),
				writeP99Ms: percentile(writeMs, 0.99),
				maximumPending: publication.maximumPending ?? 0,
				errors,
				postgresWaitSamples: waits,
			};
			results.push(row);
			console.log(JSON.stringify(row));
		} finally {
			await Promise.allSettled([
				publisher?.send({ operation: "stop" }),
				subscriber?.send({ operation: "stop" }),
			]);
			publisher?.child.kill();
			subscriber?.child.kill();
		}
	}
	console.log(
		JSON.stringify(
			{
				environment: {
					bun: Bun.version,
					postgres: (await pool.query("select version() as version")).rows[0]
						.version,
					os: os.platform(),
					cpu: os.cpus()[0]?.model,
					cpus: os.cpus().length,
					loadAverage: os.loadavg(),
					freeMemoryBytes: os.freemem(),
				},
				durationMs,
				results,
			},
			null,
			2,
		),
	);
} finally {
	await pool.end();
}
