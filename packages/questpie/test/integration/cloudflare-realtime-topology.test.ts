import { describe, expect, test } from "bun:test";

import { memory } from "files-sdk/memory";

import {
	cloudflareKVAdapter,
	cloudflareQueuesAdapter,
	cloudflareRealtimeAdapter,
	createCloudflareFetchHandler,
} from "../../src/exports/adapters/cloudflare.js";
import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

function createRelayNamespace() {
	const objectNames: string[] = [];
	return {
		objectNames,
		idFromName: (name: string) => ({ name }),
		get: (id: { name: string }) => ({
			fetch: async () => {
				objectNames.push(id.name);
				return new Response("", {
					headers: { "Content-Type": "application/x-ndjson" },
				});
			},
		}),
	};
}

describe("Cloudflare realtime topology", () => {
	test("requesting Worker owns snapshot queries and connects resource shards", async () => {
		const durableObjects = createRelayNamespace();
		const scheduled: Promise<unknown>[] = [];
		const realtimeAdapter = cloudflareRealtimeAdapter({
			namespace: durableObjects,
			waitUntil: (promise) => scheduled.push(promise),
		});
		let setup: Awaited<ReturnType<typeof buildMockApp>> | undefined;

		try {
			setup = await buildMockApp(
				{
					defaultAccess: true,
					collections: {
						posts: collection("posts")
							.fields(({ f }) => ({
								title: f.text().required(),
							}))
							.access({ read: true, create: true }),
					},
				},
				{
					storage: { adapter: memory() },
					queue: {
						adapter: cloudflareQueuesAdapter({
							queue: { send: async () => undefined },
						}),
					},
					kv: {
						adapter: cloudflareKVAdapter({
							namespace: {
								get: async () => null,
								put: async () => {},
								delete: async () => {},
								list: async () => ({ keys: [], list_complete: true }),
							},
						}),
					},
					realtime: { adapter: realtimeAdapter },
				},
			);
			await runTestDbMigrations(setup.app);
			await setup.app.collections.posts.create({ title: "From Worker DB" });
			await Promise.all(scheduled.splice(0));
			durableObjects.objectNames.length = 0;
			// The test DB is PGlite, but the handler's compatibility check only needs
			// the already-created Drizzle client to model a Worker-compatible binding.
			setup.app.config.db = { drizzle: setup.app.db };
			setup.app.config.queue!.adapter = cloudflareQueuesAdapter({
				queue: { send: async () => undefined },
			});
			setup.app.config.kv!.adapter = cloudflareKVAdapter({
				namespace: {
					get: async () => null,
					put: async () => {},
					delete: async () => {},
					list: async () => ({ keys: [], list_complete: true }),
				},
			});

			const response = await createCloudflareFetchHandler(setup.app)(
				new Request("https://example.com/realtime", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						topics: [
							{
								id: "posts-list",
								resourceType: "collection",
								resource: "posts",
							},
						],
					}),
				}),
			);
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

			try {
				expect(response.headers.get("Content-Type")).toContain(
					"text/event-stream",
				);
				expect(durableObjects.objectNames).toEqual([
					"questpie-realtime:collection:posts",
				]);

				reader = response.body!.getReader();
				const initial = await reader.read();
				const text = new TextDecoder().decode(initial.value);
				expect(text).toContain("event: snapshot");
				expect(text).toContain('"title":"From Worker DB"');
			} finally {
				if (reader) await reader.cancel();
				else await response.body?.cancel();
			}
		} finally {
			await setup?.cleanup();
		}
	});
});
