/**
 * Index Records Job
 *
 * Background job for batch indexing records to the search service.
 * Used for async/non-blocking search indexing.
 *
 * @example
 * ```ts
 * // Dispatch batch indexing
 * await cms.queue['index-records'].publish({
 *   items: [
 *     { collection: 'posts', recordId: '123' },
 *     { collection: 'posts', recordId: '456' },
 *   ],
 * });
 * ```
 */

import { z } from "zod";
import { job } from "#questpie/server/integrated/queue/job.js";
import type { Questpie } from "#questpie/server/config/cms.js";

/**
 * Schema for index records job payload
 */
export const indexRecordsSchema = z.object({
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

export type IndexRecordsPayload = z.infer<typeof indexRecordsSchema>;

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
export const indexRecordsJob = job({
  name: "index-records",
  schema: indexRecordsSchema,
  options: {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
  },
  handler: async ({ payload, app }) => {
    const cms = app as Questpie<any>;

    if (!cms?.search) {
      console.warn("[index-records] Search service not configured, skipping");
      return;
    }

    // Get configured locales (or default to 'en')
    const locales = await cms.getLocales();
    const localeCodes = locales.map((l) => l.code);
    const _defaultLocale = cms.config.locale?.defaultLocale || "en";

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
      // Get collection config
      const collectionConfig = cms.getCollections()[collection];
      if (!collectionConfig) {
        console.warn(
          `[index-records] Collection '${collection}' not found, skipping`,
        );
        continue;
      }

      const state = (collectionConfig as any).state;

      // Skip if explicitly disabled
      if (state.searchable === false) continue;
      if (state.searchable?.disabled) continue;
      if (state.searchable?.manual) continue;

      // Index ALL locales for this record
      for (const locale of localeCodes) {
        try {
          // Fetch localized version of the record
          const record = await cms.api.collections[collection].findOne({
            where: { id: recordId },
            locale,
            localeFallback: false,
            populate: false,
          });

          if (!record) continue;

          // Extract title
          const title = record._title || record.id;

          // Extract content
          let content: string | undefined;
          if (
            state.searchable &&
            typeof state.searchable === "object" &&
            state.searchable.content
          ) {
            content = state.searchable.content(record) || undefined;
          } else {
            content = generateAutoContent(record) || undefined;
          }

          // Extract metadata
          let metadata: Record<string, any> | undefined;
          if (
            state.searchable &&
            typeof state.searchable === "object" &&
            state.searchable.metadata
          ) {
            metadata = state.searchable.metadata(record);
          }

          indexOperations.push({
            collection,
            recordId,
            locale,
            title,
            content,
            metadata,
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
      await cms.search.indexBatch(indexOperations);
    }
  },
});
