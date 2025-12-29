import type { KVAdapter } from "../adapter";

/**
 * In-Memory Adapter (Default)
 * Uses a simple Map with TTL support
 */
export class MemoryKVAdapter implements KVAdapter {
	private store = new Map<string, { value: unknown; expiresAt?: number }>();

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
