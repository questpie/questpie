import type { KVAdapter } from "../adapter.js";

type MaybePromise<T> = T | Promise<T>;

export interface RedisKVClient {
	get(key: string): Promise<string | null>;
	set(
		key: string,
		value: string,
		options?: {
			EX?: number;
		},
	): Promise<unknown>;
	del(key: string | string[]): Promise<unknown>;
	exists(key: string): Promise<number | boolean>;
	sAdd(key: string, members: string | string[]): Promise<unknown>;
	sMembers(key: string): Promise<string[]>;
	sRem(key: string, members: string | string[]): Promise<unknown>;
	scanIterator(options?: {
		MATCH?: string;
		COUNT?: number;
	}): AsyncIterable<string | string[]>;
	flushDb?: () => Promise<unknown>;
}

export type RedisKVClientProvider = () => MaybePromise<RedisKVClient>;
export type RedisKVClientInput = RedisKVClient | RedisKVClientProvider;

export interface RedisKVAdapterOptions {
	client: RedisKVClientInput;
	/**
	 * Prefix all keys managed by this adapter. Useful when one Redis database
	 * is shared by more than one logical cache.
	 */
	keyPrefix?: string;
	/**
	 * Prefix for internal tag index keys, applied after keyPrefix.
	 * @default "__questpie_tag:"
	 */
	tagIndexPrefix?: string;
	/**
	 * Number of keys to request per scan page.
	 * @default 100
	 */
	scanCount?: number;
	/**
	 * Allow clear() to call Redis FLUSHDB when no keyPrefix is configured.
	 * Disabled by default so a shared Redis database is not wiped by accident.
	 *
	 * @default false
	 */
	allowFlushDb?: boolean;
}

/**
 * Redis-backed KV adapter using the official node-redis command shape.
 */
export class RedisKVAdapter implements KVAdapter {
	private readonly clientInput: RedisKVClientInput;
	private clientPromise?: Promise<RedisKVClient>;
	private readonly keyPrefix: string;
	private readonly tagIndexPrefix: string;
	private readonly scanCount: number;
	private readonly allowFlushDb: boolean;

	constructor(options: RedisKVAdapterOptions) {
		this.clientInput = options.client;
		this.keyPrefix = options.keyPrefix ?? "";
		this.tagIndexPrefix = options.tagIndexPrefix ?? "__questpie_tag:";
		this.scanCount = options.scanCount ?? 100;
		this.allowFlushDb = options.allowFlushDb === true;
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		const client = await this.getClient();
		const value = await client.get(this.toStorageKey(key));
		if (value === null) return null;
		return this.deserialize<T>(value);
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		const client = await this.getClient();
		await this.putSerialized(client, this.toStorageKey(key), value, ttl);
	}

	async setWithTags(
		key: string,
		value: unknown,
		tags: string[],
		ttl?: number,
	): Promise<void> {
		const client = await this.getClient();
		const storageKey = this.toStorageKey(key);
		await this.putSerialized(client, storageKey, value, ttl);
		await Promise.all(
			tags.map((tag) => client.sAdd(this.toTagStorageKey(tag), storageKey)),
		);
	}

	async invalidateByTag(tag: string): Promise<void> {
		const client = await this.getClient();
		const tagKey = this.toTagStorageKey(tag);
		const keys = await client.sMembers(tagKey);
		await Promise.all([this.deleteKeys(client, keys), client.del(tagKey)]);
	}

	async invalidateByTags(tags: string[]): Promise<void> {
		await Promise.all(tags.map((tag) => this.invalidateByTag(tag)));
	}

	async delete(key: string): Promise<void> {
		const client = await this.getClient();
		const storageKey = this.toStorageKey(key);
		const tagKeys = await this.collectKeyNames(
			client,
			`${this.keyPrefix}${this.tagIndexPrefix}*`,
		);

		await Promise.all([
			...tagKeys.map((tagKey) => client.sRem(tagKey, storageKey)),
			client.del(storageKey),
		]);
	}

	async has(key: string): Promise<boolean> {
		const client = await this.getClient();
		const exists = await client.exists(this.toStorageKey(key));
		return typeof exists === "boolean" ? exists : exists > 0;
	}

	async clear(): Promise<void> {
		const client = await this.getClient();
		if (!this.keyPrefix && this.allowFlushDb && client.flushDb) {
			await client.flushDb();
			return;
		}

		const keys = await this.collectKeyNames(client, `${this.keyPrefix}*`);
		await this.deleteKeys(client, keys);
	}

	private async putSerialized(
		client: RedisKVClient,
		storageKey: string,
		value: unknown,
		ttl?: number,
	): Promise<void> {
		await client.set(storageKey, this.serialize(value), {
			...(ttl ? { EX: ttl } : {}),
		});
	}

	private serialize(value: unknown): string {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) {
			throw new TypeError(
				"[questpie] RedisKVAdapter can only store JSON-serializable values.",
			);
		}
		return serialized;
	}

	private deserialize<T>(value: string): T {
		try {
			return JSON.parse(value) as T;
		} catch {
			return value as T;
		}
	}

	private toStorageKey(key: string): string {
		return `${this.keyPrefix}${key}`;
	}

	private toTagStorageKey(tag: string): string {
		return `${this.keyPrefix}${this.tagIndexPrefix}${tag}`;
	}

	private async collectKeyNames(
		client: RedisKVClient,
		pattern: string,
	): Promise<string[]> {
		const keys: string[] = [];
		for await (const entry of client.scanIterator({
			MATCH: pattern,
			COUNT: this.scanCount,
		})) {
			if (Array.isArray(entry)) {
				keys.push(...entry);
			} else {
				keys.push(entry);
			}
		}
		return keys;
	}

	private async deleteKeys(
		client: RedisKVClient,
		keys: string[],
	): Promise<void> {
		if (keys.length === 0) return;
		await client.del(keys);
	}

	private async getClient(): Promise<RedisKVClient> {
		this.clientPromise ??= Promise.resolve(
			typeof this.clientInput === "function"
				? this.clientInput()
				: this.clientInput,
		);
		return this.clientPromise;
	}
}

export function redisKVAdapter(options: RedisKVAdapterOptions): RedisKVAdapter {
	return new RedisKVAdapter(options);
}
