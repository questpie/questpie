import type { KVAdapter } from "../adapter.js";

type MaybePromise<T> = T | Promise<T>;

export interface CloudflareKVListKey {
	name: string;
	expiration?: number;
	metadata?: unknown;
}

export interface CloudflareKVListResult {
	keys: CloudflareKVListKey[];
	list_complete: boolean;
	cursor?: string;
}

export interface CloudflareKVNamespace {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options?: {
			expirationTtl?: number;
			metadata?: unknown;
		},
	): Promise<void>;
	delete(key: string): Promise<void>;
	list(options?: {
		prefix?: string;
		cursor?: string;
		limit?: number;
	}): Promise<CloudflareKVListResult>;
}

export type CloudflareKVNamespaceProvider =
	() => MaybePromise<CloudflareKVNamespace>;
export type CloudflareKVNamespaceInput =
	| CloudflareKVNamespace
	| CloudflareKVNamespaceProvider;

export interface CloudflareKVAdapterOptions {
	namespace: CloudflareKVNamespaceInput;
	/**
	 * Prefix all keys managed by this adapter. Useful when one Cloudflare KV
	 * namespace is shared by more than one logical cache.
	 */
	keyPrefix?: string;
	/**
	 * Prefix for internal tag index keys, applied after keyPrefix.
	 * @default "__questpie_tag:"
	 */
	tagIndexPrefix?: string;
	/**
	 * Number of keys to request per list() page.
	 * @default 1000
	 */
	listLimit?: number;
}

function isCloudflareKVNamespaceProvider(
	namespace: CloudflareKVNamespaceInput,
): namespace is CloudflareKVNamespaceProvider {
	return typeof namespace === "function";
}

export class CloudflareKVAdapter implements KVAdapter {
	public readonly runtime = "cloudflare" as const;
	private readonly getNamespace: CloudflareKVNamespaceProvider;
	private readonly keyPrefix: string;
	private readonly tagIndexPrefix: string;
	private readonly listLimit: number;

	constructor(options: CloudflareKVAdapterOptions) {
		const namespace = options.namespace;
		this.getNamespace = isCloudflareKVNamespaceProvider(namespace)
			? namespace
			: () => namespace;
		this.keyPrefix = options.keyPrefix ?? "";
		this.tagIndexPrefix = options.tagIndexPrefix ?? "__questpie_tag:";
		this.listLimit = options.listLimit ?? 1000;
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		const namespace = await this.getNamespace();
		const value = await namespace.get(this.toStorageKey(key));
		if (value === null) return null;
		return this.deserialize<T>(value);
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		await this.putSerialized(key, value, ttl);
	}

	async setWithTags(
		key: string,
		value: unknown,
		tags: string[],
		ttl?: number,
	): Promise<void> {
		await this.putSerialized(key, value, ttl);
		await Promise.all(tags.map((tag) => this.addKeyToTag(tag, key)));
	}

	async invalidateByTag(tag: string): Promise<void> {
		const namespace = await this.getNamespace();
		const keys = await this.getTagKeys(tag);
		await Promise.all(
			keys.map((key) => namespace.delete(this.toStorageKey(key))),
		);
		await namespace.delete(this.toTagStorageKey(tag));
	}

	async invalidateByTags(tags: string[]): Promise<void> {
		await Promise.all(tags.map((tag) => this.invalidateByTag(tag)));
	}

	async delete(key: string): Promise<void> {
		const namespace = await this.getNamespace();
		await namespace.delete(this.toStorageKey(key));
		await this.removeKeyFromAllTags(key);
	}

	async has(key: string): Promise<boolean> {
		const namespace = await this.getNamespace();
		return (await namespace.get(this.toStorageKey(key))) !== null;
	}

	async clear(): Promise<void> {
		await this.deleteKeysByPrefix(this.keyPrefix);
	}

	private async putSerialized(
		key: string,
		value: unknown,
		ttl?: number,
	): Promise<void> {
		const namespace = await this.getNamespace();
		await namespace.put(this.toStorageKey(key), this.serialize(value), {
			...(ttl ? { expirationTtl: ttl } : {}),
		});
	}

	private serialize(value: unknown): string {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) {
			throw new TypeError(
				"[questpie] CloudflareKVAdapter can only store JSON-serializable values.",
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

	private tagNameFromStorageKey(key: string): string {
		return key.slice((this.keyPrefix + this.tagIndexPrefix).length);
	}

	private async getTagKeys(tag: string): Promise<string[]> {
		return (await this.get<string[]>(this.tagIndexKey(tag))) ?? [];
	}

	private async setTagKeys(tag: string, keys: string[]): Promise<void> {
		await this.putSerialized(this.tagIndexKey(tag), Array.from(new Set(keys)));
	}

	private tagIndexKey(tag: string): string {
		return `${this.tagIndexPrefix}${tag}`;
	}

	private async addKeyToTag(tag: string, key: string): Promise<void> {
		const keys = await this.getTagKeys(tag);
		if (keys.includes(key)) return;
		keys.push(key);
		await this.setTagKeys(tag, keys);
	}

	private async removeKeyFromAllTags(key: string): Promise<void> {
		const namespace = await this.getNamespace();
		const tagStorageKeys = await this.collectKeyNames(
			this.keyPrefix + this.tagIndexPrefix,
		);

		for (const tagStorageKey of tagStorageKeys) {
			const tag = this.tagNameFromStorageKey(tagStorageKey);
			const keys = await this.getTagKeys(tag);
			const nextKeys = keys.filter((candidate) => candidate !== key);
			if (nextKeys.length === keys.length) continue;

			if (nextKeys.length === 0) {
				await namespace.delete(tagStorageKey);
			} else {
				await this.setTagKeys(tag, nextKeys);
			}
		}
	}

	private async deleteKeysByPrefix(prefix: string): Promise<void> {
		const namespace = await this.getNamespace();
		const keys = await this.collectKeyNames(prefix);
		await Promise.all(keys.map((key) => namespace.delete(key)));
	}

	private async collectKeyNames(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		for await (const key of this.listKeyNames(prefix)) {
			keys.push(key);
		}
		return keys;
	}

	private async *listKeyNames(prefix: string): AsyncGenerator<string> {
		const namespace = await this.getNamespace();
		let cursor: string | undefined;
		do {
			const result = await namespace.list({
				prefix,
				cursor,
				limit: this.listLimit,
			});
			for (const key of result.keys) {
				yield key.name;
			}
			cursor = result.list_complete ? undefined : result.cursor;
		} while (cursor);
	}
}

export function cloudflareKVAdapter(
	options: CloudflareKVAdapterOptions,
): CloudflareKVAdapter {
	return new CloudflareKVAdapter(options);
}
