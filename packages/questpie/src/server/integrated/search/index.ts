/**
 * Search Module
 *
 * Provides search functionality via adapter pattern.
 * Default adapter: PostgresSearchAdapter (FTS + trigram)
 */

// Adapters
export * from "./adapters/index.js";

// Table schema
export * from "./collection.js";
// Facet helpers
export * from "./facet-utils.js";
// Jobs
export * from "./jobs/index.js";
// Embedding Providers
export * from "./providers/index.js";
// Service wrapper
export { createSearchService, SearchServiceWrapper } from "./service.js";
// Types
export * from "./types.js";
