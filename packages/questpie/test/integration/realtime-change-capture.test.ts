import { afterEach, describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

import {
	collection,
	getTxid,
	global,
	questpieRealtimeLogTable,
} from "../../src/exports/index.js";
import { realtimeSubscribe } from "../../src/server/adapters/routes/realtime.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Records every statement the driver executes, including the ones issued inside
 * a managed transaction — which is where change capture writes the outbox.
 * Counting statements is the only way to tell "the outbox ended up empty" apart
 * from "the outbox was never touched": a `DELETE`d row and a row that was never
 * inserted look identical from a `SELECT`.
 */
type SqlProbe = {
	statements: string[];
	reset: () => void;
	realtime: () => string[];
};

const REALTIME_CAPTURE_SQL = /questpie_realtime_(log|head)/i;

function instrumentPglite(client: PGlite): SqlProbe {
	const statements: string[] = [];
	const record = (statement: unknown) => {
		if (typeof statement === "string") statements.push(statement);
	};

	const wrapExecutor = <T extends object>(target: T): T => {
		const executor = target as unknown as {
			query?: (...args: unknown[]) => unknown;
			exec?: (...args: unknown[]) => unknown;
		};
		const query = executor.query?.bind(executor);
		if (query) {
			executor.query = (...args: unknown[]) => {
				record(args[0]);
				return query(...args);
			};
		}
		const exec = executor.exec?.bind(executor);
		if (exec) {
			executor.exec = (...args: unknown[]) => {
				record(args[0]);
				return exec(...args);
			};
		}
		return target;
	};

	wrapExecutor(client);
	const transaction = client.transaction.bind(client);
	(client as unknown as { transaction: unknown }).transaction = (
		callback: (tx: object) => unknown,
		...rest: unknown[]
	) =>
		(transaction as (...args: unknown[]) => unknown)(
			(tx: object) => callback(wrapExecutor(tx)),
			...rest,
		);

	return {
		statements,
		reset: () => {
			statements.length = 0;
		},
		realtime: () =>
			statements.filter((statement) => REALTIME_CAPTURE_SQL.test(statement)),
	};
}

async function flushEventLoopTurns(turns = 20): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

const posts = () =>
	collection("posts")
		.fields(({ f }) => ({ title: f.text().required() }))
		.access({ read: true });

const siteSettings = () =>
	global("site_settings").fields(({ f }) => ({ title: f.text().required() }));

async function buildApp(changeCapture: boolean) {
	const client = await PGlite.create({ extensions: { pg_trgm } });
	await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm");
	const probe = instrumentPglite(client);

	const setup = await buildMockApp(
		{
			collections: { posts: posts() },
			globals: { siteSettings: siteSettings() },
		},
		{ db: { pglite: client }, realtime: { changeCapture } },
	);
	await runTestDbMigrations(setup.app);

	return {
		app: setup.app,
		probe,
		ctx: createTestContext(setup.app),
		cleanup: async () => {
			await setup.cleanup();
			await client.close();
		},
	};
}

const collectionTopic = {
	id: "col-posts",
	resourceType: "collection" as const,
	resource: "posts",
};

const globalTopic = {
	id: "global-siteSettings",
	resourceType: "global" as const,
	resource: "siteSettings",
};

const subscribeRequest = (topics: unknown[]) =>
	new Request("http://localhost/realtime", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ topics }),
	});

describe("realtime change capture switch", () => {
	let active: Awaited<ReturnType<typeof buildApp>> | undefined;

	afterEach(async () => {
		await active?.cleanup();
		active = undefined;
	}, 30_000);

	describe("changeCapture: false", () => {
		it("issues no realtime SQL for a collection mutation", async () => {
			active = await buildApp(false);
			active.probe.reset();

			const created = await active.app.collections.posts.create(
				{ title: "Uncaptured" },
				active.ctx,
			);
			await active.app.collections.posts.update(
				{ where: { id: created.id }, data: { title: "Still uncaptured" } },
				active.ctx,
			);
			await active.app.collections.posts.delete(
				{ where: { id: created.id } },
				active.ctx,
			);
			await flushEventLoopTurns();

			expect(active.probe.realtime()).toEqual([]);
			// The mutations really ran — an empty probe from a no-op app would prove
			// nothing.
			expect(active.probe.statements.length).toBeGreaterThan(0);
			expect(
				await active.app.db.select().from(questpieRealtimeLogTable),
			).toHaveLength(0);
		}, 30_000);

		it("issues no realtime SQL for a global mutation", async () => {
			active = await buildApp(false);
			active.probe.reset();

			await active.app.globals.siteSettings.update(
				{ title: "Uncaptured" },
				active.ctx,
			);
			await flushEventLoopTurns();

			expect(active.probe.realtime()).toEqual([]);
			expect(
				await active.app.db.select().from(questpieRealtimeLogTable),
			).toHaveLength(0);
		}, 30_000);

		it("refuses a collection subscription with change_capture_disabled", async () => {
			active = await buildApp(false);

			const response = await realtimeSubscribe(
				active.app,
				subscribeRequest([collectionTopic]),
				{},
				undefined,
				{ accessMode: "user" },
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				errors: [
					{
						code: "REALTIME_TOPIC_REJECTED",
						topicId: "col-posts",
						resource: "posts",
						retryable: false,
						details: { reason: "change_capture_disabled" },
					},
				],
			});
			expect(active.app.realtime.listeners.size).toBe(0);
		}, 30_000);

		it("refuses a global subscription with change_capture_disabled", async () => {
			active = await buildApp(false);

			const response = await realtimeSubscribe(
				active.app,
				subscribeRequest([globalTopic]),
				{},
				undefined,
				{ accessMode: "user" },
			);

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				errors: [
					{
						code: "REALTIME_TOPIC_REJECTED",
						details: { reason: "change_capture_disabled" },
					},
				],
			});
		}, 30_000);

		it("returns no txid, so optimistic clients cannot silently mismatch", async () => {
			active = await buildApp(false);

			const created = await active.app.collections.posts.create(
				{ title: "No txid" },
				active.ctx,
			);

			expect(getTxid(created)).toBeUndefined();
		}, 30_000);
	});

	describe("changeCapture on (default)", () => {
		it("still writes the outbox and correlates the txid", async () => {
			active = await buildApp(true);
			active.probe.reset();

			const created = await active.app.collections.posts.create(
				{ title: "Captured" },
				active.ctx,
			);

			const realtimeSql = active.probe.realtime();
			expect(
				realtimeSql.filter((statement) =>
					/insert into "questpie_realtime_log"/i.test(statement),
				),
			).toHaveLength(1);

			const rows = await active.app.db.select().from(questpieRealtimeLogTable);
			expect(rows).toHaveLength(1);
			expect(getTxid(created)).toBe(rows[0]?.txid as string);
		}, 30_000);

		it("admits a collection subscription", async () => {
			active = await buildApp(true);

			const response = await realtimeSubscribe(
				active.app,
				subscribeRequest([collectionTopic]),
				{},
				undefined,
				{ accessMode: "user" },
			);

			expect(response.status).toBe(200);
			await response.body?.cancel();
		}, 30_000);
	});
});
