import os from "node:os";
import { performance } from "node:perf_hooks";

import { sql } from "drizzle-orm";

import {
	collection,
	createAdapterRoutes,
	questpieRealtimeLogTable,
	type ChangeBroker,
	type ChangeWake,
} from "../src/exports/index.js";
import type {
	RealtimeObservation,
	RealtimeObserver,
} from "../src/server/modules/core/integrated/realtime/observer.js";
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
	sinceSeq?: number;
};

class BenchmarkObserver implements RealtimeObserver {
	private refreshes = 0;

	record(event: RealtimeObservation): void {
		if (event.type === "refresh.started") this.refreshes += 1;
	}

	checkpoint(): number {
		return this.refreshes;
	}
}

class LocalChangeBroker implements ChangeBroker {
	private onWake: ((wake: ChangeWake) => void) | undefined;

	async start(input: Parameters<ChangeBroker["start"]>[0]) {
		this.onWake = input.onWake;
	}

	async stop() {}

	async publish(wake: ChangeWake) {
		this.onWake?.(wake);
	}
}

class SnapshotReader {
	private buffer = "";
	private decoder = new TextDecoder();
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private receivedBytes = 0;
	private controlSession: { sessionId: string; token: string } | null = null;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.reader = stream.getReader();
	}

	async readSnapshots(
		count: number,
	): Promise<Array<{ topicId: string; seq: number }>> {
		let received = 0;
		const snapshots: Array<{ topicId: string; seq: number }> = [];
		while (received < count) {
			const event = await this.readEvent();
			if (event.type === "error") {
				throw new Error(`Realtime stream error: ${event.data}`);
			}
			this.captureSession(event);
			if (event.type === "snapshot") {
				const frame = JSON.parse(event.data) as {
					topicId?: unknown;
					seq?: unknown;
				};
				if (
					typeof frame.topicId === "string" &&
					typeof frame.seq === "number"
				) {
					snapshots.push({ topicId: frame.topicId, seq: frame.seq });
				}
				received += 1;
			}
		}
		return snapshots;
	}

	async readSession(): Promise<void> {
		while (!this.controlSession) {
			const event = await this.readEvent();
			if (event.type === "error") {
				throw new Error(`Realtime stream error: ${event.data}`);
			}
			this.captureSession(event);
		}
	}

	get session(): { sessionId: string; token: string } {
		if (!this.controlSession)
			throw new Error("Realtime session metadata missing");
		return this.controlSession;
	}

	get bytesRead(): number {
		return this.receivedBytes;
	}

	async close() {
		await this.reader.cancel();
	}

	private captureSession(event: { type: string; data: string }): void {
		if (event.type !== "session") return;
		const session = JSON.parse(event.data) as {
			sessionId?: unknown;
			token?: unknown;
		};
		if (
			typeof session.sessionId === "string" &&
			typeof session.token === "string"
		) {
			this.controlSession = {
				sessionId: session.sessionId,
				token: session.token,
			};
		}
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
			this.receivedBytes += value.byteLength;
			this.buffer += this.decoder.decode(value, { stream: true });
		}
	}
}

type OpenConnection = {
	appContext: ReturnType<typeof createTestContext>;
	close: () => Promise<void>;
	connectionId: string;
	initialMs: number;
	initialRequestBytes: number;
	initialSnapshots: Array<{ topicId: string; seq: number }>;
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
const topologyRounds = Number(process.env.REALTIME_BENCH_TOPOLOGY_ROUNDS ?? 1);
const topologyClients = quick ? [1, 3] : [1, 100, 500];
const topologySizes = [1, 5, 15];

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
			topologyRounds,
			topologyClients,
			topologySizes,
			fixture: {
				authors: 1,
				posts: 30,
				locales: ["en", "sk"],
				operation: "swap one topic while retaining stable topics",
			},
			runtime: `Bun ${Bun.version}`,
			platform: `${process.platform}/${process.arch}`,
			revision,
			cpu: os.cpus()[0]?.model,
			cores: os.cpus().length,
			memoryGiB: rounded(os.totalmem() / 1024 ** 3, 1),
		}),
	);

	const changeBroker = new LocalChangeBroker();
	const observer = new BenchmarkObserver();
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
				changeBroker,
				observer,
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
			expectedSnapshots = topics.length,
		): Promise<OpenConnection> => {
			const controller = new AbortController();
			const appContext = createTestContext({
				accessMode: "user",
				role: "bench",
				locale: "sk",
			});
			const body = JSON.stringify({
				topics: topics.map((topic) => ({
					...topic,
					id: `${connectionId}:${topic.id}`,
				})),
			});
			const request = new Request("http://localhost/realtime", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				signal: controller.signal,
			});
			const startedAt = performance.now();
			const response = await routes.realtime.subscribe(
				request,
				{},
				{ appContext },
			);
			if (!response.ok || !response.body) {
				throw new Error(`Realtime connection failed: ${response.status}`);
			}
			const reader = new SnapshotReader(response.body);
			const initialSnapshots =
				expectedSnapshots > 0
					? await reader.readSnapshots(expectedSnapshots)
					: (await reader.readSession(), []);
			const initialMs = performance.now() - startedAt;
			return {
				appContext,
				connectionId,
				reader,
				initialMs,
				initialRequestBytes: Buffer.byteLength(body),
				initialSnapshots,
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

		const topologyTopics = (count: number): Topic[] =>
			Array.from({ length: count }, (_, index) => ({
				...refreshTopic,
				id: `topology-${index}`,
				limit: 10,
				offset: index,
			}));
		const topicConfig = (input: Topic) => {
			const { id: _id, sinceSeq: _sinceSeq, ...topic } = input;
			return topic;
		};
		const advanceGlobalOutbox = async () => {
			await setup.app.db.insert(questpieRealtimeLogTable).values({
				resourceType: "collection",
				resource: "benchPosts",
				operation: "update",
				recordId: "benchmark-global-advance",
				payload: {},
			});
		};

		type TopologyStrategy = "incremental" | "reconnect";
		type CursorState = "current" | "globally-advanced";
		const runTopologyChange = async (input: {
			strategy: TopologyStrategy;
			cursorState: CursorState;
			clients: number;
			topicCount: number;
			round: number;
		}) => {
			const baseTopics = topologyTopics(input.topicCount);
			const replacement: Topic = {
				...refreshTopic,
				id: `topology-replacement-${input.round}`,
				limit: 10,
				offset: input.topicCount + input.round,
			};
			const prefix = [
				"topology",
				input.strategy,
				input.cursorState,
				input.clients,
				input.topicCount,
				input.round,
			].join("-");
			let connections = await Promise.all(
				Array.from({ length: input.clients }, (_, index) =>
					openConnection(`${prefix}-${index}`, [...baseTopics, replacement]),
				),
			);
			const cursorFor = (connection: OpenConnection, topicId: string) => {
				const snapshot = connection.initialSnapshots.find(
					(candidate) =>
						candidate.topicId === `${connection.connectionId}:${topicId}`,
				);
				if (!snapshot) throw new Error(`Missing cached cursor for ${topicId}`);
				return snapshot.seq;
			};
			await Promise.all(
				connections.map(async (connection) => {
					const body = JSON.stringify({
						sessionId: connection.reader.session.sessionId,
						token: connection.reader.session.token,
						topology: {
							protocol: "questpie-realtime-topology",
							version: 1,
							revision: 1,
							topics: baseTopics.map((topic) => ({
								id: `${connection.connectionId}:${topic.id}`,
								topic: topicConfig(topic),
								sinceSeq: cursorFor(connection, topic.id),
							})),
							channels: [],
						},
					});
					const response = await routes.realtime.subscribe(
						new Request("http://localhost/realtime", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body,
						}),
						{},
						{ appContext: connection.appContext },
					);
					if (!response.ok) {
						throw new Error(
							`Realtime setup control failed: ${response.status}`,
						);
					}
				}),
			);
			if (input.cursorState === "globally-advanced") {
				await advanceGlobalOutbox();
			}

			const refreshCheckpoint = observer.checkpoint();
			const wallStartedAt = performance.now();
			let controlRequests = 0;
			let connectionRequests = 0;
			let requestBytes = 0;
			let responseBytes = 0;
			let latencies: number[] = [];

			if (input.strategy === "incremental") {
				latencies = await Promise.all(
					connections.map(async (connection) => {
						const replacementCursor = cursorFor(connection, replacement.id);
						const topic = topicConfig(replacement);
						const desiredBody = JSON.stringify({
							sessionId: connection.reader.session.sessionId,
							token: connection.reader.session.token,
							topology: {
								protocol: "questpie-realtime-topology",
								version: 1,
								revision: 2,
								topics: [
									...baseTopics.slice(0, -1).map((stable) => ({
										id: `${connection.connectionId}:${stable.id}`,
										topic: topicConfig(stable),
										sinceSeq: cursorFor(connection, stable.id),
									})),
									{
										id: `${connection.connectionId}:${replacement.id}`,
										topic,
										sinceSeq: replacementCursor,
									},
								],
								channels: [],
							},
						});
						requestBytes += Buffer.byteLength(desiredBody);
						controlRequests += 1;
						const bytesBefore = connection.reader.bytesRead;
						const snapshot =
							input.cursorState === "globally-advanced"
								? connection.reader.readSnapshots(1)
								: null;
						const startedAt = performance.now();
						const response = await routes.realtime.subscribe(
							new Request("http://localhost/realtime", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: desiredBody,
							}),
							{},
							{ appContext: connection.appContext },
						);
						if (!response.ok) {
							throw new Error(`Realtime control failed: ${response.status}`);
						}
						await snapshot;
						responseBytes += connection.reader.bytesRead - bytesBefore;
						return performance.now() - startedAt;
					}),
				);
			} else {
				const previous = connections;
				const next = await Promise.all(
					previous.map(async (connection, index) => {
						const replacementTopics = [
							...baseTopics.slice(0, -1).map((topic) => ({
								...topic,
								sinceSeq: cursorFor(connection, topic.id),
							})),
							{
								...replacement,
								sinceSeq: cursorFor(connection, replacement.id),
							},
						];
						const startedAt = performance.now();
						await connection.close();
						const opened = await openConnection(
							`${prefix}-reconnect-${index}`,
							replacementTopics,
							input.cursorState === "globally-advanced" ? input.topicCount : 0,
						);
						return {
							connection: opened,
							latency: performance.now() - startedAt,
						};
					}),
				);
				connections = next.map((result) => result.connection);
				latencies = next.map((result) => result.latency);
				connectionRequests = connections.length;
				requestBytes = connections.reduce(
					(total, connection) => total + connection.initialRequestBytes,
					0,
				);
				responseBytes = connections.reduce(
					(total, connection) => total + connection.reader.bytesRead,
					0,
				);
			}

			const wallMs = performance.now() - wallStartedAt;
			const snapshotQueries = observer.checkpoint() - refreshCheckpoint;
			await Promise.all(connections.map((connection) => connection.close()));
			await delay(10);
			return {
				latencies,
				wallMs,
				controlRequests,
				connectionRequests,
				requestBytes,
				responseBytes,
				snapshotQueries,
				stableTopicRecomputations: Math.max(0, snapshotQueries - input.clients),
			};
		};

		const topologyRows: BenchmarkRow[] = [];
		for (const cursorState of ["current", "globally-advanced"] as const) {
			for (const topicCount of topologySizes) {
				for (const clients of topologyClients) {
					for (const strategy of ["incremental", "reconnect"] as const) {
						console.log(
							`Topology case: strategy=${strategy} cursor=${cursorState} clients=${clients} topics=${topicCount}`,
						);
						const results = [];
						for (let round = 0; round < topologyRounds; round += 1) {
							results.push(
								await runTopologyChange({
									strategy,
									cursorState,
									clients,
									topicCount,
									round,
								}),
							);
						}
						const latencies = results.flatMap((result) => result.latencies);
						topologyRows.push({
							strategy,
							executionProtocol:
								strategy === "incremental"
									? "desired-topology-v1"
									: "full reconnect",
							cursorState,
							clients,
							topics: topicCount,
							samples: latencies.length,
							wallMs: rounded(
								results.reduce((total, result) => total + result.wallMs, 0),
							),
							p50Ms: rounded(percentile(latencies, 0.5)),
							p99Ms: rounded(percentile(latencies, 0.99)),
							snapshotQueries: results.reduce(
								(total, result) => total + result.snapshotQueries,
								0,
							),
							stableRecomputations: results.reduce(
								(total, result) => total + result.stableTopicRecomputations,
								0,
							),
							controlRequests: results.reduce(
								(total, result) => total + result.controlRequests,
								0,
							),
							connectionRequests: results.reduce(
								(total, result) => total + result.connectionRequests,
								0,
							),
							requestBytes: results.reduce(
								(total, result) => total + result.requestBytes,
								0,
							),
							responseBytes: results.reduce(
								(total, result) => total + result.responseBytes,
								0,
							),
						});
					}
				}
			}
		}
		printTable(
			"Measured topology swap: incremental desired-state semantics vs reconnect",
			topologyRows,
		);
		console.log(
			"Inference (not a measured percentage): fewer stable-topic recomputations and response bytes indicate the work avoided by desired-topology updates.",
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
