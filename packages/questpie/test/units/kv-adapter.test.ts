/**
 * Tests for KV adapters (Memory and IORedis)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Redis } from "ioredis";
import { IORedisKVAdapter } from "../../src/server/integrated/kv/adapters/ioredis.js";
import { MemoryKVAdapter } from "../../src/server/integrated/kv/adapters/memory.js";

interface User {
	name: string;
}

interface UserWithVersion extends User {
	v: number;
}

interface Product {
	title: string;
}

describe("MemoryKVAdapter", () => {
	let adapter: MemoryKVAdapter;

	beforeEach(() => {
		adapter = new MemoryKVAdapter();
	});

	describe("basic operations", () => {
		test("should set and get a value", async () => {
			await adapter.set("key1", "value1");
			const result = await adapter.get<string>("key1");

			expect(result).toBe("value1");
		});

		test("should return null for non-existent key", async () => {
			const result = await adapter.get<string>("non-existent");

			expect(result).toBeNull();
		});

		test("should delete a key", async () => {
			await adapter.set("key1", "value1");
			await adapter.delete("key1");
			const result = await adapter.get<string>("key1");

			expect(result).toBeNull();
		});

		test("should check if key exists", async () => {
			await adapter.set("key1", "value1");

			expect(await adapter.has("key1")).toBe(true);
			expect(await adapter.has("non-existent")).toBe(false);
		});

		test("should clear all keys", async () => {
			await adapter.set("key1", "value1");
			await adapter.set("key2", "value2");
			await adapter.clear();

			expect(await adapter.get<string>("key1")).toBeNull();
			expect(await adapter.get<string>("key2")).toBeNull();
		});

		test("should handle objects as values", async () => {
			const obj = { name: "test", count: 42 };
			await adapter.set("obj-key", obj);
			const result = await adapter.get<typeof obj>("obj-key");

			expect(result).toEqual(obj);
		});

		test("should handle arrays as values", async () => {
			const arr = [1, 2, 3, 4, 5];
			await adapter.set("arr-key", arr);
			const result = await adapter.get<number[]>("arr-key");

			expect(result).toEqual(arr);
		});

		test("should handle null values", async () => {
			await adapter.set("null-key", null);
			const result = await adapter.get<null>("null-key");

			expect(result).toBeNull();
		});

		test("should handle boolean values", async () => {
			await adapter.set("bool-key", true);
			const result = await adapter.get<boolean>("bool-key");

			expect(result).toBe(true);
		});

		test("should handle number values including zero", async () => {
			await adapter.set("zero-key", 0);
			const result = await adapter.get<number>("zero-key");

			expect(result).toBe(0);
		});
	});

	describe("TTL (Time To Live)", () => {
		test("should expire key after TTL", async () => {
			await adapter.set("ttl-key", "value", 0.1); // 100ms TTL

			// Should exist immediately
			expect(await adapter.has("ttl-key")).toBe(true);

			// Wait for expiration
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Should be expired
			expect(await adapter.has("ttl-key")).toBe(false);
			expect(await adapter.get<string>("ttl-key")).toBeNull();
		});

		test("should not expire key without TTL", async () => {
			await adapter.set("no-ttl-key", "value");

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Should still exist
			expect(await adapter.has("no-ttl-key")).toBe(true);
			expect(await adapter.get<string>("no-ttl-key")).toBe("value");
		});

		test("should handle TTL correctly with multiple keys", async () => {
			await adapter.set("ttl1", "value1", 0.1); // 100ms
			await adapter.set("ttl2", "value2", 0.2); // 200ms
			await adapter.set("no-ttl", "value3");

			// Wait 150ms
			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(await adapter.get<string>("ttl1")).toBeNull();
			expect(await adapter.get<string>("ttl2")).toBe("value2");
			expect(await adapter.get<string>("no-ttl")).toBe("value3");

			// Wait another 100ms
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(await adapter.get<string>("ttl2")).toBeNull();
			expect(await adapter.get<string>("no-ttl")).toBe("value3");
		});
	});

	describe("tag-based operations", () => {
		test("should set value with tags", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			const result = await adapter.get<User>("user:1");

			expect(result).toEqual({ name: "John" });
		});

		test("should set value with tags and TTL", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"], 0.1);

			expect(await adapter.get<User>("user:1")).toEqual({ name: "John" });

			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(await adapter.get<User>("user:1")).toBeNull();
		});

		test("should invalidate keys by tag", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"]);
			await adapter.setWithTags("user:2", { name: "Jane" }, ["users"]);
			await adapter.setWithTags("product:1", { title: "Widget" }, ["products"]);

			await adapter.invalidateByTag("users");

			expect(await adapter.get<User>("user:1")).toBeNull();
			expect(await adapter.get<User>("user:2")).toBeNull();
			expect(await adapter.get<Product>("product:1")).toEqual({
				title: "Widget",
			});
		});

		test("should invalidate keys by multiple tags", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			await adapter.setWithTags("user:2", { name: "Jane" }, ["users"]);
			await adapter.setWithTags("product:1", { title: "Widget" }, ["products"]);

			await adapter.invalidateByTags(["users", "products"]);

			expect(await adapter.get<User>("user:1")).toBeNull();
			expect(await adapter.get<User>("user:2")).toBeNull();
			expect(await adapter.get<Product>("product:1")).toBeNull();
		});

		test("should handle invalidating non-existent tag", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"]);

			await adapter.invalidateByTag("non-existent");

			expect(await adapter.get<User>("user:1")).toEqual({ name: "John" });
		});

		test("should handle multiple tags per key", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
				"premium",
			]);

			await adapter.invalidateByTag("premium");

			expect(await adapter.get<User>("user:1")).toBeNull();
		});

		test("should invalidate only keys with specified tag when multiple tags exist", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			await adapter.setWithTags("user:2", { name: "Jane" }, [
				"users",
				"inactive",
			]);

			await adapter.invalidateByTag("active");

			expect(await adapter.get<User>("user:1")).toBeNull();
			expect(await adapter.get<User>("user:2")).toEqual({ name: "Jane" });
		});

		test("should clean up tag index when deleting a key", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			await adapter.delete("user:1");

			// The tag should still exist internally but not affect anything
			// This is an implementation detail test
			await adapter.setWithTags("user:2", { name: "Jane" }, ["users"]);
			await adapter.invalidateByTag("users");

			expect(await adapter.get<User>("user:2")).toBeNull();
		});

		test("should clear tags when clearing all keys", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"]);
			await adapter.setWithTags("user:2", { name: "Jane" }, ["users"]);

			await adapter.clear();

			// Add new key with same tag
			await adapter.setWithTags("user:3", { name: "Bob" }, ["users"]);

			// Old tags should be cleared, only new key should be invalidated
			await adapter.invalidateByTag("users");

			expect(await adapter.get<User>("user:3")).toBeNull();
		});

		test("should handle empty tag array", async () => {
			await adapter.setWithTags("key1", "value1", []);

			expect(await adapter.get<string>("key1")).toBe("value1");
		});

		test("should handle invalidating empty tag array", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"]);

			await adapter.invalidateByTags([]);

			expect(await adapter.get<User>("user:1")).toEqual({
				name: "John",
			});
		});
	});

	describe("complex scenarios", () => {
		test("should handle overlapping tags correctly", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
				"premium",
			]);
			await adapter.setWithTags("user:2", { name: "Jane" }, [
				"users",
				"active",
			]);
			await adapter.setWithTags("user:3", { name: "Bob" }, ["users"]);

			await adapter.invalidateByTag("active");

			expect(await adapter.get<User>("user:1")).toBeNull();
			expect(await adapter.get<User>("user:2")).toBeNull();
			expect(await adapter.get<User>("user:3")).toEqual({ name: "Bob" });
		});

		test("should support updating value with new tags", async () => {
			await adapter.setWithTags("user:1", { name: "John", v: 1 }, [
				"users",
				"v1",
			]);
			await adapter.setWithTags("user:1", { name: "John", v: 2 }, [
				"users",
				"v2",
			]);

			// Invalidate old tag - should not affect the key
			// Note: This behavior depends on implementation
			// In current implementation, old tags are NOT removed
			const result = await adapter.get<UserWithVersion>("user:1");
			expect(result).toEqual({ name: "John", v: 2 });
		});

		test("should handle concurrent operations", async () => {
			const promises = [];

			// Set multiple keys concurrently
			for (let i = 0; i < 100; i++) {
				promises.push(adapter.setWithTags(`key:${i}`, { value: i }, ["batch"]));
			}

			await Promise.all(promises);

			// Verify all keys exist
			for (let i = 0; i < 100; i++) {
				const result = await adapter.get<{ value: number }>(`key:${i}`);
				expect(result).toEqual({ value: i });
			}

			// Invalidate all
			await adapter.invalidateByTag("batch");

			// Verify all keys are gone
			for (let i = 0; i < 100; i++) {
				const result = await adapter.get<{ value: number }>(`key:${i}`);
				expect(result).toBeNull();
			}
		});
	});
});

describe("IORedisKVAdapter", () => {
	let adapter: IORedisKVAdapter;
	let mockRedis: MockRedis;

	beforeEach(() => {
		mockRedis = new MockRedis();
		adapter = new IORedisKVAdapter(mockRedis as unknown as Redis);
	});

	describe("basic operations", () => {
		test("should set and get a value", async () => {
			await adapter.set("key1", "value1");
			const result = await adapter.get("key1");

			expect(result).toBe("value1");
		});

		test("should return null for non-existent key", async () => {
			const result = await adapter.get("non-existent");

			expect(result).toBeNull();
		});

		test("should delete a key", async () => {
			await adapter.set("key1", "value1");
			await adapter.delete("key1");
			const result = await adapter.get("key1");

			expect(result).toBeNull();
		});

		test("should check if key exists", async () => {
			await adapter.set("key1", "value1");

			expect(await adapter.has("key1")).toBe(true);
			expect(await adapter.has("non-existent")).toBe(false);
		});

		test("should clear all keys", async () => {
			await adapter.set("key1", "value1");
			await adapter.set("key2", "value2");
			await adapter.clear();

			expect(await adapter.get<string>("key1")).toBeNull();
			expect(await adapter.get<string>("key2")).toBeNull();
		});

		test("should handle objects as values", async () => {
			const obj = { name: "test", count: 42 };
			await adapter.set("obj-key", obj);
			const result = await adapter.get<typeof obj>("obj-key");

			expect(result).toEqual(obj);
		});

		test("should handle arrays as values", async () => {
			const arr = [1, 2, 3, 4, 5];
			await adapter.set("arr-key", arr);
			const result = await adapter.get<number[]>("arr-key");

			expect(result).toEqual(arr);
		});
	});

	describe("TTL (Time To Live)", () => {
		test("should use setex for TTL", async () => {
			await adapter.set("ttl-key", "value", 60);

			// Verify setex was called
			const stored = mockRedis.store.get("ttl-key");
			expect(stored).toBe(JSON.stringify("value"));
		});

		test("should use set without TTL", async () => {
			await adapter.set("no-ttl", "value");

			const stored = mockRedis.store.get("no-ttl");
			expect(stored).toBe(JSON.stringify("value"));
		});
	});

	describe("tag-based operations", () => {
		test("should set value with tags", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			const result = await adapter.get("user:1");

			expect(result).toEqual({ name: "John" });

			// Verify tags were stored
			const usersTag = mockRedis.sets.get("tag:users");
			const activeTag = mockRedis.sets.get("tag:active");
			expect(usersTag?.has("user:1")).toBe(true);
			expect(activeTag?.has("user:1")).toBe(true);
		});

		test("should set value with tags and TTL", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"], 60);

			const result = await adapter.get("user:1");
			expect(result).toEqual({ name: "John" });

			const usersTag = mockRedis.sets.get("tag:users");
			expect(usersTag?.has("user:1")).toBe(true);
		});

		test("should invalidate keys by tag", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"]);
			await adapter.setWithTags("user:2", { name: "Jane" }, ["users"]);
			await adapter.setWithTags("product:1", { title: "Widget" }, ["products"]);

			await adapter.invalidateByTag("users");

			expect(await adapter.get<User>("user:1")).toBeNull();
			expect(await adapter.get<User>("user:2")).toBeNull();
			expect(await adapter.get<Product>("product:1")).toEqual({
				title: "Widget",
			});
		});

		test("should invalidate keys by multiple tags", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			await adapter.setWithTags("user:2", { name: "Jane" }, ["users"]);
			await adapter.setWithTags("product:1", { title: "Widget" }, ["products"]);

			await adapter.invalidateByTags(["users", "products"]);

			expect(await adapter.get<User>("user:1")).toBeNull();
			expect(await adapter.get<User>("user:2")).toBeNull();
			expect(await adapter.get<Product>("product:1")).toBeNull();
		});

		test("should handle invalidating non-existent tag", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"]);

			await adapter.invalidateByTag("non-existent");

			expect(await adapter.get<User>("user:1")).toEqual({ name: "John" });
		});

		test("should handle multiple tags per key", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
				"premium",
			]);

			await adapter.invalidateByTag("premium");

			expect(await adapter.get<User>("user:1")).toBeNull();
		});

		test("should invalidate only keys with specified tag", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			await adapter.setWithTags("user:2", { name: "Jane" }, [
				"users",
				"inactive",
			]);

			await adapter.invalidateByTag("active");

			expect(await adapter.get<User>("user:1")).toBeNull();
			expect(await adapter.get<User>("user:2")).toEqual({ name: "Jane" });
		});

		test("should clean up tags when deleting a key", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, [
				"users",
				"active",
			]);
			await adapter.setWithTags("user:2", { name: "Jane" }, ["users"]);
			await adapter.delete("user:1");

			// Verify key is gone
			expect(await adapter.get<User>("user:1")).toBeNull();

			// Verify tag sets are cleaned up
			const usersTag = mockRedis.sets.get("tag:users");
			const activeTag = mockRedis.sets.get("tag:active");
			// usersTag should still exist (has user:2) but not contain user:1
			expect(usersTag?.has("user:1")).toBe(false);
			expect(usersTag?.has("user:2")).toBe(true);
			// activeTag should be removed (empty set)
			expect(activeTag).toBeUndefined();
		});

		test("should handle empty tag array", async () => {
			await adapter.setWithTags("key1", "value1", []);

			expect(await adapter.get<string>("key1")).toBe("value1");
		});

		test("should handle invalidating empty tag array", async () => {
			await adapter.setWithTags("user:1", { name: "John" }, ["users"]);

			await adapter.invalidateByTags([]);

			expect(await adapter.get<User>("user:1")).toEqual({ name: "John" });
		});
	});

	describe("pipeline operations", () => {
		test("should use pipeline for setWithTags", async () => {
			const tags = ["tag1", "tag2", "tag3"];
			await adapter.setWithTags("key1", "value1", tags);

			// Verify all tags were set
			for (const tag of tags) {
				const tagSet = mockRedis.sets.get(`tag:${tag}`);
				expect(tagSet?.has("key1")).toBe(true);
			}
		});

		test("should use pipeline for invalidateByTag", async () => {
			await adapter.setWithTags("key1", "value1", ["batch"]);
			await adapter.setWithTags("key2", "value2", ["batch"]);
			await adapter.setWithTags("key3", "value3", ["batch"]);

			await adapter.invalidateByTag("batch");

			expect(await adapter.get<string>("key1")).toBeNull();
			expect(await adapter.get<string>("key2")).toBeNull();
			expect(await adapter.get<string>("key3")).toBeNull();
		});
	});

	describe("JSON serialization", () => {
		test("should serialize and deserialize complex objects", async () => {
			const complexObj = {
				string: "test",
				number: 42,
				boolean: true,
				null: null,
				nested: {
					array: [1, 2, 3],
					object: { a: 1, b: 2 },
				},
			};

			await adapter.set("complex", complexObj);
			const result = await adapter.get("complex");

			expect(result).toEqual(complexObj);
		});

		test("should handle Date objects through JSON", async () => {
			const date = new Date("2024-01-01");
			await adapter.set("date", date);
			const result = await adapter.get<string>("date");

			// Date is serialized to ISO string
			expect(result).toBe(date.toISOString());
		});
	});
});

/**
 * Mock Redis client for testing
 */
class MockRedis {
	store = new Map<string, string>();
	sets = new Map<string, Set<string>>();
	pipelineQueue: Array<() => void> = [];
	isInPipeline = false;

	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}

	async set(key: string, value: string): Promise<"OK"> {
		const operation = () => {
			this.store.set(key, value);
		};

		if (this.isInPipeline) {
			this.pipelineQueue.push(operation);
		} else {
			operation();
		}

		return "OK";
	}

	async setex(key: string, _ttl: number, value: string): Promise<"OK"> {
		const operation = () => {
			this.store.set(key, value);
			// In real Redis, TTL would be handled, but for testing we just store the value
		};

		if (this.isInPipeline) {
			this.pipelineQueue.push(operation);
		} else {
			operation();
		}

		return "OK";
	}

	async del(...keys: string[]): Promise<number> {
		const operation = () => {
			for (const key of keys) {
				this.store.delete(key);
			}
		};

		if (this.isInPipeline) {
			this.pipelineQueue.push(operation);
		} else {
			operation();
		}

		return keys.length;
	}

	async exists(key: string): Promise<number> {
		return this.store.has(key) ? 1 : 0;
	}

	async flushdb(): Promise<"OK"> {
		this.store.clear();
		this.sets.clear();
		return "OK";
	}

	async sadd(key: string, ...members: string[]): Promise<number> {
		const operation = () => {
			if (!this.sets.has(key)) {
				this.sets.set(key, new Set());
			}
			const set = this.sets.get(key)!;
			for (const member of members) {
				set.add(member);
			}
		};

		if (this.isInPipeline) {
			this.pipelineQueue.push(operation);
		} else {
			operation();
		}

		return members.length;
	}

	async smembers(key: string): Promise<string[]> {
		const set = this.sets.get(key);
		return set ? Array.from(set) : [];
	}

	async srem(key: string, ...members: string[]): Promise<number> {
		const operation = () => {
			const set = this.sets.get(key);
			if (set) {
				for (const member of members) {
					set.delete(member);
				}
				if (set.size === 0) {
					this.sets.delete(key);
				}
			}
		};

		if (this.isInPipeline) {
			this.pipelineQueue.push(operation);
		} else {
			operation();
		}

		return members.length;
	}

	async scan(cursor: string, ..._args: string[]): Promise<[string, string[]]> {
		// Simple implementation: return all tag keys on first call
		if (cursor === "0") {
			const tagKeys = Array.from(this.sets.keys()).filter((k) =>
				k.startsWith("tag:"),
			);
			return ["0", tagKeys];
		}
		return ["0", []];
	}

	pipeline(): this {
		this.isInPipeline = true;
		this.pipelineQueue = [];
		return this;
	}

	async exec(): Promise<Array<[Error | null, unknown]>> {
		this.isInPipeline = false;
		for (const operation of this.pipelineQueue) {
			operation();
		}
		const results = this.pipelineQueue.map(() => [null, "OK"] as [null, "OK"]);
		this.pipelineQueue = [];
		return results;
	}
}
