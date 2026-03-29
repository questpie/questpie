/**
 * Search Service
 *
 * High-level search API wrapper that delegates to the configured SearchAdapter.
 * This is exposed via app.search.* and provides a unified interface regardless
 * of the underlying search implementation.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { createPostgresSearchAdapter } from "./adapters/postgres.js";
import type {
	AdapterLogger,
	IndexParams,
	RemoveParams,
	SearchAdapter,
	SearchOptions,
	SearchResponse,
	SearchService,
} from "./types.js";

// ============================================================================
// Search Service Implementation
// ============================================================================

/**
 * Search service wrapper that delegates to adapter
 */
export class SearchServiceWrapper implements SearchService {
	private initialized = false;

	// Per-instance debounce state for scheduleIndex()
	private _pendingIndexItems = new Map<
		string,
		{ collection: string; recordId: string }
	>();
	private _flushTimeout: ReturnType<typeof setTimeout> | null = null;
	private _debounceDelayMs = 100;

	/** Queue dispatch function — set by QUESTPIE after queue is ready */
	_queuePublish:
		| ((payload: {
				items: { collection: string; recordId: string }[];
		  }) => Promise<string | null>)
		| null = null;

	constructor(
		private adapter: SearchAdapter,
		private db: PostgresJsDatabase<any>,
		private logger: AdapterLogger,
	) {}

	/**
	 * Initialize the adapter (called by QUESTPIE on startup)
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		await this.adapter.initialize({
			db: this.db,
			logger: this.logger,
		});

		this.initialized = true;
	}

	/**
	 * Get the underlying adapter
	 */
	getAdapter(): SearchAdapter {
		return this.adapter;
	}

	/**
	 * Search across collections
	 * Returns results, total count, and optional facets
	 */
	async search(options: SearchOptions): Promise<SearchResponse> {
		this.ensureInitialized();
		return this.adapter.search(options);
	}

	/**
	 * Index a record
	 */
	async index(params: IndexParams): Promise<void> {
		this.ensureInitialized();
		return this.adapter.index(params);
	}

	/**
	 * Remove from index
	 */
	async remove(params: RemoveParams): Promise<void> {
		this.ensureInitialized();
		return this.adapter.remove(params);
	}

	/**
	 * Reindex entire collection
	 */
	async reindex(collection: string): Promise<void> {
		this.ensureInitialized();
		return this.adapter.reindex(collection);
	}

	/**
	 * Clear entire search index
	 */
	async clear(): Promise<void> {
		this.ensureInitialized();
		return this.adapter.clear();
	}

	/**
	 * Index multiple records in a batch (upsert).
	 * More efficient than calling index() multiple times.
	 * Falls back to sequential index() calls if adapter doesn't support batch.
	 */
	async indexBatch(params: IndexParams[]): Promise<void> {
		this.ensureInitialized();

		if (params.length === 0) return;

		// Use batch method if adapter supports it, otherwise fall back to sequential
		if (this.adapter.indexBatch) {
			return this.adapter.indexBatch(params);
		}

		// Fallback: sequential indexing
		for (const param of params) {
			await this.adapter.index(param);
		}
	}

	// ========================================================================
	// Debounced Index Scheduling (per-instance)
	// ========================================================================

	/**
	 * Schedule a record for async indexing with per-instance debouncing.
	 *
	 * If a queue dispatch function is set (`_queuePublish`), items are batched
	 * and flushed after a 100ms debounce window via the `index-records` job.
	 *
	 * Returns `true` if the item was scheduled (async), `false` if no queue
	 * is available (caller should fall back to sync indexing).
	 */
	scheduleIndex(collection: string, recordId: string): boolean {
		if (!this._queuePublish) return false;

		const key = `${collection}:${recordId}`;
		this._pendingIndexItems.set(key, { collection, recordId });

		// Reset debounce timer
		if (this._flushTimeout) {
			clearTimeout(this._flushTimeout);
		}

		this._flushTimeout = setTimeout(() => {
			this._flushTimeout = null;
			this._flushPending().catch((err) => {
				this.logger.error("[Search] Error in debounced flush:", err);
			});
		}, this._debounceDelayMs);

		return true;
	}

	/**
	 * Force flush any pending index items immediately.
	 * Useful for tests or graceful shutdown.
	 */
	async flushPending(): Promise<void> {
		if (this._flushTimeout) {
			clearTimeout(this._flushTimeout);
			this._flushTimeout = null;
		}
		await this._flushPending();
	}

	private async _flushPending(): Promise<void> {
		if (this._pendingIndexItems.size === 0) return;

		const items = Array.from(this._pendingIndexItems.values());
		this._pendingIndexItems.clear();

		if (!this._queuePublish) {
			this.logger.warn(
				"[Search] flushPending called but no queue available — items lost",
			);
			return;
		}

		try {
			await this._queuePublish({ items });
		} catch (error) {
			this.logger.error(
				"[Search] Failed to dispatch index-records job:",
				error,
			);
		}
	}

	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error(
				"SearchService not initialized. Call initialize() first or ensure QUESTPIE is properly started.",
			);
		}
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create search service with adapter
 *
 * @param adapter - Search adapter (or undefined for default PostgresSearchAdapter)
 * @param db - Database connection
 * @param logger - Logger instance
 */
export function createSearchService(
	adapter: SearchAdapter | undefined,
	db: PostgresJsDatabase<any>,
	logger?: AdapterLogger,
): SearchServiceWrapper {
	// Use provided adapter or create default PostgresSearchAdapter
	const resolvedAdapter = adapter ?? createPostgresSearchAdapter();

	// Create default logger if not provided
	const resolvedLogger: AdapterLogger = logger ?? {
		debug: (...args) => console.debug("[Search]", ...args),
		info: (...args) => console.info("[Search]", ...args),
		warn: (...args) => console.warn("[Search]", ...args),
		error: (...args) => console.error("[Search]", ...args),
	};

	return new SearchServiceWrapper(resolvedAdapter, db, resolvedLogger);
}

// ============================================================================
// Legacy exports (backwards compatibility)
// ============================================================================

/**
 * @deprecated Use createSearchService with adapter instead
 */
export function createSearchServiceLegacy(
	db: PostgresJsDatabase<any>,
	_config: any = {},
): SearchService {
	// Create with default PostgresSearchAdapter for backwards compatibility
	const service = createSearchService(undefined, db);
	// Note: service needs to be initialized before use
	return service;
}
