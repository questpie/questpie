/**
 * Index Records Job
 *
 * Background job for batch indexing records to the search service.
 * Used for async/non-blocking search indexing.
 *
 * @example
 * ```ts
 * // Dispatch batch indexing
 * await app.queue['index-records'].publish({
 *   items: [
 *     { collection: 'posts', recordId: '123' },
 *     { collection: 'posts', recordId: '456' },
 *   ],
 * });
 * ```
 */

import { z } from "zod";

import type { Questpie } from "#questpie/server/config/questpie.js";
import type { Locale } from "#questpie/server/config/types.js";

import { job } from "../integrated/queue/job.js";
import {
	buildIndexParams,
	resolveAutomaticSearchableConfig,
} from "../integrated/search/index-params.js";
import type {
	IndexParams,
	SearchableConfig,
} from "../integrated/search/types.js";

/**
 * Schema for index records job payload
 */
const indexRecordsSchema = z.object({
	/**
	 * Items to index - collection name and record ID pairs
	 */
	items: z.array(
		z.object({
			collection: z.string(),
			recordId: z.string(),
		}),
	),
});

type IndexRecordsPayload = z.infer<typeof indexRecordsSchema>;

/**
 * Minimal structural slice of the Questpie app instance this job reaches for
 * (the job handler ctx exposes `app` via extractAppServices). Lets us resolve
 * the configured locales + each collection's declarative `searchable` config
 * without an `as any` cast on the app itself.
 */
interface AppIndexSurface {
	getLocales?: () => Promise<Locale[]>;
	getCollectionConfig?: (
		name: string,
	) => { state?: { searchable?: SearchableConfig | false } } | undefined;
	config?: { locale?: { defaultLocale?: string } };
}

/**
 * Index records job definition
 *
 * This job indexes records to the search service in batches.
 * It fetches all locale versions of each record and indexes them.
 */
const indexRecordsJob = job({
	name: "index-records",
	schema: indexRecordsSchema,
	options: {
		retryLimit: 3,
		retryDelay: 30,
		retryBackoff: true,
	},
	handler: async (ctx) => {
		// Core-internal: cast to access services populated by extractAppServices at runtime
		const { payload } = ctx;
		const search = (ctx as any).search as Questpie<any>["search"] | undefined;
		const collections = (ctx as any).collections as
			| Record<string, any>
			| undefined;
		const app = ((ctx as any).app ?? {}) as AppIndexSurface;

		if (!search) {
			console.warn("[index-records] Search service not configured, skipping");
			return;
		}

		// Resolve configured locales declaratively (no hardcoded list).
		const locales = (await app.getLocales?.()) ?? [{ code: "en" }];
		const localeCodes = locales.map((l) => l.code);
		const defaultLocale = app.config?.locale?.defaultLocale ?? "en";

		// Batch all index operations
		const indexOperations: IndexParams[] = [];

		for (const { collection, recordId } of payload.items) {
			// Get collection CRUD API
			const collectionApi = collections?.[collection];
			if (!collectionApi) {
				console.warn(
					`[index-records] Collection '${collection}' not found, skipping`,
				);
				continue;
			}

			// Resolve the collection's declarative `searchable` config once
			// per collection so content/metadata/facets/embedding are populated.
			const searchable =
				app.getCollectionConfig?.(collection)?.state?.searchable;
			if (!resolveAutomaticSearchableConfig(searchable)) continue;

			// Index ALL locales for this record
			for (const locale of localeCodes) {
				try {
					// Fetch localized version of the record
					const record = await collectionApi.findOne({
						where: { id: recordId },
						locale,
						localeFallback: false,
						populate: false,
					});

					if (!record) continue;

					const params = await buildIndexParams(record, {
						collection,
						locale,
						searchable,
						app,
						defaultLocale,
					});

					if (params) indexOperations.push(params);
				} catch (error) {
					console.warn(
						`[index-records] Failed to fetch ${collection}:${recordId} for locale ${locale}:`,
						error,
					);
				}
			}
		}

		// Batch insert to search index
		if (indexOperations.length > 0) {
			await search.indexBatch(indexOperations);
		}
	},
});

export { indexRecordsJob, indexRecordsSchema, type IndexRecordsPayload };
export default indexRecordsJob;
