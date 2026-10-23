/**
 * `route().query()` — every evaluation reads one read-only repeatable-read
 * snapshot: request-derived context facts, access, handler and output
 * validation share it, request services are created fresh on it, and
 * ordinary routes keep their own transaction behavior.
 *
 * PGlite has a single connection, so a concurrent commit cannot interleave
 * with an open snapshot here. The commit-between-reads barrier runs against
 * real PostgreSQL in route-query-postgres.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { collection, route, service } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { createAdapterContext } from "../../src/server/adapters/utils/context.js";
import {
	getCurrentTransaction,
	isInTransaction,
	withTransaction,
} from "../../src/server/collection/crud/shared/transaction.js";
import { extractAppServices } from "../../src/server/config/app-context.js";
import { runInFreshRequestScope } from "../../src/server/config/request-scope.js";
import { rowsOf } from "../../src/server/db/driver-result.js";
import { executeJsonRoute } from "../../src/server/routes/execute.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

type Settings = { isolation: string; readOnly: string };

async function readSettings(db: any): Promise<Settings> {
	const [row] = rowsOf<Settings>(
		await db.execute(
			sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as "readOnly"`,
		),
	);
	return row!;
}

const settingsSchema = z.object({
	isolation: z.string(),
	readOnly: z.string(),
});
const empty = z.object({});

describe("route().query() definition", () => {
	const output = z.object({ ok: z.boolean() });

	it("requires .schema(), .outputSchema() and .access() at the terminal", () => {
		expect(() =>
			route()
				.post()
				.schema(empty)
				.outputSchema(output)
				.query()
				.handler(() => ({ ok: true })),
		).toThrow("route().query() requires .access()");
		expect(() =>
			route()
				.post()
				.schema(empty)
				.access(true)
				.query()
				// @ts-expect-error a query route must declare its output schema
				.handler(() => ({ ok: true })),
		).toThrow("route().query() requires .outputSchema()");
		expect(() =>
			route()
				.post()
				.outputSchema(output)
				.query()
				// @ts-expect-error a query route must declare its input schema
				.handler(() => ({ ok: true })),
		).toThrow("route().query() requires .schema(), .access()");
	});

	it("cannot be combined with raw mode in either order", () => {
		expect(() => route().post().raw().query()).toThrow(
			"route().query() routes cannot be raw",
		);
		expect(() => route().post().query().raw()).toThrow(
			"route().query() routes cannot be raw",
		);
	});

	it("freezes the query declaration and leaves ordinary JSON routes unmarked", () => {
		const data = (input: { companyId: string }) => ({
			tasks: { company: input.companyId },
		});
		const live = route()
			.post()
			.schema(z.object({ companyId: z.string() }))
			.outputSchema(output)
			.access(true)
			.query({ live: { data, maxAgeMs: 30_000 } })
			.handler(() => ({ ok: true }));
		const plain = route()
			.post()
			.schema(empty)
			.outputSchema(output)
			.handler(() => ({ ok: true }));

		expect(live.query.live.data).toBe(data);
		expect(live.query.live.maxAgeMs).toBe(30_000);
		expect(Object.isFrozen(live.query)).toBe(true);
		expect(Object.isFrozen(live.query.live)).toBe(true);
		expect(
			route()
				.post()
				.schema(empty)
				.outputSchema(output)
				.access(true)
				.query()
				.handler(() => ({ ok: true })).query,
		).toEqual({});
		expect("query" in plain).toBe(false);
	});

	it("rejects live declarations without data or with an unbounded maximum age", () => {
		const builder = route().post().schema(empty);
		expect(() => builder.query({ live: {} as never })).toThrow(
			"requires a data(input) function",
		);
		for (const maxAgeMs of [0, 999, 1_500.5, 3_600_001, Infinity]) {
			expect(() =>
				builder.query({ live: { data: () => ({}), maxAgeMs } }),
			).toThrow("maxAgeMs must be an integer from 1000 to 3600000");
		}
	});
});

describe("route().query() execution", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let handle: ReturnType<typeof createFetchHandler>;
	let quotaId: string;
	let resolverRuns = 0;
	let probesCreated = 0;
	const probesDisposed: number[] = [];
	let accessSettings: Settings | undefined;
	const accessSeen: unknown[] = [];

	const counters = collection("query_counters")
		.fields(({ f }) => ({
			name: f.text().required(),
			value: f.number().required(),
		}))
		.access({ read: true, create: true, update: true });
	const quotas = collection("query_quotas")
		.fields(({ f }) => ({
			owner: f.text().required(),
			limit: f.number().required(),
		}))
		.access({ read: true, update: true });

	const snapshotProbe = service()
		.lifecycle("request")
		.create(({ db }) => ({ id: ++probesCreated, db }))
		.dispose((probe) => {
			probesDisposed.push((probe as { id: number }).id);
		});

	// appConfig({ context }) facts read the database, like an authority lookup.
	const ownerFacts = async ({ request, collections, db }: any) => {
		resolverRuns++;
		const owner = request.headers.get("x-owner");
		if (!owner) return {};
		const quota = await collections.query_quotas.findOne({ where: { owner } });
		return {
			quotaLimit: quota?.limit ?? null,
			factDb: db,
			factSettings: await readSettings(db),
		};
	};

	const snapshot = route()
		.post()
		.schema(empty)
		.outputSchema(
			z.object({
				access: settingsSchema,
				handler: settingsSchema,
				ambientIsDb: z.boolean(),
				serviceDbIsDb: z.boolean(),
				serviceId: z.number(),
			}),
		)
		.access(async (ctx: any) => {
			accessSettings = await readSettings(ctx.db);
			return true;
		})
		.query()
		.handler(async ({ db, services }: any) => ({
			access: accessSettings!,
			handler: await readSettings(db),
			ambientIsDb: getCurrentTransaction() === db,
			serviceDbIsDb: services.snapshotProbe.db === db,
			serviceId: services.snapshotProbe.id,
		}));

	const quotaOutput = z.object({
		quotaLimit: z.number().nullable(),
		factDbIsDb: z.boolean(),
		factReadOnly: z.string(),
	});
	const quotaHandler = (ctx: any) => ({
		quotaLimit: ctx.quotaLimit ?? null,
		factDbIsDb: ctx.factDb === ctx.db,
		factReadOnly: ctx.factSettings?.readOnly ?? "none",
	});
	const quota = route()
		.post()
		.schema(empty)
		.outputSchema(quotaOutput)
		.access(true)
		.query()
		.handler(quotaHandler);
	const quotaOrdinary = route()
		.post()
		.schema(empty)
		.outputSchema(quotaOutput)
		.access(true)
		.handler(quotaHandler);

	const scoped = route()
		.post()
		.params<{ owner: string }>()
		.schema(z.object({ owner: z.string().trim().toLowerCase() }))
		.outputSchema(z.object({ owner: z.string() }))
		.access(({ input, params }) => {
			accessSeen.push({ input, params });
			return input.owner === params?.owner;
		})
		.query()
		.handler(({ input }) => ({ owner: input.owner }));

	const writes = route()
		.post()
		.schema(empty)
		.outputSchema(z.object({ id: z.string() }))
		.access(true)
		.query()
		.handler(async ({ collections }: any) => {
			const created = await collections.query_counters.create({
				name: "from-query",
				value: 1,
			});
			return { id: created.id };
		});

	const badOutput = route()
		.post()
		.schema(z.object({ value: z.number() }))
		.outputSchema(z.object({ value: z.number() }))
		.access(true)
		.query()
		.handler(() => ({ value: "not a number" }) as never);

	const ordinaryWrite = route()
		.post()
		.schema(z.object({ name: z.string() }))
		.access(({ input }) => input.name.length > 0)
		.handler(async ({ input, db, collections }: any) => {
			const outside = {
				inTransaction: isInTransaction(),
				settings: await readSettings(db),
			};
			const inside = await withTransaction(db, async (tx) => {
				await collections.query_counters.create({
					name: input.name,
					value: 7,
				});
				return readSettings(tx);
			});
			return { outside, inside };
		});

	const userContext = { accessMode: "user" as const };

	function ownerRequest(owner: string, path = "/quota", body: unknown = {}) {
		return new Request(`http://localhost${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-owner": owner },
			body: JSON.stringify(body),
		});
	}

	beforeAll(async () => {
		setup = await buildMockApp({
			collections: { query_counters: counters, query_quotas: quotas },
			services: { snapshotProbe },
			routes: {
				snapshot,
				quota,
				quotaOrdinary,
				"scoped/[owner]": scoped,
				writes,
				badOutput,
				ordinaryWrite,
			},
			config: { app: { context: ownerFacts } },
		});
		await runTestDbMigrations(setup.app);
		handle = createFetchHandler(setup.app);
		const created = await setup.app.collections.query_quotas.create({
			owner: "ada",
			limit: 3,
		});
		quotaId = created.id;
	});

	afterAll(async () => {
		await setup.cleanup();
	});

	it("runs access and the handler in one read-only repeatable-read transaction bound as the ambient db", async () => {
		const result = await executeJsonRoute(setup.app, snapshot, {}, userContext);

		const readOnlySnapshot = { isolation: "repeatable read", readOnly: "on" };
		expect(result.access).toEqual(readOnlySnapshot);
		expect(result.handler).toEqual(readOnlySnapshot);
		expect(result.ambientIsDb).toBe(true);
		expect(result.serviceDbIsDb).toBe(true);
		expect(isInTransaction()).toBe(false);
	});

	it("creates request services fresh on the snapshot without disposing the caller's scope", async () => {
		probesDisposed.length = 0;
		let outerId = 0;
		await runInFreshRequestScope(setup.app, async () => {
			const outer = (extractAppServices(setup.app, { db: setup.app.db }) as any)
				.services.snapshotProbe;
			outerId = outer.id;
			expect(outer.db).toBe(setup.app.db);

			const result = await executeJsonRoute(
				setup.app,
				snapshot,
				{},
				userContext,
			);
			expect(result.serviceDbIsDb).toBe(true);
			expect(result.serviceId).not.toBe(outerId);
			expect(probesDisposed).toEqual([result.serviceId]);
		});
		expect(probesDisposed.at(-1)).toBe(outerId);
	});

	it("re-derives request facts on the snapshot instead of reusing facts resolved before it", async () => {
		const adapter = await createAdapterContext(setup.app, ownerRequest("ada"));
		expect(adapter.appContext.quotaLimit).toBe(3);
		await setup.app.collections.query_quotas.updateById({
			id: quotaId,
			data: { limit: 5 },
		});
		try {
			expect(
				await executeJsonRoute(setup.app, quota, {}, adapter.appContext),
			).toEqual({ quotaLimit: 5, factDbIsDb: true, factReadOnly: "on" });
			// Ordinary routes keep facts resolved once per request.
			expect(
				await executeJsonRoute(
					setup.app,
					quotaOrdinary,
					{},
					adapter.appContext,
				),
			).toEqual({ quotaLimit: 3, factDbIsDb: true, factReadOnly: "off" });
		} finally {
			await setup.app.collections.query_quotas.updateById({
				id: quotaId,
				data: { limit: 3 },
			});
		}
	});

	it("uses facts a caller supplies explicitly as given", async () => {
		expect(
			await executeJsonRoute(
				setup.app,
				quota,
				{},
				{
					accessMode: "user",
					"~contextExtensions": { quotaLimit: 42 },
				},
			),
		).toEqual({ quotaLimit: 42, factDbIsDb: false, factReadOnly: "none" });
	});

	it("resolves HTTP query facts once, inside its snapshot", async () => {
		resolverRuns = 0;
		const response = await handle(ownerRequest("ada"));

		expect(response?.status).toBe(200);
		expect(await response!.json()).toEqual({
			quotaLimit: 3,
			factDbIsDb: true,
			factReadOnly: "on",
		});
		// Identity resolves before execution; database-backed facts resolve only
		// inside the query transaction.
		expect(resolverRuns).toBe(1);
	});

	it("gives access the parsed input and the real path params", async () => {
		accessSeen.length = 0;
		const allowed = await handle(
			ownerRequest("ada", "/scoped/ada", { owner: "  ADA " }),
		);
		expect(allowed?.status).toBe(200);
		expect(await allowed!.json()).toEqual({ owner: "ada" });
		expect(accessSeen).toEqual([
			{ input: { owner: "ada" }, params: { owner: "ada" } },
		]);

		const denied = await handle(
			ownerRequest("ada", "/scoped/bob", { owner: "ada" }),
		);
		expect(denied?.status).toBe(403);
		expect((await denied!.json()).error.code).toBe("FORBIDDEN");
	});

	it("rejects database writes and keeps nothing", async () => {
		const failure = await executeJsonRoute(
			setup.app,
			writes,
			{},
			userContext,
		).catch((error: unknown) => error as { cause?: { code?: string } });
		expect(failure?.cause?.code).toBe("25006"); // read_only_sql_transaction

		const response = await handle(ownerRequest("ada", "/writes"));
		expect(response?.status).toBe(500);
		expect((await response!.json()).error.code).toBe("INTERNAL_SERVER_ERROR");
		expect(
			await setup.app.collections.query_counters.count({
				where: { name: "from-query" },
			}),
		).toBe(0);
	});

	it("reports invalid output as a server error and invalid input as a client error", async () => {
		const invalidOutput = await handle(
			ownerRequest("ada", "/bad-output", { value: 1 }),
		);
		expect(invalidOutput?.status).toBe(500);
		const outputError = (await invalidOutput!.json()).error;
		expect(outputError.code).toBe("INTERNAL_SERVER_ERROR");
		expect(outputError.fieldErrors).toBeUndefined();

		const invalidInput = await handle(
			ownerRequest("ada", "/bad-output", { value: "one" }),
		);
		expect(invalidInput?.status).toBe(400);
		expect((await invalidInput!.json()).error.code).toBe("VALIDATION_ERROR");
	});

	it("never falls back to system authority", async () => {
		const missing =
			"Query routes require a request context with an explicit accessMode";
		await expect(executeJsonRoute(setup.app, quota, {})).rejects.toThrow(
			missing,
		);
		await expect(executeJsonRoute(setup.app, quota, {}, {})).rejects.toThrow(
			missing,
		);
		// Explicit trusted system authority is allowed.
		expect(
			await executeJsonRoute(setup.app, quota, {}, { accessMode: "system" }),
		).toEqual({ quotaLimit: null, factDbIsDb: false, factReadOnly: "none" });
	});

	it("refuses to join a transaction it does not own", async () => {
		const owned = "Query routes cannot run inside an existing transaction";
		await expect(
			withTransaction(setup.app.db, () =>
				executeJsonRoute(setup.app, quota, {}, userContext),
			),
		).rejects.toThrow(owned);
		await expect(
			setup.app.db.transaction((tx: unknown) =>
				executeJsonRoute(setup.app, quota, {}, { ...userContext, db: tx }),
			),
		).rejects.toThrow(owned);
	});

	it("leaves ordinary routes outside any transaction, with handler-owned transactions and parsed input in access", async () => {
		const response = await handle(
			ownerRequest("ada", "/ordinary-write", { name: "ordinary" }),
		);
		expect(response?.status).toBe(200);
		expect(await response!.json()).toEqual({
			outside: {
				inTransaction: false,
				settings: { isolation: "read committed", readOnly: "off" },
			},
			inside: { isolation: "read committed", readOnly: "off" },
		});
		expect(
			await setup.app.collections.query_counters.count({
				where: { name: "ordinary" },
			}),
		).toBe(1);

		const denied = await handle(
			ownerRequest("ada", "/ordinary-write", { name: "" }),
		);
		expect(denied?.status).toBe(403);
	});
});
