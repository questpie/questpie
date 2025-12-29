/**
 * Key-Value Store Interface
 */
export interface KVAdapter {
	get<T = unknown>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttl?: number): Promise<void>;
	delete(key: string): Promise<void>;
	has(key: string): Promise<boolean>;
	clear(): Promise<void>;
}
