import type { KVAdapter } from "../../../src/server/integrated/kv/adapter.js";

/**
 * Mock KV Adapter for testing
 * Extends the standard KV adapter interface with test utilities
 */
export class MockKVAdapter implements KVAdapter {
	private store = new Map<string, { value: unknown; expiresAt?: number }>();

	/**
	 * Get all stored keys (test utility)
	 */
	getKeys(): string[] {
		return Array.from(this.store.keys());
	}

	/**
	 * Get all stored values (test utility)
	 */
	getAll(): Map<string, unknown> {
		const result = new Map<string, unknown>();
		for (const [key, entry] of this.store.entries()) {
			if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
				result.set(key, entry.value);
			}
		}
		return result;
	}

	/**
	 * Check if a key is expired (test utility)
	 */
	isExpired(key: string): boolean {
		const entry = this.store.get(key);
		if (!entry) return false;
		return entry.expiresAt ? Date.now() > entry.expiresAt : false;
	}

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

	async delete(key: string): Promise<void> {
		this.store.delete(key);
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
	}
}
