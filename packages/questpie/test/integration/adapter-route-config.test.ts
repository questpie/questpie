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
				};
			});

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp({
				routes: { echoOptions },
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
					body: JSON.stringify({}),
				}),
				explicitContext,
			);

			expect(response?.status).toBe(200);
			const body = await response?.json();
			expect(body.accessMode).toBe("system");
			expect(body.locale).toBe("de");
			expect(body.sessionUserId).toBe("explicit_user");
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
