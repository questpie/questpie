/**
 * Integrations Module
 *
 * Re-exports all integration utilities for CRUD operations.
 * These functions integrate with external services like search.
 */

export {
	flushPendingSearchIndexes,
	type IndexToSearchOptions,
	indexToSearch,
	type RemoveFromSearchOptions,
	removeFromSearch,
} from "./search.js";
