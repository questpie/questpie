import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { createClient } from "../../src/client/index.js";
import { collection, route, withTransaction } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import {
	createAdapterContext,
	refreshAdapterContext,
	resolveLocale,
} from "../../src/server/adapters/utils/context.js";
import { rowsOf } from "../../src/server/db/driver-result.js";
import { prepareJsonRoute } from "../../src/server/routes/execute.js";
import { prepareRouteQueryTopic } from "../../src/server/routes/live.js";
import {
	parseCompatibleTypedEventWire,
	serializeCompatibleTypedEventWire,
} from "../../src/shared/typed-wire.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

const waitFor = async (check: () => boolean) => {
	const deadline = Date.now() + 3000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("LIVE condition timed out");
		await Bun.sleep(5);
	}
};

// These are actual query transactions + durable outbox/poll/SSE transport.
// Commit-between-reads and revocation during a SQL snapshot need the PG gate.
describe("explicit route LIVE", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let handle: ReturnType<typeof createFetchHandler>;
	let authenticated = true;
	let transforms = 0;
	let computes = 0;
	let droppedWakes = 0;
	let membershipId: string;
	const stop: Array<() => Promise<void>> = [];
	const facts: Array<{ path: string; isolation: string }> = [];
	const tasks = collection("live_tasks")
		.fields(({ f }) => ({
			tenant: f.text().required(),
			title: f.text().required(),
		}))
		.access({ read: true, create: true, update: true });
	const memberships = collection("live_memberships")
		.fields(({ f }) => ({
			userId: f.text().required(),
			allowed: f.boolean().required(),
		}))
		.access({ read: true, create: true, update: true });
	const hidden = collection("uncaptured")
		.fields(({ f }) => ({ name: f.text() }))
		.options({ realtime: { changeCapture: false } });
	const input = z.object({
		tenant: z.string().transform((value) => {
			transforms++;
			return value.trim();
		}),
		at: z.date(),
	});
	const read = route()
		.post()
		.schema(input)
		.outputSchema(
			z.object({
				titles: z.array(z.string()),
				at: z.date(),
				method: z.string(),
				path: z.string(),
				factIsolation: z.string(),
			}),
		)
		.access(
			(ctx: any) =>
				ctx.canRead &&
				ctx.session?.user.id === "ada" &&
				ctx.input.tenant === ctx.params.company,
		)
		.query({
			live: {
				data: ({ tenant }) => ({ live_tasks: { tenant } }),
				maxAgeMs: 1000,
			},
		})
		.handler(async (ctx: any) => {
			computes++;
			const rows = await ctx.collections.live_tasks.find({
				where: { tenant: ctx.input.tenant },
			});
			return {
				titles: rows.docs.map((row: any) => row.title),
				at: ctx.input.at,
				method: ctx.request.method,
				path: new URL(ctx.request.url).pathname,
				factIsolation: ctx.factIsolation,
			};
		});
	const session = () =>
		authenticated
			? { user: { id: "ada" }, session: { id: "session-ada" } }
			: null;
	const config = { basePath: "/api", getSession: async () => session() };
	beforeAll(async () => {
		setup = await buildMockApp(
			{
				collections: {
					live_tasks: tasks,
					live_memberships: memberships,
					uncaptured: hidden,
				},
				routes: {
					"report/[company]:POST": read,
					"files/[...company]:POST": read,
					"report/[company]:GET": route()
						.get()
						.schema(z.object({}))
						.handler(() => ({})),
				},
				config: {
					app: {
						context: async ({ collections, db, request }: any) => {
							const [settings] = rowsOf<{ isolation: string }>(
								await db.execute(
									sql`select current_setting('transaction_isolation') as isolation`,
								),
							);
							facts.push({
								path: new URL(request.url).pathname,
								isolation: settings!.isolation,
							});
							const membership = await collections.live_memberships.findOne({
								where: { userId: "ada" },
							});
							return {
								canRead: membership?.allowed === true,
								factIsolation: settings!.isolation,
							};
						},
					},
				},
			},
			{
				realtime: {
					pollIntervalMs: 15,
					changeBroker: {
						start: async () => {},
						publish: async () => {
							droppedWakes++;
						},
						stop: async () => {},
					},
					retentionDays: 0,
					authority: ({ session }) => ({
						live_memberships: { userId: String(session?.user.id) },
					}),
				},
			},
		);
		await runTestDbMigrations(setup.app);
		membershipId = (
			await setup.app.collections.live_memberships.create({
				userId: "ada",
				allowed: true,
			})
		).id;
		handle = createFetchHandler(setup.app, config);
	}, 60000);
	afterAll(async () => {
		for (const close of stop) await close();
		await setup?.cleanup();
	});
	const topic = (id: string, tenant = "tenant-a") => ({
		id,
		resourceType: "route" as const,
		resource: "report/[company]",
		method: "POST" as const,
		operation: "query" as const,
		input: { tenant: ` ${tenant} `, at: new Date("2026-10-22T12:00:00Z") },
		params: { company: tenant },
	});
	async function open(topics: unknown[]) {
		const abort = new AbortController();
		const response = await handle(
			new Request("http://localhost/api/realtime", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ topics }),
				signal: abort.signal,
			}),
		);
		expect(response.status).toBe(200);
		const events: Array<{ event: string; data: any }> = [];
		const reader = response.body!.getReader();
		let text = "";
		const draining = (async () => {
			while (true) {
				const result = await reader.read();
				if (result.done) return;
				text += new TextDecoder().decode(result.value);
				let end: number;
				while ((end = text.indexOf("\n\n")) >= 0) {
					const frame = text.slice(0, end);
					text = text.slice(end + 2);
					const event = frame
						.split("\n")
						.find((line) => line.startsWith("event: "))
						?.slice(7);
					const data = frame
						.split("\n")
						.find((line) => line.startsWith("data: "))
						?.slice(6);
					if (event && data)
						events.push({ event, data: parseCompatibleTypedEventWire(data) });
				}
			}
		})();
		stop.push(async () => {
			abort.abort();
			await reader.cancel().catch(() => {});
			await draining.catch(() => {});
		});
		return events;
	}

	it.each([
		["report", "[company]", "a b"],
		["files", "[...company]", "docs/intro"],
		["report", "[company]", "%2F"],
		["report", "[company]", "café"],
	])(
		"agrees on HTTP and LIVE params for %s/%s = %s",
		async (name, parameter, value) => {
			const client = createClient<any>({
				baseURL: "http://localhost",
				basePath: "/api",
				fetch: async (url, init) => (await handle(new Request(url, init)))!,
			});
			const abort = new AbortController();
			try {
				await setup.app.collections.live_tasks.create({
					tenant: value,
					title: `visible-${value}`,
				});
				const input = { tenant: value, at: new Date("2026-10-22T12:00:00Z") };
				const options = { params: { company: value }, signal: abort.signal };
				const call = client.routes[name][parameter].post;
				const http = await call(input, options);
				const iterator = call.watch(input, options)[Symbol.asyncIterator]();
				expect((await iterator.next()).value).toEqual(http);
				expect(http.titles).toEqual([`visible-${value}`]);
			} finally {
				abort.abort();
				client.realtime.destroy();
			}
		},
	);

	it("admits large route inputs with bounded IDs and distinct typed snapshots", async () => {
		const requests: Array<{
			topics?: Array<{ id: string }>;
			topology?: { subscriptions: Array<{ id: string }> };
		}> = [];
		const client = createClient<any>({
			baseURL: "http://localhost",
			basePath: "/api",
			fetch: async (url, init) => {
				if (String(url).endsWith("/realtime"))
					requests.push(JSON.parse(String(init?.body)));
				return (await handle(new Request(url, init)))!;
			},
		});
		const abort = new AbortController();
		try {
			const call = client.routes.report["[company]"].post;
			const input = {
				tenant: "large-input-".repeat(100),
				at: new Date("2026-10-22T12:00:00Z"),
			};
			const options = {
				params: { company: input.tenant },
				signal: abort.signal,
			};
			const other = { ...input, at: new Date(input.at.getTime() + 1) };
			const watches = [input, { ...input }, other].map((value) =>
				call.watch(value, options)[Symbol.asyncIterator](),
			);
			const snapshots = await Promise.race([
				Promise.all(watches.map(async (watch) => (await watch.next()).value)),
				Bun.sleep(3000).then(() => {
					throw new Error("Large route input was not admitted");
				}),
			]);
			expect(snapshots.map((value) => value.at)).toEqual([
				input.at,
				input.at,
				other.at,
			]);
			expect(snapshots[0].at).toBeInstanceOf(Date);
			const ids = new Set(
				requests.flatMap((request) =>
					(request.topics ?? request.topology?.subscriptions ?? []).map(
						({ id }) => id,
					),
				),
			);
			expect(ids.size).toBe(2);
			for (const id of ids) expect(id.length).toBeLessThanOrEqual(512);
		} finally {
			abort.abort();
			client.realtime.destroy();
		}
	});

	it("rejects malformed percent encoding before route access or execution", async () => {
		const before = computes;
		const response = await handle(
			new Request("http://localhost/api/report/%E0%A4%A", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		);
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("BAD_REQUEST");
		expect(computes).toBe(before);
	});

	it.each(["50%off", "a%20b", "a b", "a/b?#"])(
		"preserves the literal collection id %s through HTTP reads and writes",
		async (id) => {
			const row = await setup.app.collections.live_tasks.create({
				tenant: "encoded-ids",
				title: id,
			});
			await setup.app.db.execute(
				sql`update live_tasks set id = ${id} where id = ${row.id}`,
			);
			const client = createClient<any>({
				baseURL: "http://localhost",
				basePath: "/api",
				fetch: async (url, init) => (await handle(new Request(url, init)))!,
			});
			try {
				expect(
					await client.collections.live_tasks.findOne({ where: { id } }),
				).toMatchObject({ id, title: id });
				expect(
					await client.collections.live_tasks.updateById({
						id,
						data: { title: `updated-${id}` },
					}),
				).toMatchObject({ id, title: `updated-${id}` });
			} finally {
				client.realtime.destroy();
			}
		},
	);

	it("uses parsed dependencies once, coherent facts, the target request and typed dates", async () => {
		const before = transforms;
		const events = await open([
			serializeCompatibleTypedEventWire(topic("typed")),
		]);
		await waitFor(() => events.some((event) => event.event === "snapshot"));
		const snapshot = events.find((event) => event.event === "snapshot")!.data;
		expect(snapshot.data).toEqual({
			titles: [],
			at: new Date("2026-10-22T12:00:00Z"),
			method: "POST",
			path: "/api/report/tenant-a",
			factIsolation: "repeatable read",
		});
		expect(snapshot.upToDate).toMatch(/^\d+$/);
		expect(transforms - before).toBe(1);
		expect(
			facts
				.filter((fact) => fact.path === "/api/report/tenant-a")
				.every((fact) => fact.isolation === "repeatable read"),
		).toBe(true);
	});

	it("polls the durable outbox after dropped broker wakes; empty ranges wake and other tenants stay quiet", async () => {
		const events = await open([
			serializeCompatibleTypedEventWire(topic("range", "tenant-empty")),
		]);
		await waitFor(() => events.some((event) => event.event === "snapshot"));
		const before = computes;
		await setup.app.collections.live_tasks.create({
			tenant: "tenant-other",
			title: "private",
		});
		await Bun.sleep(80);
		expect(computes).toBe(before);
		await setup.app.collections.live_tasks.create({
			tenant: "tenant-empty",
			title: "first",
		});
		await waitFor(() =>
			events.some((event) => event.data.data?.titles.includes("first")),
		);
		expect(droppedWakes).toBeGreaterThan(0);
	});

	it("keeps rollback quiet", async () => {
		const events = await open([
			serializeCompatibleTypedEventWire(topic("rollback", "tenant-rollback")),
		]);
		await waitFor(() => events.some((event) => event.event === "snapshot"));
		const before = computes;
		await expect(
			withTransaction(setup.app.db, async (tx) => {
				await setup.app.collections.live_tasks.create(
					{ tenant: "tenant-rollback", title: "uncommitted" },
					{ db: tx },
				);
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		await Bun.sleep(80);
		expect(computes).toBe(before);
		expect(events.filter((event) => event.event === "snapshot")).toHaveLength(
			1,
		);
	});

	it("reconnects with fresh authorization even when sinceSeq is current; siblings continue", async () => {
		const events = await open([
			serializeCompatibleTypedEventWire(topic("revoked")),
			{
				id: "sibling",
				resourceType: "collection",
				resource: "live_tasks",
				where: { tenant: "sibling" },
			},
		]);
		await waitFor(
			() => events.filter((event) => event.event === "snapshot").length === 2,
		);
		const seq = events.find((event) => event.data.topicId === "revoked")!.data
			.seq;
		await setup.app.collections.live_memberships.updateById({
			id: membershipId,
			data: { allowed: false },
		});
		await waitFor(() =>
			events.some(
				(event) => event.event === "error" && event.data.topicId === "revoked",
			),
		);
		expect(
			events.find(
				(event) => event.event === "error" && event.data.topicId === "revoked",
			)!.data.details.reason,
		).toBe("access");
		await setup.app.collections.live_tasks.create({
			tenant: "sibling",
			title: "healthy",
		});
		await waitFor(() =>
			events.some(
				(event) =>
					event.data.topicId === "sibling" &&
					event.data.data?.docs.some((doc: any) => doc.title === "healthy"),
			),
		);
		const reconnect = await open([
			serializeCompatibleTypedEventWire({
				...topic("reconnect"),
				sinceSeq: seq,
			}),
		]);
		await waitFor(() => reconnect.some((event) => event.event === "error"));
		expect(reconnect.some((event) => event.event === "snapshot")).toBe(false);
		await setup.app.collections.live_memberships.updateById({
			id: membershipId,
			data: { allowed: true },
		});
	});

	it("rejects client dependencies, delta, wrong methods and missing params", async () => {
		const context = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/realtime"),
			config,
		);
		for (const bad of [
			{ ...topic("bad"), dependencies: [] },
			{ ...topic("bad"), mode: "delta" },
			{ ...topic("bad"), method: "GET" },
			{ ...topic("bad"), params: {} },
			{ ...topic("bad"), params: { company: "" } },
			{ ...topic("bad"), params: { company: "." } },
			{ ...topic("bad"), params: { company: ".." } },
		]) {
			expect(() =>
				prepareRouteQueryTopic(setup.app, bad as any, context.appContext),
			).toThrow();
		}
	});

	it("resolves LIVE locale through the same Accept-Language header as HTTP", async () => {
		const context = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/realtime"),
			config,
		);
		const prepared = prepareRouteQueryTopic(
			setup.app,
			{ ...topic("locale"), locale: "sk, en;q=0.8" },
			context.appContext,
		);
		expect(prepared.request.headers.get("accept-language")).toBe(
			"sk, en;q=0.8",
		);
		expect(new URL(prepared.request.url).searchParams.has("locale")).toBe(
			false,
		);
		const target = await createAdapterContext(
			setup.app,
			prepared.request,
			config,
		);
		expect(await resolveLocale(setup.app, prepared.request, config)).toBe("sk");
		const http = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/report/tenant-a", {
				method: "POST",
				headers: { "accept-language": "sk, en;q=0.8" },
			}),
			config,
		);
		expect(target.appContext.locale).toBe(http.appContext.locale);
	});

	it("defers refreshed database facts to the transaction and rejects query writes", async () => {
		const context = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/realtime"),
			config,
		);
		const before = facts.length;
		const fresh = await refreshAdapterContext(context, {
			deferContextExtensions: true,
		});
		expect(facts).toHaveLength(before);
		const write = route()
			.post()
			.schema(z.object({}))
			.outputSchema(z.object({}))
			.access(true)
			.query()
			.handler(async ({ db }: any) => {
				await db.execute(sql`update live_memberships set allowed = false`);
				return {};
			});
		const failure = await prepareJsonRoute(setup.app, write, {})
			.snapshot(fresh.appContext)
			.catch((error) => error);
		expect(failure?.cause?.code).toBe("25006");
	});
	it("captures the watermark and bounds statements in one SQL before context facts", async () => {
		const context = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/realtime"),
			config,
		);
		const fresh = await refreshAdapterContext(context, {
			deferContextExtensions: true,
		});
		const statements: string[] = [];
		const original = setup.app.db.transaction.bind(setup.app.db);
		const transaction = spyOn(setup.app.db, "transaction").mockImplementation(
			(run: any, options: any) =>
				original(async (tx: any) => {
					const prepare = tx.session.prepareQuery;
					tx.session.prepareQuery = function (...args: any[]) {
						statements.push(args[0].sql);
						return prepare.apply(this, args);
					};
					return run(tx);
				}, options),
		);
		try {
			const probe = route()
				.post()
				.schema(z.object({}))
				.outputSchema(z.object({}))
				.access(true)
				.query()
				.handler(() => ({}));
			await prepareJsonRoute(setup.app, probe, {}).snapshot(fresh.appContext);
			const queries = statements;
			expect(queries).toHaveLength(3);
			expect(queries[0]).toContain("pg_snapshot_xmin(pg_current_snapshot())");
			expect(queries[0]).toContain("statement_timeout");
			expect(queries[1]).toContain("transaction_isolation");
			expect(queries[2]).toContain('"live_memberships"');
		} finally {
			transaction.mockRestore();
		}
	});

	for (const [configured, expected] of [
		["0", "30s"],
		["5000", "5s"],
		["45000", "30s"],
	] as const) {
		it(`caps LIVE statements without raising the configured ${configured}ms timeout`, async () => {
			await setup.app.db.execute(
				sql`select set_config('statement_timeout', ${configured}, false)`,
			);
			try {
				const probe = route()
					.post()
					.schema(z.object({}))
					.outputSchema(
						z.object({
							timeout: z.string(),
							isolation: z.string(),
							readOnly: z.string(),
						}),
					)
					.access(true)
					.query()
					.handler(async ({ db }) => {
						const [settings] = rowsOf<{
							timeout: string;
							isolation: string;
							readOnly: string;
						}>(
							await db.execute(
								sql`select current_setting('statement_timeout') as timeout, current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as "readOnly"`,
							),
						);
						return settings!;
					});
				const result = await prepareJsonRoute(setup.app, probe, {}).snapshot({
					accessMode: "system",
				});
				expect(result.data).toEqual({
					timeout: expected,
					isolation: "repeatable read",
					readOnly: "on",
				});
				expect(result.upToDate).toMatch(/^\d+$/);
				const [outside] = rowsOf<{ timeout: string }>(
					await setup.app.db.execute(
						sql`select current_setting('statement_timeout') as timeout`,
					),
				);
				expect(outside!.timeout).toBe(
					configured === "0" ? "0" : `${Number(configured) / 1000}s`,
				);
			} finally {
				await setup.app.db.execute(sql`reset statement_timeout`);
			}
		});
	}

	it("cancels a closed evaluation before application access or reads begin", async () => {
		const controller = new AbortController();
		const context = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/realtime", {
				signal: controller.signal,
			}),
			config,
		);
		controller.abort(new Error("watch closed"));
		const prepared = prepareRouteQueryTopic(
			setup.app,
			topic("cancel"),
			context.appContext,
		);
		const before = computes;
		await expect(
			prepared.prepared.snapshot(context.appContext),
		).rejects.toThrow("watch closed");
		expect(computes).toBe(before);
	});

	it("cancels an in-flight handler and releases its transaction before the handler cooperates", async () => {
		const cancellation = new AbortController();
		const request = new Request("http://localhost/api/realtime", {
			signal: cancellation.signal,
		});
		const context = await createAdapterContext(setup.app, request, config);
		const fresh = await refreshAdapterContext(context, {
			deferContextExtensions: true,
		});
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let resume!: () => void;
		const blocked = new Promise<void>((resolve) => {
			resume = resolve;
		});
		const definition = route()
			.post()
			.schema(z.object({}))
			.outputSchema(z.object({}))
			.access(true)
			.query()
			.handler(async () => {
				entered();
				await blocked;
				return {};
			});
		const evaluation = prepareJsonRoute(
			setup.app,
			definition,
			{},
			request,
		).snapshot(fresh.appContext);
		try {
			await started;
			cancellation.abort(new Error("watch cancelled"));
			await expect(evaluation).rejects.toThrow("watch cancelled");
			const [state] = rowsOf<{ isolation: string }>(
				await setup.app.db.execute(
					sql`select current_setting('transaction_isolation') as isolation`,
				),
			);
			expect(state!.isolation).toBe("read committed");
		} finally {
			resume();
			await Bun.sleep(5);
		}
	});

	it("rejects uncaptured dependencies and shared-provider watches; authority wins duplicate dependencies", async () => {
		const context = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/realtime"),
			config,
		);
		const alternate = (
			definition: unknown,
			realtime = setup.app.config.realtime,
		) =>
			Object.assign(Object.create(setup.app), {
				config: {
					...setup.app.config,
					routes: { probe: definition },
					realtime,
				},
			});
		const probe = (data: any, authority?: any) =>
			route()
				.post()
				.schema(z.object({}))
				.outputSchema(z.object({}))
				.access(true)
				.query({ live: { data, authority } })
				.handler(() => ({}));
		const raw = {
			...topic("admission"),
			resource: "probe",
			params: {},
			input: {},
		};
		for (const data of [
			() => ({ uncaptured: true }),
			() => ({ missing: true }),
			() => ({ live_tasks: { tenant: NaN } }),
			() => ({ live_tasks: { unknown: "tenant-a" } }),
		]) {
			expect(() =>
				prepareRouteQueryTopic(alternate(probe(data)), raw, context.appContext),
			).toThrow();
		}
		const definition = probe(
			() => ({ live_tasks: { tenant: "tenant-a" } }),
			() => ({ live_tasks: { tenant: "tenant-a" } }),
		);
		const admitted = prepareRouteQueryTopic(
			alternate(definition),
			raw,
			context.appContext,
		);
		expect(
			admitted.dependencies.filter(
				(dependency) => dependency.topic.resource === "live_tasks",
			),
		).toEqual([
			{
				topic: {
					resourceType: "collection",
					resource: "live_tasks",
					where: { tenant: "tenant-a" },
				},
				authority: true,
			},
		]);
		expect(() =>
			prepareRouteQueryTopic(
				alternate(definition, {
					...setup.app.config.realtime,
					clientTransport: { channelDeliveryScope: "shared-provider" },
				}),
				raw,
				context.appContext,
			),
		).toThrow("SSE transport");
	});

	it("adds a route through shared topology control without parsing input twice", async () => {
		const events = await open([
			{
				id: "initial-row",
				resourceType: "collection",
				resource: "live_tasks",
				where: { tenant: "initial-row" },
			},
		]);
		await waitFor(() => events.some((event) => event.event === "session"));
		const session = events.find((event) => event.event === "session")!.data;
		const { id, ...routeTopic } = topic("incremental");
		const before = transforms;
		const response = await handle(
			new Request("http://localhost/api/realtime", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sessionId: session.sessionId,
					token: session.token,
					topology: {
						protocol: "questpie-realtime-topology",
						version: 2,
						revision: 1,
						subscriptions: [
							{
								kind: "query",
								id,
								topic: serializeCompatibleTypedEventWire(routeTopic),
							},
						],
					},
				}),
			}),
		);
		expect(response.status).toBe(202);
		await waitFor(() =>
			events.some(
				(event) => event.event === "snapshot" && event.data.topicId === id,
			),
		);
		expect(transforms - before).toBe(1);
		expect(
			events.find(
				(event) => event.event === "snapshot" && event.data.topicId === id,
			)!.data.data.at,
		).toBeInstanceOf(Date);
	});

	it("preserves verified workload identity in fresh context and query access", async () => {
		const actor = {
			kind: "agent" as const,
			subjectId: "worker",
			issuer: "https://issuer.example",
			credentialId: "verified-credential",
			scopes: ["tasks:read"],
			expiresAt: new Date(Date.now() + 60_000),
		};
		const context = await createAdapterContext(
			setup.app,
			new Request("http://localhost/api/realtime"),
			{ ...config, extendContext: () => ({ actor }) },
		);
		const fresh = await refreshAdapterContext(context, {
			deferContextExtensions: true,
		});
		const probe = route()
			.post()
			.schema(z.object({}))
			.outputSchema(z.object({ credentialId: z.string() }))
			.access((ctx: any) => ctx.actor?.credentialId === actor.credentialId)
			.query()
			.handler((ctx: any) => ({ credentialId: ctx.actor.credentialId }));
		expect(
			(await prepareJsonRoute(setup.app, probe, {}).snapshot(fresh.appContext))
				.data,
		).toEqual({ credentialId: actor.credentialId });
	});

	it("refreshes session identity on maximum age without a database event", async () => {
		const events = await open([
			serializeCompatibleTypedEventWire(topic("expiry")),
		]);
		await waitFor(() => events.some((event) => event.event === "snapshot"));
		authenticated = false;
		try {
			await waitFor(() =>
				events.some(
					(event) =>
						event.event === "error" && event.data.details.reason === "access",
				),
			);
			expect(events.filter((event) => event.event === "snapshot")).toHaveLength(
				1,
			);
		} finally {
			authenticated = true;
		}
	});
});
