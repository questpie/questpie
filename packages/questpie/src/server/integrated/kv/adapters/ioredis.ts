import type { Redis } from "ioredis";
import type { KVAdapter } from "../adapter.js";

/**
 * Redis Adapter using ioredis
 * Supports tag-based cache invalidation via Redis SETs
 */
export class IORedisKVAdapter implements KVAdapter {
	constructor(private redis: Redis) {}

	async get<T = unknown>(key: string): Promise<T | null> {
		const value = await this.redis.get(key);
		if (value === null) return null;
		try {
			return JSON.parse(value) as T;
		} catch {
			return value as T;
		}
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		const serialized = JSON.stringify(value);
		if (ttl) {
			await this.redis.setex(key, ttl, serialized);
		} else {
			await this.redis.set(key, serialized);
		}
	}

	async setWithTags(
		key: string,
		value: unknown,
		tags: string[],
		ttl?: number,
	): Promise<void> {
		const serialized = JSON.stringify(value);

		// Use pipeline for atomic operations
		const pipeline = this.redis.pipeline();

		// Set the value
		if (ttl) {
			pipeline.setex(key, ttl, serialized);
		} else {
			pipeline.set(key, serialized);
		}

		// Add key to each tag's set
		for (const tag of tags) {
			const tagKey = `tag:${tag}`;
			pipeline.sadd(tagKey, key);
		}

		await pipeline.exec();
	}

	async invalidateByTag(tag: string): Promise<void> {
		const tagKey = `tag:${tag}`;

		// Get all keys associated with this tag
		const keys = await this.redis.smembers(tagKey);
		if (keys.length === 0) return;

		// Delete all keys and the tag set
		const pipeline = this.redis.pipeline();
		for (const key of keys) {
			pipeline.del(key);
		}
		pipeline.del(tagKey);
		await pipeline.exec();
	}

	async invalidateByTags(tags: string[]): Promise<void> {
		await Promise.all(tags.map((tag) => this.invalidateByTag(tag)));
	}

	async delete(key: string): Promise<void> {
		// Find all tags that contain this key
		const cursor = "0";
		const tagPattern = "tag:*";

		// Use SCAN to find all tag keys
		const tagKeys: string[] = [];
		let scanCursor = cursor;

		do {
			const [nextCursor, keys] = await this.redis.scan(
				scanCursor,
				"MATCH",
				tagPattern,
				"COUNT",
				100,
			);
			tagKeys.push(...keys);
			scanCursor = nextCursor;
		} while (scanCursor !== "0");

		// Remove key from all tag sets and delete the key
		const pipeline = this.redis.pipeline();
		for (const tagKey of tagKeys) {
			pipeline.srem(tagKey, key);
		}
		pipeline.del(key);
		await pipeline.exec();
	}

	async has(key: string): Promise<boolean> {
		const exists = await this.redis.exists(key);
		return exists === 1;
	}

	async clear(): Promise<void> {
		await this.redis.flushdb();
	}
}
