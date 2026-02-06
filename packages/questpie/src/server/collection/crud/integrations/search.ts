/**
 * Search Integration Utilities
 *
 * Functions for indexing and removing records from search services.
 * Used by CRUD operations for automatic search indexing.
 *
 * By default, ALL collections are auto-indexed using:
 * - Title: `_title` field or `id` fallback
 * - Content: auto-generated "fieldName: value" pairs from record fields
 *
 * Opt-out with `.searchable(false)` or `.searchable({ disabled: true })`
 *
 * ## Async Indexing
 *
 * If the `index-records` job is configured in the queue, indexing will be:
 * 1. Debounced (100ms) to batch multiple updates
 * 2. Processed asynchronously via the queue
 * 3. Index ALL locales, not just the current one
 *
 * If no queue is configured, indexing falls back to synchronous mode.
 */

import type { Column, SQL } from "drizzle-orm";
import type { CollectionBuilderState } from "#questpie/server/collection/builder/types.js";
import { normalizeContext } from "#questpie/server/collection/crud/shared/index.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/cms.js";

/** Title expression for SQL queries - resolved column or SQL expression */
type TitleExpressionSQL = SQL | Column | null;

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
 * Creates "fieldName: value" pairs for primitive fields
 */
function generateAutoContent(record: any): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    // Skip excluded fields
    if (EXCLUDED_CONTENT_FIELDS.has(key)) continue;

    // Skip null/undefined values
    if (value == null) continue;

    // Skip objects and arrays (complex nested data)
    if (typeof value === "object") continue;

    // Add primitive values as "fieldName: value"
    parts.push(`${key}: ${String(value)}`);
  }

  return parts.join(", ");
}

/**
 * Check if search indexing is disabled for this collection
 */
function isSearchDisabled(state: CollectionBuilderState): boolean {
  // Explicitly disabled via .searchable(false)
  if (state.searchable === false) return true;

  // Explicitly disabled via .searchable({ disabled: true })
  if (state.searchable?.disabled) return true;

  // Manual mode - user controls indexing via hooks
  if (state.searchable?.manual) return true;

  return false;
}

// ============================================================================
// Async Indexing with Debounce
// ============================================================================

/**
 * Pending items waiting to be indexed via queue
 * Key: "collection:recordId"
 */
const pendingIndexItems = new Map<
  string,
  { collection: string; recordId: string }
>();

/** Timeout handle for debounced flush */
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

/** Debounce delay in milliseconds */
const DEBOUNCE_DELAY_MS = 100;

/**
 * Check if async indexing is available
 * Returns true if queue has the index-records job configured
 */
function isAsyncIndexingAvailable(cms: Questpie<any>): boolean {
  if (!cms.queue) return false;

  // Check if index-records job exists on the queue client
  return typeof (cms.queue as any)["index-records"]?.publish === "function";
}

/**
 * Flush pending index items to the queue
 */
async function flushPendingItems(cms: Questpie<any>): Promise<void> {
  if (pendingIndexItems.size === 0) return;

  const items = Array.from(pendingIndexItems.values());
  pendingIndexItems.clear();

  try {
    await (cms.queue as any)["index-records"].publish({ items });
  } catch (error) {
    console.error("[Search] Failed to dispatch index-records job:", error);
    // Items are lost - could implement retry logic here if needed
  }
}

/**
 * Schedule an item for async indexing with debouncing
 */
function scheduleAsyncIndex(
  cms: Questpie<any>,
  collection: string,
  recordId: string,
): void {
  const key = `${collection}:${recordId}`;
  pendingIndexItems.set(key, { collection, recordId });

  // Clear existing timeout
  if (flushTimeout) {
    clearTimeout(flushTimeout);
  }

  // Schedule new flush
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flushPendingItems(cms).catch((err) => {
      console.error("[Search] Error in debounced flush:", err);
    });
  }, DEBOUNCE_DELAY_MS);
}

// ============================================================================
// Sync Indexing (Fallback / All Locales)
// ============================================================================

/**
 * Synchronously index a single record for a single locale
 */
async function indexRecordSync(
  record: any,
  locale: string,
  state: CollectionBuilderState,
  cms: Questpie<any>,
  defaultLocale: string,
): Promise<void> {
  // Extract title: use _title field or fallback to id
  const title = record._title || record.id;

  // Extract content: custom function or auto-generated
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

  // Extract metadata (optional - only from custom config)
  let metadata: Record<string, any> | undefined;
  if (
    state.searchable &&
    typeof state.searchable === "object" &&
    state.searchable.metadata
  ) {
    metadata = state.searchable.metadata(record);
  }

  // Generate embeddings (optional - only from custom config)
  let embedding: number[] | undefined;
  if (
    state.searchable &&
    typeof state.searchable === "object" &&
    state.searchable.embeddings
  ) {
    const searchableContext = {
      cms,
      locale,
      defaultLocale,
    };
    embedding = await state.searchable.embeddings(record, searchableContext);
  }

  // Index to search
  await cms.search.index({
    collection: state.name,
    recordId: record.id,
    locale,
    title,
    content,
    metadata,
    embedding,
  });
}

/**
 * Synchronously index a record for ALL locales
 * Used when async indexing is not available
 */
async function indexAllLocalesSync(
  record: any,
  state: CollectionBuilderState,
  cms: Questpie<any>,
  defaultLocale: string,
): Promise<void> {
  const locales = await cms.getLocales();

  for (const localeObj of locales) {
    const locale = localeObj.code;

    try {
      // Fetch localized version of the record
      const crud = cms.api.collections[state.name];
      if (!crud) continue;

      const localizedRecord = await crud.findOne({
        where: { id: record.id },
        locale,
        localeFallback: false,
        populate: false,
      });

      if (!localizedRecord) continue;

      await indexRecordSync(localizedRecord, locale, state, cms, defaultLocale);
    } catch (error) {
      console.warn(
        `[Search] Failed to index ${state.name}:${record.id} for locale ${locale}:`,
        error,
      );
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Options for search indexing
 */
export interface IndexToSearchOptions {
  /** CMS instance */
  cms: Questpie<any>;
  /** Collection builder state */
  state: CollectionBuilderState;
  /** Function to get title expression */
  getTitle?: (context: any) => TitleExpressionSQL;
}

/**
 * Index record to search service
 * Called after create/update operations
 *
 * Behavior:
 * 1. If `index-records` job is configured: Debounced async indexing via queue
 *    (indexes ALL locales in the background)
 * 2. Otherwise: Sync indexing for ALL locales
 *
 * @param record - The record to index
 * @param context - CRUD context
 * @param options - Indexing options
 */
export async function indexToSearch(
  record: any,
  context: CRUDContext,
  options: IndexToSearchOptions,
): Promise<void> {
  const { cms, state } = options;

  // Skip if no CMS instance or no search service
  if (!cms?.search) return;

  // Skip if search is explicitly disabled
  if (isSearchDisabled(state)) return;

  const normalized = normalizeContext(context);

  // Check if async indexing is available
  if (isAsyncIndexingAvailable(cms)) {
    // Use debounced async indexing (indexes all locales in background)
    scheduleAsyncIndex(cms, state.name, record.id);
  } else {
    // Fallback: synchronous indexing for all locales
    await indexAllLocalesSync(record, state, cms, normalized.defaultLocale);
  }
}

/**
 * Options for search removal
 */
export interface RemoveFromSearchOptions {
  /** CMS instance */
  cms: Questpie<any>;
  /** Collection builder state */
  state: CollectionBuilderState;
}

/**
 * Remove record from search index
 * Called after delete operations
 *
 * Removes from index for ALL collections unless explicitly disabled.
 * Note: Removal is always synchronous (no debouncing needed)
 *
 * @param recordId - The record ID to remove
 * @param context - CRUD context
 * @param options - Removal options
 */
export async function removeFromSearch(
  recordId: string,
  _context: CRUDContext,
  options: RemoveFromSearchOptions,
): Promise<void> {
  const { cms, state } = options;

  // Skip if no CMS instance or no search service
  if (!cms?.search) return;

  // Skip if search is explicitly disabled
  if (isSearchDisabled(state)) return;

  // Remove from search index (all locales - don't pass locale to remove all)
  await cms.search.remove({
    collection: state.name,
    recordId,
    // Note: Not passing locale removes ALL locales for this record
  });
}

/**
 * Force flush any pending index items immediately
 * Useful for tests or graceful shutdown
 */
export async function flushPendingSearchIndexes(
  cms: Questpie<any>,
): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }
  await flushPendingItems(cms);
}
