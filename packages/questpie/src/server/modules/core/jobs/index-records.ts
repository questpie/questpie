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
import { job } from "#questpie/server/integrated/queue/job.js";

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
 * Fields excluded from auto-generated search content
 */
const EXCLUDED_CONTENT_FIELDS = new Set([
	"id",
	"_title",
	"createdAt",
	"updatedAt",
	"deletedAt",
	"_locale",
	"_parentId",
]);

/**
 * Auto-generate searchable content from record fields
 */
function generateAutoContent(record: any): string {
	const parts: string[] = [];

	for (const [key, value] of Object.entries(record)) {
		if (EXCLUDED_CONTENT_FIELDS.has(key)) continue;
		if (value == null) continue;
		if (typeof value === "object") continue;
		parts.push(`${key}: ${String(value)}`);
	}

	return parts.join(", ");
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

		if (!search) {
			console.warn("[index-records] Search service not configured, skipping");
			return;
		}

		// Get configured locales (or default to 'en')
		const t = (ctx as any).t as ((key: string) => string) | undefined;
		// Default to 'en' locale when getLocales is not available
		const localeCodes = ["en"];

		// Batch all index operations
		const indexOperations: Array<{
			collection: string;
			recordId: string;
			locale: string;
			title: string;
			content?: string;
			metadata?: Record<string, any>;
		}> = [];

		for (const { collection, recordId } of payload.items) {
			// Get collection CRUD API
			const collectionApi = collections?.[collection];
			if (!collectionApi) {
				console.warn(
					`[index-records] Collection '${collection}' not found, skipping`,
				);
				continue;
			}

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

					// Extract title
					const title = record._title || record.id;

					// Extract content (auto-generate from fields)
					const content = generateAutoContent(record) || undefined;

					indexOperations.push({
						collection,
						recordId,
						locale,
						title,
						content,
					});
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
