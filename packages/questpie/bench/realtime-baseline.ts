import os from "node:os";
import { performance } from "node:perf_hooks";

import { sql } from "drizzle-orm";

import {
	collection,
	createAdapterRoutes,
	questpieRealtimeLogTable,
	type RealtimeAdapter,
	type RealtimeChangeEvent,
} from "../src/exports/index.js";
import { buildMockApp } from "../test/utils/mocks/mock-app-builder.js";
import { createTestContext } from "../test/utils/test-context.js";
import { runTestDbMigrations } from "../test/utils/test-db.js";

type BenchmarkRow = Record<string, number | string>;

type Topic = {
	id: string;
	resourceType: "collection";
	resource: string;
	where?: Record<string, unknown>;
	with?: Record<string, unknown>;
	limit?: number;
	offset?: number;
	orderBy?: Record<string, "asc" | "desc">;
	locale?: string;
};

class LocalRealtimeAdapter implements RealtimeAdapter {
	private listeners = new Set<(event: RealtimeChangeEvent) => void>();

	async start() {}

	async stop() {}

	subscribe(listener: (event: RealtimeChangeEvent) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async notify(event: RealtimeChangeEvent) {
		for (const listener of this.listeners) listener(event);
	}
}

class SnapshotReader {
	private buffer = "";
	private decoder = new TextDecoder();
	private reader: ReadableStreamDefaultReader<Uint8Array>;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.reader = stream.getReader();
	}

	async readSnapshots(count: number): Promise<void> {
		let received = 0;
		while (received < count) {
			const event = await this.readEvent();
			if (event.type === "error") {
				throw new Error(`Realtime stream error: ${event.data}`);
			}
			if (event.type === "snapshot") received += 1;
		}
	}

	async close() {
		await this.reader.cancel();
	}

	private async readEvent(): Promise<{ type: string; data: string }> {
		while (true) {
			const separator = this.buffer.indexOf("\n\n");
			if (separator >= 0) {
				const rawEvent = this.buffer.slice(0, separator);
				this.buffer = this.buffer.slice(separator + 2);
				let type = "message";
				let data = "";
				for (const line of rawEvent.split("\n")) {
					if (line.startsWith("event:")) type = line.slice(6).trim();
					if (line.startsWith("data:")) data += line.slice(5).trim();
				}
				return { type, data };
			}

			const { done, value } = await this.reader.read();
			if (done) throw new Error("Realtime stream closed before snapshot");
			this.buffer += this.decoder.decode(value, { stream: true });
		}
	}
}

type OpenConnection = {
	close: () => Promise<void>;
	initialMs: number;
	reader: SnapshotReader;
};

function percentile(samples: number[], quantile: number): number {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((a, b) => a - b);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(quantile * sorted.length) - 1),
	);
	return sorted[index];
}

function rounded(value: number, digits = 2): number {
	return Number(value.toFixed(digits));
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function printTable(title: string, rows: BenchmarkRow[]) {
	console.log(`\n${title}`);
	console.table(rows);
}

function extractRows(result: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
	if (
		result &&
		typeof result === "object" &&
		"rows" in result &&
		Array.isArray((result as { rows: unknown }).rows)
	) {
		return (result as { rows: Array<Record<string, unknown>> }).rows;
	}
	return [];
}

const quick = process.argv.includes("--quick");
const refreshRounds = Number(
	process.env.REALTIME_BENCH_REFRESH_ROUNDS ?? (quick ? 2 : 10),
);
const outboxWrites = Number(
	process.env.REALTIME_BENCH_OUTBOX_WRITES ?? (quick ? 20 : 500),
);
const herdClients = Number(
	process.env.REALTIME_BENCH_HERD_CLIENTS ?? (quick ? 10 : 500),
);
const pgNotifyCount = Number(
	process.env.REALTIME_BENCH_NOTIFY_COUNT ?? (quick ? 1_000 : 20_000),
);

const authors = collection("benchAuthors").fields(({ f }) => ({
	name: f.text().required().localized(),
}));

const posts = collection("benchPosts")
	.fields(({ f }) => ({
		title: f.text().required().localized(),
		status: f.text().required(),
		secret: f.text(),
		author: f
			.relation("benchAuthors")
			.required()
			.onDelete("cascade")
			.relationName("author"),
	}))
	.access({
		read: ({ session }) =>
			(session?.user as { role?: string })?.role === "bench",
		create: true,
		update: true,
		fields: {
			secret: {
				read: ({ user }) => (user as { role?: string })?.role === "bench",
			},
		},
	})
	.hooks({
		afterRead: async () => {
			await Promise.resolve();
		},
	});

async function main() {
	const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"])
		.stdout.toString()
		.trim();
	console.log("Realtime v2 baseline benchmark");
	console.log(
		JSON.stringify({
			quick,
			refreshRounds,
			outboxWrites,
			herdClients,
			pgNotifyCount,
			runtime: `Bun ${Bun.version}`,
			platform: `${process.platform}/${process.arch}`,
			revision,
			cpu: os.cpus()[0]?.model,
			cores: os.cpus().length,
			memoryGiB: rounded(os.totalmem() / 1024 ** 3, 1),
		}),
	);

	const adapter = new LocalRealtimeAdapter();
	const setup = await buildMockApp(
		{
			collections: { benchAuthors: authors, benchPosts: posts },
			locale: {
				locales: [{ code: "en" }, { code: "sk" }],
				defaultLocale: "en",
			},
		},
		{
			realtime: {
				adapter,
				keepAliveIntervalMs: 60_000,
			},
		},
	);

	try {
		await runTestDbMigrations(setup.app);
		const systemContext = createTestContext({
			accessMode: "system",
			locale: "en",
		});
		const skSystemContext = createTestContext({
			accessMode: "system",
			locale: "sk",
		});
		const author = await setup.app.collections.benchAuthors.create(
			{ name: "Benchmark Author" },
			systemContext,
		);
		const seededPosts: Array<{ id: string }> = [];
		for (let index = 0; index < 30; index += 1) {
			seededPosts.push(
				await setup.app.collections.benchPosts.create(
					{
						title: `Benchmark Post ${index}`,
						status: index % 2 === 0 ? "published" : "draft",
						secret: `secret-${index}`,
						author: author.id,
					},
					systemContext,
				),
			);
		}
		await setup.app.db.delete(questpieRealtimeLogTable);

		const routes = createAdapterRoutes(setup.app, { accessMode: "user" });

		const openConnection = async (
			connectionId: string,
			topics: Topic[],
		): Promise<OpenConnection> => {
			const controller = new AbortController();
			const request = new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					topics: topics.map((topic) => ({
						...topic,
						id: `${connectionId}:${topic.id}`,
					})),
				}),
				signal: controller.signal,
			});
			const startedAt = performance.now();
			const response = await routes.realtime.subscribe(
				request,
				{},
				{
					appContext: createTestContext({
						accessMode: "user",
						role: "bench",
						locale: "sk",
					}),
				},
			);
			if (!response.ok || !response.body) {
				throw new Error(`Realtime connection failed: ${response.status}`);
			}
			const reader = new SnapshotReader(response.body);
			await reader.readSnapshots(topics.length);
			const initialMs = performance.now() - startedAt;
			return {
				reader,
				initialMs,
				close: async () => {
					controller.abort();
					await reader.close().catch(() => {});
				},
			};
		};

		const refreshTopic: Topic = {
			id: "representative",
			resourceType: "collection",
			resource: "benchPosts",
			where: { status: "published" },
			with: { author: true },
			limit: 25,
			orderBy: { id: "asc" },
			locale: "sk",
		};

		const refreshRows: BenchmarkRow[] = [];
		for (const concurrency of quick ? [1, 10] : [1, 10, 100]) {
			const connections = await Promise.all(
				Array.from({ length: concurrency }, (_, index) =>
					openConnection(`refresh-${concurrency}-${index}`, [refreshTopic]),
				),
			);
			const samples: number[] = [];
			for (let round = 0; round < refreshRounds; round += 1) {
				const startedAt = performance.now();
				const deliveries = connections.map(async ({ reader }) => {
					await reader.readSnapshots(1);
					return performance.now() - startedAt;
				});
				await setup.app.collections.benchPosts.updateById(
					{
						id: seededPosts[0].id,
						data: { title: `Obnovenie ${concurrency}-${round}` },
					},
					skSystemContext,
				);
				samples.push(...(await Promise.all(deliveries)));
			}
			refreshRows.push({
				concurrency,
				samples: samples.length,
				p50Ms: rounded(percentile(samples, 0.5)),
				p99Ms: rounded(percentile(samples, 0.99)),
				maxMs: rounded(Math.max(...samples)),
			});
			await Promise.all(connections.map((connection) => connection.close()));
			await delay(10);
		}
		printTable(
			"Refresh pipeline (ACL + i18n + relation + afterRead)",
			refreshRows,
		);

		const relationSize = async () => {
			const result = await setup.app.db.execute(
				sql.raw(
					"SELECT pg_total_relation_size('questpie_realtime_log')::bigint AS bytes",
				),
			);
			return Number(extractRows(result)[0]?.bytes ?? 0);
		};
		const outboxCount = async () => {
			const result = await setup.app.db.execute(
				sql.raw("SELECT count(*)::int AS count FROM questpie_realtime_log"),
			);
			return Number(extractRows(result)[0]?.count ?? 0);
		};

		await setup.app.db.delete(questpieRealtimeLogTable);
		await setup.app.db.execute(sql.raw("VACUUM questpie_realtime_log"));
		const sizeBefore = await relationSize();
		const writesStartedAt = performance.now();
		for (let index = 0; index < outboxWrites; index += 1) {
			const targetElapsedMs = index * 10;
			const remaining = targetElapsedMs - (performance.now() - writesStartedAt);
			if (remaining > 0) await delay(remaining);
			await setup.app.collections.benchPosts.updateById(
				{
					id: seededPosts[index % seededPosts.length].id,
					data: { secret: `outbox-${index}` },
				},
				systemContext,
			);
		}
		const writesElapsedMs = performance.now() - writesStartedAt;
		const rowsAfterWrites = await outboxCount();
		const sizeAfterWrites = await relationSize();
		await setup.app.db.delete(questpieRealtimeLogTable);
		const sizeAfterDelete = await relationSize();
		await setup.app.db.execute(sql.raw("VACUUM questpie_realtime_log"));
		const sizeAfterVacuum = await relationSize();
		printTable("Outbox at a 100 writes/s target", [
			{
				targetWritesPerSec: 100,
				actualWritesPerSec: rounded((outboxWrites / writesElapsedMs) * 1000),
				writes: outboxWrites,
				rows: rowsAfterWrites,
				beforeBytes: sizeBefore,
				afterBytes: sizeAfterWrites,
				growthBytes: sizeAfterWrites - sizeBefore,
				bytesPerRow: rounded(
					(sizeAfterWrites - sizeBefore) / Math.max(1, rowsAfterWrites),
				),
				afterDeleteBytes: sizeAfterDelete,
				afterVacuumBytes: sizeAfterVacuum,
			},
		]);

		const herdTopics: Topic[] = [
			{ ...refreshTopic, id: "published-sk", limit: 10 },
			{ ...refreshTopic, id: "published-en", limit: 10, locale: "en" },
			{ ...refreshTopic, id: "published-page-2", limit: 10, offset: 10 },
			{
				...refreshTopic,
				id: "draft-sk",
				where: { status: "draft" },
				limit: 10,
			},
			{ ...refreshTopic, id: "published-wide", limit: 25 },
		];

		const runHerd = async (label: string) => {
			const startedAt = performance.now();
			const results = await Promise.allSettled(
				Array.from({ length: herdClients }, (_, index) =>
					openConnection(`${label}-${index}`, herdTopics),
				),
			);
			const elapsedMs = performance.now() - startedAt;
			const connections = results.flatMap((result) =>
				result.status === "fulfilled" ? [result.value] : [],
			);
			const latencies = connections.map((connection) => connection.initialMs);
			const failures = results.length - connections.length;
			await Promise.all(connections.map((connection) => connection.close()));
			await delay(20);
			return {
				label,
				clients: herdClients,
				topicsPerClient: herdTopics.length,
				queries: herdClients * herdTopics.length,
				wallMs: rounded(elapsedMs),
				p50ClientMs: rounded(percentile(latencies, 0.5)),
				p99ClientMs: rounded(percentile(latencies, 0.99)),
				failures,
			};
		};

		const herdRows = [await runHerd("cold"), await runHerd("reconnect")];
		printTable("Deploy herd (multiplexed SSE initial snapshots)", herdRows);

		printTable("Topic overlap baseline", [
			{
				scenario: "barbershop default admin config",
				requested: 0,
				normalizedUnique: 0,
				safeUnique: 0,
				normalizedOverlapPct: "n/a (realtime=false)",
				safeOverlapPct: "n/a (realtime=false)",
			},
			{
				scenario: "admin realtime list/count hook",
				requested: 2,
				normalizedUnique: 1,
				safeUnique: 1,
				normalizedOverlapPct: 50,
				safeOverlapPct: 50,
			},
			{
				scenario: `${herdClients} principals x 5 shared topic shapes`,
				requested: herdClients * herdTopics.length,
				normalizedUnique: herdTopics.length,
				safeUnique: herdClients * herdTopics.length,
				normalizedOverlapPct: rounded(
					(1 - herdTopics.length / (herdClients * herdTopics.length)) * 100,
				),
				safeOverlapPct: 0,
			},
		]);

		await benchmarkPgNotify(pgNotifyCount);
	} finally {
		await setup.cleanup();
	}
}

async function benchmarkPgNotify(count: number) {
	const connectionString = process.env.REALTIME_BENCH_DATABASE_URL;
	if (!connectionString) {
		console.log(
			"\nPostgreSQL NOTIFY ceiling: SKIPPED (set REALTIME_BENCH_DATABASE_URL)",
		);
		return;
	}

	const { Client } = await import("pg");
	const publisher = new Client({ connectionString });
	const listener = new Client({ connectionString });
	const channel = `questpie_bench_${Date.now()}`;
	await publisher.connect();
	await listener.connect();
	let received = 0;
	let pending:
		| {
				target: number;
				resolve: () => void;
				timer: ReturnType<typeof setTimeout>;
		  }
		| undefined;
	listener.on("notification", (notification) => {
		if (notification.channel !== channel) return;
		received += 1;
		if (pending && received >= pending.target) {
			clearTimeout(pending.timer);
			pending.resolve();
			pending = undefined;
		}
	});
	const waitForNotifications = (target: number) =>
		new Promise<void>((resolve, reject) => {
			if (received >= target) {
				resolve();
				return;
			}
			const timer = setTimeout(() => {
				pending = undefined;
				reject(new Error(`NOTIFY delivery timed out at ${received}/${target}`));
			}, 30_000);
			pending = { target, resolve, timer };
		});

	try {
		await listener.query(`LISTEN ${channel}`);
		const rounds: number[] = [];
		for (let round = 0; round < 3; round += 1) {
			const target = received + count;
			const delivered = waitForNotifications(target);
			const startedAt = performance.now();
			await Promise.all([
				publisher.query(
					`SELECT pg_notify('${channel}', gs::text) FROM generate_series(1, ${count}) AS gs`,
				),
				delivered,
			]);
			rounds.push(performance.now() - startedAt);
		}
		printTable("PostgreSQL NOTIFY local-loopback ceiling", [
			{
				notificationsPerRound: count,
				rounds: rounds.length,
				medianPerSec: rounded((count / percentile(rounds, 0.5)) * 1000),
				worstPerSec: rounded((count / Math.max(...rounds)) * 1000),
				medianMs: rounded(percentile(rounds, 0.5)),
				maxMs: rounded(Math.max(...rounds)),
			},
		]);
	} finally {
		await listener.end();
		await publisher.end();
	}
}

await main();
