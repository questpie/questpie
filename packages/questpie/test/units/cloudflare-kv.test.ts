import { describe, expect, test } from "bun:test";

import {
	cloudflareKVAdapter,
	type CloudflareKVListResult,
	type CloudflareKVNamespace,
} from "../../src/exports/adapters/cloudflare-kv.js";

class FakeCloudflareKVNamespace implements CloudflareKVNamespace {
	readonly store = new Map<string, string>();
	readonly putCalls: Array<{
		key: string;
		value: string;
		options?: Parameters<CloudflareKVNamespace["put"]>[2];
	}> = [];

	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}

	async put(
		key: string,
		value: string,
		options?: Parameters<CloudflareKVNamespace["put"]>[2],
	): Promise<void> {
		this.putCalls.push({ key, value, options });
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	async list(options?: {
		prefix?: string;
		cursor?: string;
		limit?: number;
	}): Promise<CloudflareKVListResult> {
		const prefix = options?.prefix ?? "";
		const limit = options?.limit ?? 1000;
		const start = options?.cursor ? Number(options.cursor) : 0;
		const keys = [...this.store.keys()]
			.filter((key) => key.startsWith(prefix))
			.slice(start, start + limit);
		const next = start + limit;
		const matchingCount = [...this.store.keys()].filter((key) =>
			key.startsWith(prefix),
		).length;
		const listComplete = next >= matchingCount;

		return {
			keys: keys.map((name) => ({ name })),
			list_complete: listComplete,
			...(listComplete ? {} : { cursor: String(next) }),
		};
	}
}

describe("CloudflareKVAdapter", () => {
	test("sets, gets, checks, and deletes JSON values", async () => {
		const namespace = new FakeCloudflareKVNamespace();
		const adapter = cloudflareKVAdapter({ namespace });

		await adapter.set("user:1", { name: "Ada" });

		expect(await adapter.get<{ name: string }>("user:1")).toEqual({
			name: "Ada",
		});
		expect(await adapter.has("user:1")).toBe(true);

		await adapter.delete("user:1");

		expect(await adapter.get("user:1")).toBeNull();
		expect(await adapter.has("user:1")).toBe(false);
	});

	test("passes ttl as Cloudflare expirationTtl", async () => {
		const namespace = new FakeCloudflareKVNamespace();
		const adapter = cloudflareKVAdapter({ namespace });

		await adapter.set("cache", "value", 60);

		expect(namespace.putCalls.at(-1)).toMatchObject({
			key: "cache",
			value: '"value"',
			options: { expirationTtl: 60 },
		});
	});

	test("invalidates tagged keys", async () => {
		const namespace = new FakeCloudflareKVNamespace();
		const adapter = cloudflareKVAdapter({ namespace });

		await adapter.setWithTags("user:1", { name: "Ada" }, ["users", "active"]);
		await adapter.setWithTags("user:2", { name: "Linus" }, ["users"]);
		await adapter.setWithTags("post:1", { title: "Hello" }, ["posts"]);

		await adapter.invalidateByTag("users");

		expect(await adapter.get("user:1")).toBeNull();
		expect(await adapter.get("user:2")).toBeNull();
		expect(await adapter.get("post:1")).toEqual({ title: "Hello" });
	});

	test("removes deleted keys from tag indexes", async () => {
		const namespace = new FakeCloudflareKVNamespace();
		const adapter = cloudflareKVAdapter({ namespace });

		await adapter.setWithTags("user:1", { name: "Ada" }, ["users"]);
		await adapter.setWithTags("user:2", { name: "Linus" }, ["users"]);
		await adapter.delete("user:1");

		expect(namespace.store.get("__questpie_tag:users")).toBe('["user:2"]');
	});

	test("clears only keys with the configured prefix", async () => {
		const namespace = new FakeCloudflareKVNamespace();
		const adapter = cloudflareKVAdapter({
			namespace,
			keyPrefix: "app:",
			listLimit: 1,
		});

		await adapter.set("one", 1);
		await adapter.set("two", 2);
		await namespace.put("other", "3");

		await adapter.clear();

		expect(namespace.store.has("app:one")).toBe(false);
		expect(namespace.store.has("app:two")).toBe(false);
		expect(namespace.store.get("other")).toBe("3");
	});

	test("rejects values that JSON cannot represent", async () => {
		const namespace = new FakeCloudflareKVNamespace();
		const adapter = cloudflareKVAdapter({ namespace });

		await expect(adapter.set("fn", () => {})).rejects.toThrow(TypeError);
	});
});
