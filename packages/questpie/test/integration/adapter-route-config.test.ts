import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, global, route } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import type { AdapterContext } from "../../src/server/adapters/types.js";
import { tryGetContext } from "../../src/server/config/context.js";
import type { SearchAdapter } from "../../src/server/modules/core/integrated/search/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

function createSearchAdapterMock(): {
	adapter: SearchAdapter;
	reindexedCollections: string[];
} {
	const reindexedCollections: string[] = [];

	const adapter: SearchAdapter = {
		name: "mock-search",
		capabilities: {
			lexical: true,
			trigram: false,
			semantic: false,
			hybrid: false,
			facets: false,
		},
		initialize: async () => {},
		getMigrations: () => [],
		search: async () => ({
			results: [],
			total: 0,
			facets: [],
		}),
		index: async () => {},
		remove: async () => {},
		reindex: async (col) => {
			reindexedCollections.push(col);
		},
		clear: async () => {},
	};

	return { adapter, reindexedCollections };
}

describe("adapter route config", () => {
	describe("http adapter option matrix", () => {
		const echoOptions = route()
			.post()
			.schema(z.object({}))
			.outputSchema(
				z.object({
					accessMode: z.string().optional(),
					locale: z.string().optional(),
					localeFallback: z.boolean().optional(),
					stage: z.string().optional(),
					sessionUserId: z.string().nullable(),
					organizationId: z.string().nullable(),
					requestId: z.string().optional(),
					traceId: z.string().optional(),
				}),
			)
			.handler(async (ctx) => {
				const stored = tryGetContext();
				return {
					accessMode: stored?.accessMode,
					locale: ctx.locale,
					localeFallback: (ctx as any).localeFallback,
					stage: (ctx as any).stage,
					sessionUserId: (ctx.session as any)?.user?.id ?? null,
					organizationId: (ctx as any).organizationId ?? null,
					requestId: ctx.requestId as string | undefined,
					traceId: ctx.traceId as string | undefined,
				};
			});
		const crashOptions = route()
			.post()
			.schema(z.object({}))
			.handler(async () => {
				throw new Error("boom");
			});
		const logOptions = route()
			.post()
			.schema(z.object({}))
			.handler(async (ctx) => {
				(ctx.logger as any).info("handler observed", {
					event: "handler.observed",
				});
				return { ok: true };
			});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp({
				routes: { echoOptions, crashOptions, logOptions },
				locale: {
					locales: [{ code: "en" }, { code: "sk" }, { code: "de" }],
					defaultLocale: "en",
				},
			});
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("normalizes basePath and only handles requests under it", async () => {
			const handler = createFetchHandler(setup.app, { basePath: "api/" });

			const outside = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			);
			expect(outside).toBeNull();

			const inside = await handler(
				new Request("http://localhost/api/echo-options", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			);
			expect(inside?.status).toBe(200);
		});

		it("uses accessMode from adapter config in route ALS", async () => {
			const handler = createFetchHandler(setup.app, { accessMode: "system" });

			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			);

			expect(response?.status).toBe(200);
			const body = await response?.json();
			expect(body.accessMode).toBe("system");
		});

		it("uses getLocale unless query locale is provided", async () => {
			const handler = createFetchHandler(setup.app, {
				getLocale: () => "sk",
			});

			const fromResolver = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			);
			expect((await fromResolver?.json())?.locale).toBe("sk");

			const fromQuery = await handler(
				new Request("http://localhost/echo-options?locale=de", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			);
			expect((await fromQuery?.json())?.locale).toBe("de");
		});

		it("uses getSession result in handler context", async () => {
			const handler = createFetchHandler(setup.app, {
				getSession: async () => ({
					user: { id: "user_123" },
					session: { id: "session_123" },
				}),
			});

			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			);

			expect(response?.status).toBe(200);
			const body = await response?.json();
			expect(body.sessionUserId).toBe("user_123");
		});

		it("passes base context into extendContext and merges its return value", async () => {
			let capturedContext: unknown;
			const handler = createFetchHandler(setup.app, {
				accessMode: "system",
				getSession: async () => ({
					user: { id: "user_456" },
					session: { id: "session_456" },
				}),
				extendContext: async ({ context }) => {
					capturedContext = context;
					return { organizationId: "org_456" };
				},
			});

			const response = await handler(
				new Request(
					"http://localhost/echo-options?locale=sk&localeFallback=false&stage=review",
					{
						method: "POST",
						body: JSON.stringify({}),
					},
				),
			);

			expect(response?.status).toBe(200);
			const body = await response?.json();
			expect(body.organizationId).toBe("org_456");
			expect(body.locale).toBe("sk");
			expect(body.localeFallback).toBe(false);
			expect(body.stage).toBe("review");
			expect(capturedContext).toMatchObject({
				accessMode: "system",
				locale: "sk",
				localeFallback: false,
				stage: "review",
			});
			expect((capturedContext as any).session.user.id).toBe("user_456");
		});

		it("uses explicit AdapterContext without calling adapter resolvers", async () => {
			const session = {
				user: { id: "explicit_user" },
				session: { id: "explicit_session" },
			};
			const explicitContext: AdapterContext = {
				session,
				locale: "de",
				appContext: {
					session,
					locale: "de",
					accessMode: "system",
				},
			};
			const handler = createFetchHandler(setup.app, {
				getSession: async () => {
					throw new Error("getSession should not run");
				},
				getLocale: () => {
					throw new Error("getLocale should not run");
				},
			});

			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					headers: { "x-request-id": "req_explicit_context" },
					body: JSON.stringify({}),
				}),
				explicitContext,
			);

			expect(response?.status).toBe(200);
			const body = await response?.json();
			expect(body.accessMode).toBe("system");
			expect(body.locale).toBe("de");
			expect(body.sessionUserId).toBe("explicit_user");
			expect(body.requestId).toBe("req_explicit_context");
		});

		it("propagates request identifiers into context, response headers, and logs", async () => {
			const handler = createFetchHandler(setup.app);
			const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-request-id": "req_test_123",
						traceparent: `00-${traceId}-bbbbbbbbbbbbbbbb-01`,
					},
					body: JSON.stringify({}),
				}),
			);

			expect(response?.status).toBe(200);
			expect(response?.headers.get("x-request-id")).toBe("req_test_123");
			expect(response?.headers.get("x-trace-id")).toBe(traceId);

			const body = await response?.json();
			expect(body.requestId).toBe("req_test_123");
			expect(body.traceId).toBe(traceId);

			const log = setup.app.mocks.logger
				.getLogsContaining("HTTP request completed")
				.at(-1);
			expect(log?.level).toBe("info");
			expect(log?.args[0]).toMatchObject({
				event: "http.request",
				requestId: "req_test_123",
				traceId,
				method: "POST",
				path: "/echo-options",
				route: "echo-options",
				status: 200,
			});
			expect(typeof log?.args[0].durationMs).toBe("number");
		});

		it("replaces malformed and oversized inbound correlation identifiers", async () => {
			const hostileRequestId = `../../logs?token=${"r".repeat(512)}`;
			const hostileTraceId = `not-a-trace/${"t".repeat(512)}`;
			const handler = createFetchHandler(setup.app);

			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-correlation-id": hostileRequestId,
						"x-trace-id": hostileTraceId,
					},
					body: JSON.stringify({}),
				}),
			);

			const body = await response?.json();
			const observed = JSON.stringify({
				body,
				requestId: response?.headers.get("x-request-id"),
				traceId: response?.headers.get("x-trace-id"),
				log: setup.app.mocks.logger
					.getLogsContaining("HTTP request completed")
					.at(-1),
			});
			expect(body.requestId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
			expect(body.traceId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
			expect(observed).not.toContain(hostileRequestId);
			expect(observed).not.toContain(hostileTraceId);
		});

		it("rejects structurally invalid W3C traceparent values", async () => {
			let carrier: Record<string, string | undefined> | undefined;
			const span = setup.app.observability.span.bind(setup.app.observability);
			setup.app.observability.span = ((name: string, fn: any, options: any) => {
				carrier = options?.carrier;
				return span(name, fn, options);
			}) as typeof setup.app.observability.span;
			const handler = createFetchHandler(setup.app);
			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						traceparent:
							"00-00000000000000000000000000000000-0000000000000000-01",
					},
					body: JSON.stringify({}),
				}),
			);

			const body = await response?.json();
			expect(body.traceId).not.toBe("00000000000000000000000000000000");
			expect(body.traceId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
			expect(carrier?.traceparent).toBeUndefined();
		});

		it("can disable request logging while preserving request headers", async () => {
			setup.app.mocks.logger.clearLogs();
			const handler = createFetchHandler(setup.app, { requestLogging: false });

			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({}),
				}),
			);

			expect(response?.status).toBe(200);
			expect(response?.headers.get("x-request-id")).toBeTruthy();
			expect(
				setup.app.mocks.logger.getLogsContaining("HTTP request completed"),
			).toEqual([]);
		});

		it("logs unhandled route failures with error metadata", async () => {
			setup.app.mocks.logger.clearLogs();
			const handler = createFetchHandler(setup.app);

			const response = await handler(
				new Request("http://localhost/crash-options", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({}),
				}),
			);

			expect(response?.status).toBe(500);
			const log = setup.app.mocks.logger
				.getLogsContaining("HTTP request completed")
				.at(-1);
			expect(log?.level).toBe("error");
			expect(log?.args[0]).toMatchObject({
				event: "http.request",
				method: "POST",
				path: "/crash-options",
				route: "crash-options",
				status: 500,
				error: { name: "Error", message: "[Redacted]" },
			});
		});

		it("adds request identifiers to application logs inside the request scope", async () => {
			setup.app.mocks.logger.clearLogs();
			const handler = createFetchHandler(setup.app, { requestLogging: false });

			const response = await handler(
				new Request("http://localhost/log-options", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-request-id": "req_handler_log",
					},
					body: JSON.stringify({}),
				}),
			);

			expect(response?.status).toBe(200);
			const log = setup.app.mocks.logger
				.getLogsContaining("handler observed")
				.at(-1);
			expect(log?.args[0]).toMatchObject({
				event: "handler.observed",
				requestId: "req_handler_log",
				traceId: "req_handler_log",
			});
		});

		it("uses logger request defaults unless the adapter overrides them", async () => {
			const localSetup = await buildMockApp(
				{
					routes: { echoOptions, crashOptions },
					locale: {
						locales: [{ code: "en" }],
						defaultLocale: "en",
					},
				},
				{
					logger: {
						requests: { logSuccessfulRequests: false },
					} as any,
				},
			);

			try {
				const handler = createFetchHandler(localSetup.app);
				const successful = await handler(
					new Request("http://localhost/echo-options", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({}),
					}),
				);
				expect(successful?.status).toBe(200);
				expect(
					localSetup.app.mocks.logger.getLogsContaining(
						"HTTP request completed",
					),
				).toEqual([]);

				const failed = await handler(
					new Request("http://localhost/crash-options", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({}),
					}),
				);
				expect(failed?.status).toBe(500);
				expect(
					localSetup.app.mocks.logger.getLogsContaining(
						"HTTP request completed",
					)[0]?.level,
				).toBe("error");

				localSetup.app.mocks.logger.clearLogs();
				const verboseHandler = createFetchHandler(localSetup.app, {
					requestLogging: true,
				});
				await verboseHandler(
					new Request("http://localhost/echo-options", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({}),
					}),
				);
				expect(
					localSetup.app.mocks.logger.getLogsContaining(
						"HTTP request completed",
					)[0]?.level,
				).toBe("info");
			} finally {
				await localSetup.cleanup();
			}
		});

		it("can ignore successful request logs for noisy paths", async () => {
			setup.app.mocks.logger.clearLogs();
			const handler = createFetchHandler(setup.app, {
				requestLogging: { ignorePaths: ["/echo-options"] },
			});

			const response = await handler(
				new Request("http://localhost/echo-options", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({}),
				}),
			);

			expect(response?.status).toBe(200);
			expect(
				setup.app.mocks.logger.getLogsContaining("HTTP request completed"),
			).toEqual([]);
		});
	});

	describe("read projection over http", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
			body: f.textarea().required(),
		}));
		const settings = global("settings").fields(({ f }) => ({
			siteName: f.text().required(),
			tagline: f.text().required(),
		}));

		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let created: { id: string };

		beforeEach(async () => {
			setup = await buildMockApp({
				collections: { posts },
				globals: { settings },
				defaultAccess: { read: true, create: true, update: true },
			});
			await runTestDbMigrations(setup.app);
			const handler = createFetchHandler(setup.app);
			created = (await (
				await handler(
					new Request("http://localhost/posts", {
						method: "POST",
						body: JSON.stringify({ title: "Narrow", body: "Wide" }),
					}),
				)
			)?.json()) as { id: string };
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("narrows a collection read to the requested columns", async () => {
			const handler = createFetchHandler(setup.app);

			const included = await handler(
				new Request("http://localhost/posts?columns[title]=true"),
			);
			expect(included?.status).toBe(200);
			const listed = (await included?.json())?.docs?.[0];
			expect(listed).toMatchObject({ id: created.id, title: "Narrow" });
			expect(listed).not.toHaveProperty("body");

			// Omission mode: `false` has to survive the query string as a boolean,
			// not as the truthy string "false".
			const omitted = await handler(
				new Request("http://localhost/posts?columns[body]=false"),
			);
			const remaining = (await omitted?.json())?.docs?.[0];
			expect(remaining).toMatchObject({ title: "Narrow" });
			expect(remaining).not.toHaveProperty("body");

			const one = await handler(
				new Request(`http://localhost/posts/${created.id}?columns[title]=true`),
			);
			expect(one?.status).toBe(200);
			const record = await one?.json();
			expect(record).toMatchObject({ id: created.id, title: "Narrow" });
			expect(record).not.toHaveProperty("body");
		});

		it("narrows a global read to the requested columns", async () => {
			const handler = createFetchHandler(setup.app);
			await handler(
				new Request("http://localhost/globals/settings", {
					method: "PATCH",
					body: JSON.stringify({ siteName: "QUESTPIE", tagline: "Wide" }),
				}),
			);

			const response = await handler(
				new Request(
					"http://localhost/globals/settings?columns[siteName]=true&columns[tagline]=false",
				),
			);
			expect(response?.status).toBe(200);
			const record = await response?.json();
			expect(record).toMatchObject({ siteName: "QUESTPIE" });
			expect(record).not.toHaveProperty("tagline");
		});
	});

	describe("search reindex access", () => {
		const posts = collection("posts")
			.fields(({ f }) => ({
				title: f.text().required(),
			}))
			.access({
				read: true,
				update: ({ session }) => (session?.user as any)?.role === "admin",
			});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let reindexedCollections: string[];

		beforeEach(async () => {
			const searchMock = createSearchAdapterMock();
			reindexedCollections = searchMock.reindexedCollections;
			setup = await buildMockApp(
				{ collections: { posts } },
				{ search: searchMock.adapter },
			);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("derives reindex access from collection update access by default", async () => {
			const handler = createFetchHandler(setup.app, {
				getSession: async () => ({
					user: { id: "user-1", role: "editor" },
					session: { id: "session-1" },
				}),
			});

			const response = await handler(
				new Request("http://localhost/search/reindex/posts", {
					method: "POST",
				}),
			);

			expect(response?.status).toBe(403);
			expect(reindexedCollections).toEqual([]);
		});

		it("uses custom reindexAccess override from adapter config", async () => {
			const handler = createFetchHandler(setup.app, {
				getSession: async () => ({
					user: { id: "user-1", role: "editor" },
					session: { id: "session-1" },
				}),
				search: {
					reindexAccess: ({ collection: col, session }) =>
						col === "posts" && !!session,
				},
			});

			const response = await handler(
				new Request("http://localhost/search/reindex/posts", {
					method: "POST",
				}),
			);

			// Access granted by the custom policy → reindex runs. The route now
			// reindexes at the app layer (iterate records + index) rather than
			// delegating to the adapter's `reindex()` (which has no CRUD access),
			// so the response carries an `indexed` count and the mock adapter's
			// `reindex` is no longer invoked. The point of THIS test — the
			// `reindexAccess` override granting access — still holds.
			expect(response?.status).toBe(200);
			expect(await response?.json()).toMatchObject({
				success: true,
				collection: "posts",
			});
			void reindexedCollections;
		});
	});
});
