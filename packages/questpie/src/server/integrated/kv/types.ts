import type { KVAdapter } from "./adapter.js";

/**
 * Configuration for the KV Module
 */
export interface KVConfig {
	/**
	 * Custom adapter instance.
	 * If not provided, defaults to MemoryKVAdapter.
	 */
	adapter?: KVAdapter;

	/**
	 * Default TTL in seconds for set operations if not specified
	 */
	defaultTtl?: number;
}
