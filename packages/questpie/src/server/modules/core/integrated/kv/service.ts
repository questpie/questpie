import type { KVAdapter } from "./adapter.js";
import { MemoryKVAdapter } from "./adapters/memory.js";
import type { KVConfig } from "./types.js";

export class KVService {
	private adapter: KVAdapter;
	private config: KVConfig;

	constructor(config: KVConfig = {}) {
		this.config = config;
		this.adapter = config.adapter || new MemoryKVAdapter();
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		return this.adapter.get<T>(key);
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		return this.adapter.set(key, value, ttl ?? this.config.defaultTtl);
	}

	async delete(key: string): Promise<void> {
		return this.adapter.delete(key);
	}

	async has(key: string): Promise<boolean> {
		return this.adapter.has(key);
	}

	async clear(): Promise<void> {
		return this.adapter.clear();
	}
}
