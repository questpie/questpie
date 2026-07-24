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

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url.pathname).toBe("/posts/post-1/purge");
		expect(calls[0]?.method).toBe("POST");
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
});
