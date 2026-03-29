import type { KVAdapter } from "../adapter.js";

/**
 * In-Memory Adapter (Default)
 * Uses a simple Map with TTL support
 */
export class MemoryKVAdapter implements KVAdapter {
	private store = new Map<string, { value: unknown; expiresAt?: number }>();
	private tagIndex = new Map<string, Set<string>>();

	async get<T = unknown>(key: string): Promise<T | null> {
		const entry = this.store.get(key);
		if (!entry) return null;

		if (entry.expiresAt && Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return null;
		}

		return entry.value as T;
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		const expiresAt = ttl ? Date.now() + ttl * 1000 : undefined;
		this.store.set(key, { value, expiresAt });
	}

	async setWithTags(
		key: string,
		value: unknown,
		tags: string[],
		ttl?: number,
	): Promise<void> {
		// Set the value
		await this.set(key, value, ttl);

		// Update tag index
		for (const tag of tags) {
			if (!this.tagIndex.has(tag)) {
				this.tagIndex.set(tag, new Set());
			}
			this.tagIndex.get(tag)!.add(key);
		}
	}

	async invalidateByTag(tag: string): Promise<void> {
		const keys = this.tagIndex.get(tag);
		if (!keys) return;

		// Delete all keys associated with this tag
		for (const key of keys) {
			this.store.delete(key);
		}

		// Clean up the tag index
		this.tagIndex.delete(tag);
	}

	async invalidateByTags(tags: string[]): Promise<void> {
		await Promise.all(tags.map((tag) => this.invalidateByTag(tag)));
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);

		// Clean up tag index
		for (const [tag, keys] of this.tagIndex.entries()) {
			keys.delete(key);
			if (keys.size === 0) {
				this.tagIndex.delete(tag);
			}
		}
	}

	async has(key: string): Promise<boolean> {
		const entry = this.store.get(key);
		if (!entry) return false;
		if (entry.expiresAt && Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return false;
		}
		return true;
	}

	async clear(): Promise<void> {
		this.store.clear();
		this.tagIndex.clear();
	}
}
