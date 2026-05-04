import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, route } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import type { AdapterContext } from "../../src/server/adapters/types.js";
import { tryGetContext } from "../../src/server/config/context.js";
import type { SearchAdapter } from "../../src/server/modules/core/integrated/search/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

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
			expect((await fromResolver?.json()).locale).toBe("sk");

			const fromQuery = await handler(
				new Request("http://localhost/echo-options?locale=de", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			);
			expect((await fromQuery?.json()).locale).toBe("de");
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
				error: { name: "Error", message: "boom" },
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

			expect(response?.status).toBe(200);
			expect(await response?.json()).toEqual({
				success: true,
				collection: "posts",
			});
			expect(reindexedCollections).toEqual(["posts"]);
		});
	});

	describe("storage alias resolution", () => {
		const media = collection("media")
			.fields(({ f }) => ({
				alt: f.text(),
			}))
			.upload({ visibility: "public" });

		const documents = collection("documents")
			.fields(({ f }) => ({
				title: f.text().required(),
			}))
			.upload({ visibility: "public" });

		it("auto-resolves /storage/files alias when exactly one upload collection exists", async () => {
			const setup = await buildMockApp({ collections: { media } });

			try {
				const handler = createFetchHandler(setup.app);
				const response = await handler(
					new Request("http://localhost/storage/files/missing-file.png", {
						method: "GET",
					}),
				);

				expect(response?.status).toBe(404);
			} finally {
				await setup.cleanup();
			}
		});

		it("returns bad request for /storage/files alias when multiple upload collections exist", async () => {
			const setup = await buildMockApp({ collections: { media, documents } });

			try {
				const handler = createFetchHandler(setup.app);
				const response = await handler(
					new Request("http://localhost/storage/files/missing-file.png", {
						method: "GET",
					}),
				);

				expect(response?.status).toBe(400);
				const payload = await response?.json();
				expect((payload as any)?.error?.code).toBe("BAD_REQUEST");
				expect((payload as any)?.error?.message).toContain(
					"Multiple upload-enabled collections found",
				);
			} finally {
				await setup.cleanup();
			}
		});

		it("uses configured storage.collection for /storage/files alias", async () => {
			const setup = await buildMockApp({ collections: { media, documents } });

			try {
				const handler = createFetchHandler(setup.app, {
					storage: { collection: "documents" },
				});
				const response = await handler(
					new Request("http://localhost/storage/files/missing-file.png", {
						method: "GET",
					}),
				);

				expect(response?.status).toBe(404);
			} finally {
				await setup.cleanup();
			}
		});
	});
});
