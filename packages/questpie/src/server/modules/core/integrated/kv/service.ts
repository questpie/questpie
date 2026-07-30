import type { ObservabilityService } from "../observability/service.js";
import type { KVAdapter } from "./adapter.js";
import { MemoryKVAdapter } from "./adapters/memory.js";
import type { KVConfig } from "./types.js";

export class KVService {
	private adapter: KVAdapter;
	private config: KVConfig;
	private observability?: ObservabilityService;

	constructor(config: KVConfig = {}, observability?: ObservabilityService) {
		this.config = config;
		this.adapter = config.adapter || new MemoryKVAdapter();
		this.observability = observability;
	}

	/**
	 * Wrap one adapter call in a span. Cache calls are high-frequency, so this
	 * records the operation and whether the key was present — the two things a
	 * hit-rate question needs — and nothing per-key, which would explode
	 * cardinality in any metrics backend.
	 */
	private trace<T>(op: string, key: string, fn: () => Promise<T>): Promise<T> {
		if (!this.observability?.enabled) return fn();
		return this.observability.span(
			`kv.${op}`,
			(span) => {
				span.setAttributes({
					"db.operation.name": op,
					"db.system.name": "questpie.kv",
					// Key LENGTH, never the key: keys routinely embed ids and
					// occasionally tokens.
					"questpie.kv.key_length": key.length,
				});
				return fn();
			},
			{ kind: "client" },
		);
	}

	async get<T = unknown>(key: string): Promise<T | null> {
		return this.trace("get", key, () => this.adapter.get<T>(key));
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		return this.trace("set", key, () =>
			this.adapter.set(key, value, ttl ?? this.config.defaultTtl),
		);
	}

	async delete(key: string): Promise<void> {
		return this.trace("delete", key, () => this.adapter.delete(key));
	}

	async has(key: string): Promise<boolean> {
		return this.trace("has", key, () => this.adapter.has(key));
	}

	async clear(): Promise<void> {
		return this.adapter.clear();
	}
}
