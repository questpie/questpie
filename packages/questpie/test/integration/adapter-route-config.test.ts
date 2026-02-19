import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import type { SearchAdapter } from "../../src/server/integrated/search/types.js";
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
		reindex: async (collection) => {
			reindexedCollections.push(collection);
		},
		clear: async () => {},
	};

	return { adapter, reindexedCollections };
}

describe("adapter route config", () => {
	describe("search reindex access", () => {
		const q = questpie({ name: "adapter-search-config-test" }).fields(
			defaultFields,
		);

		const posts = q
			.collection("posts")
			.fields((f) => ({
				title: f.text({ required: true }),
			}))
			.access({
				read: true,
				update: ({ session }) => (session?.user as any)?.role === "admin",
			});

		const module = q.collections({ posts });

		let setup: Awaited<ReturnType<typeof buildMockApp<typeof module>>>;
		let reindexedCollections: string[];

		beforeEach(async () => {
			const searchMock = createSearchAdapterMock();
			reindexedCollections = searchMock.reindexedCollections;
			setup = await buildMockApp(module, { search: searchMock.adapter });
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
					reindexAccess: ({ collection, session }) =>
						collection === "posts" && !!session,
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
		const q = questpie({ name: "adapter-storage-config-test" }).fields(
			defaultFields,
		);

		const media = q
			.collection("media")
			.fields((f) => ({
				alt: f.text(),
			}))
			.upload({ visibility: "public" });

		const documents = q
			.collection("documents")
			.fields((f) => ({
				title: f.text({ required: true }),
			}))
			.upload({ visibility: "public" });

		it("auto-resolves /storage/files alias when exactly one upload collection exists", async () => {
			const module = q.collections({ media });
			const setup = await buildMockApp(module);

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
			const module = q.collections({ media, documents });
			const setup = await buildMockApp(module);

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
			const module = q.collections({ media, documents });
			const setup = await buildMockApp(module);

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
