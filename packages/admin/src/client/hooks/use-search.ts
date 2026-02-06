/**
 * Search Hook
 *
 * React hook for FTS-powered search using the CMS Search API.
 * Returns full records with search metadata (score, highlights, indexed title).
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { selectClient, useAdminStore, useScopedLocale } from "../runtime";

// ============================================================================
// Debounce Hook
// ============================================================================

/**
 * Hook to debounce a value
 *
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState("");
 * const debouncedSearch = useDebouncedValue(searchTerm, 300);
 * ```
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Facet definition for search queries
 */
export interface SearchFacetDefinition {
  field: string;
  limit?: number;
  sortBy?: "count" | "alpha";
}

/**
 * Search options for the hook
 */
export interface UseSearchOptions {
  /**
   * Collection to search in (required)
   */
  collection: string;

  /**
   * Search query string
   */
  query: string;

  /**
   * Additional metadata filters
   */
  filters?: Record<string, string | string[]>;

  /**
   * Result limit (default: 50)
   */
  limit?: number;

  /**
   * Result offset (default: 0)
   */
  offset?: number;

  /**
   * Include highlights (default: true)
   */
  highlights?: boolean;

  /**
   * Facets to retrieve
   */
  facets?: SearchFacetDefinition[];

  /**
   * Whether the query is enabled (default: true if query is non-empty)
   */
  enabled?: boolean;
}

/**
 * Search metadata attached to each result
 */
export interface SearchMeta {
  /** Relevance score from search */
  score: number;
  /** Highlighted snippets with <mark> tags */
  highlights?: {
    title?: string;
    content?: string;
  };
  /** Title as stored in search index */
  indexedTitle: string;
  /** Content preview from search index */
  indexedContent?: string;
}

/**
 * Populated search result - full record with search metadata
 */
export interface PopulatedSearchResult<T = Record<string, any>> {
  /** Full record data (spread at top level) */
  [key: string]: any;
  /** Collection name */
  _collection: string;
  /** Search metadata */
  _search: SearchMeta;
}

/**
 * Facet value with count
 */
export interface SearchFacetValue {
  value: string;
  count: number;
}

/**
 * Facet result
 */
export interface SearchFacetResult {
  field: string;
  values: SearchFacetValue[];
  stats?: {
    min: number;
    max: number;
  };
}

/**
 * Search response with populated records
 */
export interface SearchResponse<T = Record<string, any>> {
  /** Full records with search metadata */
  docs: PopulatedSearchResult<T>[];
  /** Total count (accurate after access filtering) */
  total: number;
  /** Facet results (if requested) */
  facets?: SearchFacetResult[];
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for FTS-powered collection search
 *
 * Returns full records directly with search metadata attached.
 * No need for a second CRUD fetch - records are populated server-side.
 *
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState("");
 * const debouncedSearch = useDebouncedValue(searchTerm, 300);
 *
 * const { data, isLoading } = useSearch({
 *   collection: "posts",
 *   query: debouncedSearch,
 *   limit: 50,
 * });
 *
 * // Use docs directly - they're full records!
 * const items = data?.docs ?? [];
 *
 * // Access search metadata
 * items.forEach(item => {
 *   console.log(item.title); // Full record field
 *   console.log(item._search.score); // Search score
 *   console.log(item._search.highlights?.title); // Highlighted title
 * });
 * ```
 */
export function useSearch<T = Record<string, any>>(
  options: UseSearchOptions,
  queryOptions?: Omit<
    UseQueryOptions<SearchResponse<T>>,
    "queryKey" | "queryFn"
  >,
) {
  const client = useAdminStore(selectClient);
  const { locale: contentLocale } = useScopedLocale();

  const {
    collection,
    query,
    filters,
    limit = 50,
    offset = 0,
    highlights = true,
    facets,
    enabled,
  } = options;

  // Determine if search should be enabled
  // By default, enabled when query has content (after trimming)
  const isEnabled = enabled ?? query?.trim().length > 0;

  return useQuery<SearchResponse<T>>({
    queryKey: [
      "questpie",
      "search",
      collection,
      query,
      filters,
      limit,
      offset,
      contentLocale,
    ],
    queryFn: async () => {
      // Use the client's search API
      const response = await (client as any).search.search({
        query,
        collections: [collection],
        locale: contentLocale,
        limit,
        offset,
        filters,
        highlights,
        facets,
      });
      return response;
    },
    enabled: isEnabled,
    // Keep previous data while fetching new results for smoother UX
    placeholderData: (prev) => prev,
    // Stale time for search results (30 seconds)
    staleTime: 30 * 1000,
    ...queryOptions,
  });
}

/**
 * Hook for reindexing a collection
 *
 * @example
 * ```tsx
 * const { reindex } = useReindex();
 * await reindex("posts");
 * ```
 */
export function useReindex() {
  const client = useAdminStore(selectClient);

  return {
    reindex: async (collection: string) => {
      return (client as any).search.reindex(collection);
    },
  };
}

// ============================================================================
// Global Search Hook
// ============================================================================

/**
 * Search options for global search (across all collections)
 */
export interface UseGlobalSearchOptions {
  /**
   * Search query string
   */
  query: string;

  /**
   * Result limit (default: 10)
   */
  limit?: number;

  /**
   * Include highlights (default: true)
   */
  highlights?: boolean;

  /**
   * Whether the query is enabled (default: true if query length >= 2)
   */
  enabled?: boolean;
}

/**
 * Hook for FTS-powered search across ALL collections
 *
 * Used by the global search (Cmd+K) to find records across the entire CMS.
 *
 * @example
 * ```tsx
 * const [query, setQuery] = useState("");
 * const debouncedQuery = useDebouncedValue(query, 300);
 *
 * const { data, isLoading } = useGlobalSearch({
 *   query: debouncedQuery,
 *   limit: 10,
 * });
 *
 * // Show results grouped by collection
 * data?.docs.forEach(item => {
 *   console.log(`${item._collection}: ${item._search.indexedTitle}`);
 * });
 * ```
 */
export function useGlobalSearch<T = Record<string, any>>(
  options: UseGlobalSearchOptions,
  queryOptions?: Omit<
    UseQueryOptions<SearchResponse<T>>,
    "queryKey" | "queryFn"
  >,
) {
  const client = useAdminStore(selectClient);
  const { locale: contentLocale } = useScopedLocale();

  const { query, limit = 10, highlights = true, enabled } = options;

  // Require at least 2 characters by default
  const isEnabled = enabled ?? query?.trim().length >= 2;

  return useQuery<SearchResponse<T>>({
    queryKey: ["questpie", "global-search", query, limit, contentLocale],
    queryFn: async () => {
      // Search across ALL collections (no collections filter)
      const response = await (client as any).search.search({
        query,
        // collections: undefined - search all
        locale: contentLocale,
        limit,
        highlights,
      });
      return response;
    },
    enabled: isEnabled,
    // Keep previous data while fetching for smoother UX
    placeholderData: (prev) => prev,
    // Short stale time for global search
    staleTime: 10 * 1000,
    ...queryOptions,
  });
}
