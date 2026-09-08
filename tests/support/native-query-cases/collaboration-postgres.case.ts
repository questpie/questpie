import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import {
	MutationObserver,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import { SQL } from "bun";
import { createQueryAdapter } from "questpie/react-query";

import { createApp } from "#questpie/app";
import { createClient } from "#questpie/client";
import {
	applyCommittedMigrations,
	loadCommittedMigration,
} from "@questpie/compiler";
import { CleanupStack } from "@questpie/testkit";

import { beta05Ids as ids } from "./test-ids";

// This case is strict-checked against its freshly compiled application/client before execution.
const owned = /^[a-f0-9]{64}$/.test(
	process.env.QUESTPIE_NATIVE_QUERY_CONTAINER ?? "",
);
const postgresTest = owned ? test : test.skip;
let database: SQL | undefined;
let application: Awaited<ReturnType<typeof createApp>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let session: string;
const requests: { path: string; method: string; callId: string | null }[] = [];
const streams = new Set<AbortController>();
let streamOpens = 0;
let reconnectWaits = 0;
let holdReconnect: Promise<void> | undefined;
let loseMutationResponse = false;

beforeAll(async () => {
	if (!owned) return;
	if (
		process.env.PGHOST !== "127.0.0.1" ||
		process.env.PGDATABASE !== "collaboration_native" ||
		process.env.PGUSER !== "postgres" ||
		!/^\d+$/.test(process.env.PGPORT ?? "") ||
		process.env.PGPASSWORD
	)
		throw new Error("Only the owned disposable PostgreSQL runner is permitted");
	const inspected = Bun.spawnSync([
		"docker",
		"port",
		process.env.QUESTPIE_NATIVE_QUERY_CONTAINER!,
		"5432/tcp",
	]);
	if (
		inspected.exitCode !== 0 ||
		inspected.stdout.toString().trim() !== `127.0.0.1:${process.env.PGPORT}`
	)
		throw new Error("PostgreSQL endpoint does not belong to this tracer");
	database = new SQL({ max: 4 });
	const version = await database<
		{ server_version_num: string }[]
	>`SHOW server_version_num`;
	expect(Number(version[0]!.server_version_num)).toBeGreaterThanOrEqual(170000);
	expect(Number(version[0]!.server_version_num)).toBeLessThan(180000);
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST!;
	url.port = process.env.PGPORT!;
	url.username = process.env.PGUSER!;
	url.pathname = `/${process.env.PGDATABASE!}`;
	const connectionString = url.toString();
	const migrationRoot = join(import.meta.dir, "questpie/migrations");
	const names = (await readdir(migrationRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const applied = await applyCommittedMigrations({
		connectionString,
		migrations: await Promise.all(
			names.map((name) => loadCommittedMigration(join(migrationRoot, name))),
		),
	});
	expect(applied.status).toBe("applied");
	await database`INSERT INTO collaboration.companies (id, name) VALUES (${ids.company}, 'Native consumer')`;
	await database`INSERT INTO collaboration.spaces (id, company_id, name) VALUES (${ids.space}, ${ids.company}, 'Product')`;
	await database`INSERT INTO collaboration.channels (id, space_id, name) VALUES (${ids.channel}, ${ids.space}, 'General')`;
	await database`INSERT INTO collaboration.memberships (id, company_id, principal_id, role, scope_key, status) VALUES (${ids.membership}, ${ids.company}, ${ids.principal}, 'admin', 'company', 'active')`;
	await database`INSERT INTO collaboration.messages (id, channel_id, author_membership_id, body, created_at) VALUES (${ids.message}, ${ids.channel}, ${ids.membership}, 'Initial protected body', '2026-08-15T10:00:00.000Z')`;
	const credentials = await import("./src/route-auth");
	session = `${credentials.demoSessionCookieName}=${credentials.demoSessionToken}`;
	application = await createApp({
		postgres: {
			connectionUrl: connectionString,
			directConnectionUrl: connectionString,
		},
		realtime: { hmacKey: new Uint8Array(32).fill(29) },
		maintenance: { authorize: () => false },
	});
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 0,
		fetch: (request) => application!.fetch(request),
	});
}, 120000);

afterAll(async () => {
	const cleanup = new CleanupStack();
	cleanup.defer(async () => {
		await database?.close({ timeout: 0 });
	});
	cleanup.defer(async () => {
		await application?.close();
	});
	cleanup.defer(async () => {
		await server?.stop(true);
	});
	for (const controller of streams) cleanup.defer(() => controller.abort());
	await cleanup.dispose();
});

function client() {
	return createClient({
		baseUrl: server!.url.origin,
		fetch: Object.assign(
			async (request: RequestInfo | URL, init?: RequestInit) => {
				const input = new Request(request, init);
				const path = new URL(input.url).pathname;
				const isStream =
					input.method === "GET" &&
					input.headers.get("accept")?.includes("text/event-stream");
				if (isStream && holdReconnect) {
					reconnectWaits++;
					await holdReconnect;
				}
				const headers = new Headers(input.headers);
				headers.set("cookie", session);
				const controller = isStream ? new AbortController() : undefined;
				if (controller) {
					streams.add(controller);
					streamOpens++;
				}
				const signal = controller
					? AbortSignal.any([input.signal, controller.signal])
					: input.signal;
				requests.push({
					path,
					method: input.method,
					callId: input.headers.get("Idempotency-Key"),
				});
				const response = await fetch(new Request(input, { headers, signal }));
				if (loseMutationResponse && path.includes("/mutation/")) {
					loseMutationResponse = false;
					await response.arrayBuffer();
					throw new Error("TEST_RESPONSE_LOST_AFTER_EXECUTION");
				}
				return response;
			},
			{ preconnect: fetch.preconnect },
		),
	});
}

async function until(check: () => boolean, label: string) {
	const end = Date.now() + 20000;
	while (!check()) {
		if (Date.now() >= end)
			throw new Error(`Native consumer did not observe ${label}`);
		await Bun.sleep(25);
	}
}

postgresTest(
	"a local commit refreshes two native one-shot families without affecting another scope",
	async () => {
		const cache = new QueryClient();
		const root = client();
		const scope = root.withContext({ companyId: ids.company });
		const adapter = createQueryAdapter(scope, cache, { ssr: true });
		const other = createQueryAdapter(
			root.withContext({ companyId: ids.company }),
			cache,
			{ ssr: true },
		);
		const pageInput = { channelId: ids.channel, first: 50, after: null };
		const page = adapter.queries["messages.page"]!.options(pageInput);
		const detail = adapter.queries["channels.detail"]!.options({
			id: ids.channel,
		});
		const otherPage = other.queries["messages.page"]!.options(pageInput);
		const mutation = new MutationObserver(
			cache,
			adapter.mutations["message.publish"]!.options(),
		);
		try {
			await Promise.all([
				cache.fetchQuery(page),
				cache.fetchQuery(detail),
				cache.fetchQuery(otherPage),
			]);
			await mutation.mutate({ channelId: ids.channel, body: "Two families" });
			await until(
				() =>
					cache.getQueryState(page.queryKey)?.isInvalidated === true &&
					cache.getQueryState(detail.queryKey)?.isInvalidated === true,
				"both stale families",
			);
			expect(cache.getQueryState(otherPage.queryKey)?.isInvalidated).toBe(
				false,
			);
			expect(JSON.stringify(await cache.fetchQuery(page))).toContain(
				"Two families",
			);
			expect(JSON.stringify(await cache.fetchQuery(detail))).toContain(
				"Two families",
			);
		} finally {
			const cleanup = new CleanupStack();
			cleanup.defer(() => cache.clear());
			cleanup.defer(() => other.dispose());
			cleanup.defer(() => adapter.dispose());
			cleanup.defer(() => mutation.reset());
			await cleanup.dispose();
		}
	},
);

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected a decoded result object");
	return value as Record<string, unknown>;
}
function rows(value: unknown, member = "nodes") {
	const selected = record(value)[member];
	if (!Array.isArray(selected)) throw new Error("Expected a decoded row list");
	return selected.map(record);
}

postgresTest(
	"native windows replace after reconnect and discard real Policy-omitted Fields before scope retirement",
	async () => {
		const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61d0";
		const removedId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61d1";
		await database!`INSERT INTO collaboration.channels (id, space_id, name) VALUES (${channelId}, ${ids.space}, 'Independent native windows')`;
		await database!`INSERT INTO collaboration.messages (id, channel_id, author_membership_id, body, created_at) VALUES (${removedId}, ${channelId}, ${ids.membership}, 'Window row removed during gap', '2026-08-15T10:00:00.000Z'), ('018f5f6e-5f2c-7b41-a854-3d9a6b6b61d2', ${channelId}, ${ids.membership}, 'Second protected window row', '2026-08-15T10:00:00.000Z')`;
		const cache = new QueryClient({
			defaultOptions: { mutations: { retry: 3, retryDelay: 1 } },
		});
		const root = client();
		const scoped = root.withContext({ companyId: ids.company });
		const adapter = createQueryAdapter(scoped, cache);
		const small = adapter.queries["messages.page"]!.options({
			channelId,
			first: 1,
			after: null,
		});
		const large = adapter.queries["messages.page"]!.options({
			channelId,
			first: 50,
			after: null,
		});
		const detail = adapter.queries["channels.detail"]!.options({
			id: channelId,
		});
		const observers = [
			new QueryObserver(cache, small),
			new QueryObserver(cache, large),
			new QueryObserver(cache, detail),
		];
		const stops = observers.map((observer) => observer.subscribe(() => {}));
		const mutation = new MutationObserver(
			cache,
			adapter.mutations["message.publish"]!.options(),
		);
		const reconnect = Promise.withResolvers<void>();
		try {
			const initial = await Promise.all([
				cache.fetchQuery(small),
				cache.fetchQuery(large),
				cache.fetchQuery(detail),
			]);
			expect(small.queryKey).not.toEqual(large.queryKey);
			expect(rows(initial[0])).toHaveLength(1);
			expect(rows(initial[1])).toHaveLength(2);
			expect(rows(initial[1]).map((row) => row.id)).toEqual([
				"018f5f6e-5f2c-7b41-a854-3d9a6b6b61d2",
				removedId,
			]);
			expect(JSON.stringify(initial[1])).toContain(
				"Second protected window row",
			);
			expect(rows(initial[2], "messages")).toHaveLength(2);
			const initialStreams = streamOpens;
			expect(initialStreams).toBe(1);
			const ordinaryReads = () =>
				requests.filter((request) => request.path.includes("/query/")).length;
			const initialOrdinaryReads = ordinaryReads();
			const priorWrites = requests.filter((request) =>
				request.path.includes("/mutation/"),
			).length;
			loseMutationResponse = true;
			await expect(
				mutation.mutate({
					channelId,
					body: "Unknown outcome survives exactly once",
				}),
			).rejects.toThrow("TEST_RESPONSE_LOST_AFTER_EXECUTION");
			await until(
				() =>
					JSON.stringify(cache.getQueryData(large.queryKey)).includes(
						"Unknown outcome survives exactly once",
					),
				"the committed response-lost write",
			);
			await Bun.sleep(25);
			expect(
				requests.filter((request) => request.path.includes("/mutation/"))
					.length - priorWrites,
			).toBe(1);
			expect(
				rows(cache.getQueryData(large.queryKey)).filter(
					(row) => row.body === "Unknown outcome survives exactly once",
				),
			).toHaveLength(1);
			expect(streamOpens).toBe(initialStreams);
			expect(ordinaryReads()).toBe(initialOrdinaryReads);

			holdReconnect = reconnect.promise;
			for (const controller of streams) controller.abort();
			await until(
				() => reconnectWaits > 0,
				"a blocked native transport reconnect",
			);
			const gap = await scoped.mutations["message.publish"]({
				channelId,
				body: "Written in the disconnected gap",
			});
			await database!`DELETE FROM collaboration.messages WHERE id = ${removedId}`;
			expect(JSON.stringify(cache.getQueryData(large.queryKey))).not.toContain(
				"Written in the disconnected gap",
			);
			holdReconnect = undefined;
			reconnect.resolve();
			await until(
				() =>
					rows(cache.getQueryData(small.queryKey))[0]?.id === gap.id &&
					JSON.stringify(cache.getQueryData(large.queryKey)).includes(
						"Written in the disconnected gap",
					) &&
					JSON.stringify(cache.getQueryData(detail.queryKey)).includes(
						"Written in the disconnected gap",
					),
				"both replacement families after the gap",
			);
			expect(
				rows(cache.getQueryData(large.queryKey)).filter(
					(row) => row.id === gap.id,
				),
			).toHaveLength(1);
			expect(
				rows(cache.getQueryData(large.queryKey)).some(
					(row) => row.id === removedId,
				),
			).toBe(false);
			expect(
				rows(cache.getQueryData(detail.queryKey), "messages").some(
					(row) => row.id === removedId,
				),
			).toBe(false);
			expect(
				rows(cache.getQueryData(small.queryKey)).map((row) => row.id),
			).toEqual([gap.id]);
			expect(rows(cache.getQueryData(large.queryKey))).toHaveLength(3);
			expect(
				rows(cache.getQueryData(detail.queryKey), "messages"),
			).toHaveLength(3);
			expect(streamOpens).toBe(initialStreams + 1);
			expect(ordinaryReads()).toBe(initialOrdinaryReads);

			await database!`UPDATE collaboration.memberships SET role = 'member' WHERE id = ${ids.membership}`;
			await until(
				() =>
					[small, large].every((options) => {
						const value = cache.getQueryData(options.queryKey);
						return (
							value !== undefined &&
							rows(value).every((row) => !Object.hasOwn(row, "body"))
						);
					}) &&
					cache.getQueryData(detail.queryKey) !== undefined &&
					rows(cache.getQueryData(detail.queryKey), "messages").every(
						(row) => !Object.hasOwn(row, "body"),
					),
				"Policy omission in every native view",
			);
			expect(rows(cache.getQueryData(large.queryKey))).toHaveLength(3);
			expect(
				rows(cache.getQueryData(small.queryKey)).map((row) => row.id),
			).toEqual([gap.id]);
			expect(
				rows(cache.getQueryData(detail.queryKey), "messages"),
			).toHaveLength(3);
			for (const options of [small, large, detail])
				expect(
					JSON.stringify(cache.getQueryData(options.queryKey)),
				).not.toContain("Written in the disconnected gap");

			await database!`UPDATE collaboration.memberships SET status = 'inactive' WHERE id = ${ids.membership}`;
			await until(
				() =>
					observers.every(
						(observer) =>
							observer.getCurrentResult().isError &&
							observer.getCurrentResult().data === undefined,
					),
				"terminal membership loss clearing attached native data",
			);
			for (const options of [small, large, detail]) {
				expect(cache.getQueryData(options.queryKey)).toBeUndefined();
			}
			for (const read of [
				() => cache.fetchQuery(small),
				() => cache.fetchQuery(large),
				() => cache.fetchQuery(detail),
			]) {
				await expect(read()).rejects.toThrow("SCOPE_RETIRED");
			}
			expect(mutation.getCurrentResult().isError).toBe(true);
			await adapter.dispose();
			expect(mutation.getCurrentResult().data).toBeUndefined();
			expect(cache.getQueryCache().getAll()).toHaveLength(0);
		} finally {
			holdReconnect = undefined;
			reconnect.resolve();
			const cleanup = new CleanupStack();
			cleanup.defer(async () => {
				await database!`UPDATE collaboration.memberships SET status = 'active', role = 'admin' WHERE id = ${ids.membership}`;
			});
			cleanup.defer(() => cache.clear());
			cleanup.defer(() => adapter.dispose());
			cleanup.defer(() => mutation.reset());
			for (const observer of observers) cleanup.defer(() => observer.destroy());
			for (const stop of stops) cleanup.defer(stop);
			await cleanup.dispose();
		}
	},
);
