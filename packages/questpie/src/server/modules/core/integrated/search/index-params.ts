/**
 * Search Index Params Builder
 *
 * Single shared helper that turns a record + its collection's `searchable`
 * config into the full {@link IndexParams} payload (title, content, metadata,
 * facets, embedding) for ONE record in ONE locale.
 *
 * Both the live sync hook (modules/core/config/app.ts) and the async
 * `index-records` queue job call this — so the two indexing paths can never
 * diverge again. Before this existed, both indexed only `title`, ignoring the
 * collection `.searchable({...})` config (content/metadata/facets/embeddings).
 */

import { extractFacetValues } from "./facet-utils.js";
import type {
	IndexParams,
	SearchableConfig,
	SearchableContext,
} from "./types.js";

/**
 * Resolve a collection's `searchable` builder state to a config object.
 * Returns `null` when indexing must be skipped:
 * - `.searchable(false)` (explicit opt-out)
 * - `.searchable({ disabled: true })`
 * - `.searchable({ manual: true })` (user controls indexing via hooks)
 *
 * Otherwise returns the explicitly enabled {@link SearchableConfig}.
 */
export function resolveAutomaticSearchableConfig(
	searchable: SearchableConfig | false | undefined,
): SearchableConfig | null {
	if (!searchable) return null;
	if (searchable.disabled) return null;
	if (searchable.manual) return null;
	return searchable;
}

/** Whether a collection is visible to Search, including manual projections. */
export function isSearchableConfigEnabled(
	searchable: SearchableConfig | false | undefined,
): searchable is SearchableConfig {
	return (
		searchable !== undefined && searchable !== false && !searchable.disabled
	);
}

/**
 * Options for {@link buildIndexParams}.
 */
export interface BuildIndexParamsOptions {
	/** Collection (or global) slug being indexed */
	collection: string;
	/** Locale the record was fetched in */
	locale: string;
	/** The collection's `.searchable(...)` builder state */
	searchable: SearchableConfig | false | undefined;
	/** App instance — passed to user-defined `embeddings(record, ctx)` */
	app: unknown;
	/** Default locale — passed to user-defined `embeddings(record, ctx)` */
	defaultLocale: string;
}

/**
 * Build the full {@link IndexParams} for a single record in a single locale,
 * honoring the collection's `searchable` config.
 *
 * Returns `null` when the collection has opted out of indexing
 * (`.searchable(false)` / `disabled` / `manual`) — callers should skip.
 *
 * @param record - The (localized) record to index. Must have `id`; `_title`
 *   provides the title (falls back to `id`).
 */
export async function buildIndexParams(
	record: Record<string, any>,
	options: BuildIndexParamsOptions,
): Promise<IndexParams | null> {
	const config = resolveAutomaticSearchableConfig(options.searchable);
	if (!config) return null;

	// Title: _title field or fallback to id
	const title = String(record._title ?? record.id);

	// Content is deliberately opt-in. Automatically projecting every primitive
	// field can make field-level secrets searchable by actors who may read the
	// row but not the source field.
	const content = config.content
		? config.content(record) || undefined
		: undefined;

	// Metadata: only from custom config
	const metadata = config.metadata ? config.metadata(record) : undefined;

	// Facets: derived from metadata + the collection's facets config
	const facets =
		metadata && config.facets
			? extractFacetValues(metadata, config.facets)
			: undefined;

	// Embedding: only from custom config
	let embedding: number[] | undefined;
	if (config.embeddings) {
		const searchableContext: SearchableContext = {
			app: options.app,
			locale: options.locale,
			defaultLocale: options.defaultLocale,
		};
		embedding = await config.embeddings(record, searchableContext);
	}

	return {
		collection: options.collection,
		recordId: String(record.id),
		locale: options.locale,
		title,
		content,
		metadata,
		facets: facets && facets.length > 0 ? facets : undefined,
		embedding,
	};
}
