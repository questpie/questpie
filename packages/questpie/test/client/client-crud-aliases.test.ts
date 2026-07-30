import { beforeEach, describe, expect, it } from "bun:test";

import { createClient } from "../../src/client/index.js";

type CapturedCall = {
	url: URL;
	method: string;
	body?: string;
};

function toUrl(input: RequestInfo | URL): URL {
	if (typeof input === "string") return new URL(input);
	if (input instanceof URL) return input;
	return new URL(input.url);
}

function parseJsonBody(call: CapturedCall | undefined): unknown {
	const wire = JSON.parse(call?.body ?? "");
	return wire && typeof wire === "object" && "json" in wire ? wire.json : wire;
}

describe("client by-id aliases (canonical CRUD vocabulary)", () => {
	let calls: CapturedCall[];
	let client: ReturnType<typeof createClient<any>>;

	beforeEach(() => {
		calls = [];

		client = createClient<any>({
			baseURL: "http://localhost:3000",
			basePath: "/",
			fetch: async (input, init) => {
				calls.push({
					url: toUrl(input),
					method: (init?.method ?? "GET").toUpperCase(),
					body: typeof init?.body === "string" ? init.body : undefined,
				});

				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
	});

	it("updateById hits the same endpoint as update", async () => {
		await client.collections.posts.updateById({
			id: "post-1",
			data: { title: "Canonical" },
		});
		await client.collections.posts.update({
			id: "post-1",
			data: { title: "Alias" },
		});

		expect(calls[0]?.url.pathname).toBe("/posts/post-1");
		expect(calls[0]?.method).toBe("PATCH");
		expect(calls[1]?.url.pathname).toBe("/posts/post-1");
		expect(calls[1]?.method).toBe("PATCH");
	});

	it("deleteById hits the same endpoint as delete", async () => {
		await client.collections.posts.deleteById({ id: "post-1" });
		await client.collections.posts.delete({ id: "post-1" });

		expect(calls[0]?.url.pathname).toBe("/posts/post-1");
		expect(calls[0]?.method).toBe("DELETE");
		expect(calls[1]?.url.pathname).toBe("/posts/post-1");
		expect(calls[1]?.method).toBe("DELETE");
	});

	it("restoreById hits the same endpoint as restore", async () => {
		await client.collections.posts.restoreById({ id: "post-1" });
		await client.collections.posts.restore({ id: "post-1" });

		expect(calls[0]?.url.pathname).toBe("/posts/post-1/restore");
		expect(calls[0]?.method).toBe("POST");
		expect(calls[1]?.url.pathname).toBe("/posts/post-1/restore");
		expect(calls[1]?.method).toBe("POST");
	});

	it("purgeById uses the dedicated irreversible endpoint", async () => {
		await client.collections.posts.purgeById({ id: "post-1" });
		await client.collections.posts.purgeById({
			id: "post-2",
			expectedVersion: 4,
		});

		expect(calls).toHaveLength(2);
		expect(calls[0]?.url.pathname).toBe("/posts/post-1/purge");
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.body).toBeUndefined();
		expect(calls[1]?.url.pathname).toBe("/posts/post-2/purge");
		expect(parseJsonBody(calls[1])).toEqual({ expectedVersion: 4 });
		expect(
			"purge" in (client.collections.posts as Record<string, unknown>),
		).toBe(false);
	});

	it("bulk methods keep their where-based endpoints", async () => {
		await client.collections.posts.updateMany({
			where: { status: "draft" },
			data: { status: "review" },
		});
		await client.collections.posts.deleteMany({
			where: { status: "archived" },
		});

		expect(calls[0]?.url.pathname).toBe("/posts");
		expect(calls[0]?.method).toBe("PATCH");
		expect(calls[1]?.url.pathname).toBe("/posts/delete-many");
		expect(calls[1]?.method).toBe("POST");
	});

	it("serializes optimistic-lock inputs on every mutation surface", async () => {
		await client.collections.posts.updateById({
			id: "post-1",
			expectedVersion: 1,
			data: { title: "Updated" },
		});
		await client.collections.posts.deleteById({
			id: "post-1",
			expectedVersion: 2,
		});
		await client.collections.posts.restoreById({
			id: "post-1",
			expectedVersion: 3,
		});
		await client.collections.posts.updateMany({
			where: { status: "draft" },
			expectedVersions: [{ id: "post-1", expectedVersion: 3 }],
			data: { status: "review" },
		});
		await client.collections.posts.updateBatch({
			updates: [
				{
					id: "post-1",
					expectedVersion: 4,
					data: { title: "Batch" },
				},
			],
		});
		await client.collections.posts.deleteMany({
			where: { status: "archived" },
			expectedVersions: [{ id: "post-1", expectedVersion: 5 }],
		});
		await client.collections.posts.revertToVersion({
			id: "post-1",
			version: 1,
			expectedVersion: 6,
		});

		expect(parseJsonBody(calls[0])).toEqual({
			data: { title: "Updated" },
			expectedVersion: 1,
		});
		expect(parseJsonBody(calls[1])).toEqual({ expectedVersion: 2 });
		expect(parseJsonBody(calls[2])).toEqual({ expectedVersion: 3 });
		expect(parseJsonBody(calls[3])).toMatchObject({
			expectedVersions: [{ id: "post-1", expectedVersion: 3 }],
		});
		expect(parseJsonBody(calls[4])).toMatchObject({
			updates: [{ id: "post-1", expectedVersion: 4 }],
		});
		expect(parseJsonBody(calls[5])).toMatchObject({
			expectedVersions: [{ id: "post-1", expectedVersion: 5 }],
		});
		expect(parseJsonBody(calls[6])).toMatchObject({
			version: 1,
			expectedVersion: 6,
		});
	});
});
