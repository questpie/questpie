/**
 * Key-Value Store Interface
 */
export interface KVAdapter {
	get<T = unknown>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttl?: number): Promise<void>;
	delete(key: string): Promise<void>;
	has(key: string): Promise<boolean>;
	clear(): Promise<void>;

	/**
	 * Set a key-value pair with associated tags for cache invalidation
	 */
	setWithTags?(
		key: string,
		value: unknown,
		tags: string[],
		ttl?: number,
	): Promise<void>;

	/**
	 * Invalidate all keys associated with a specific tag
	 */
	invalidateByTag?(tag: string): Promise<void>;

	/**
	 * Invalidate all keys associated with any of the specified tags
	 */
	invalidateByTags?(tags: string[]): Promise<void>;
}
