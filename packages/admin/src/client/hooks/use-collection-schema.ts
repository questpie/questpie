/**
 * Hook for fetching collection schema from the backend
 *
 * Returns full introspection data including:
 * - Field schemas with metadata and validation
 * - Relations metadata
 * - Access control information for current user
 * - JSON Schema for client-side validation
 */

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { Questpie } from "questpie";
import type { CollectionSchema } from "questpie/client";
import type {
  RegisteredCMS,
  RegisteredCollectionNames,
} from "../builder/registry";
import { selectClient, useAdminStore } from "../runtime";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Resolved collection names (string if not registered)
 */
type ResolvedCollectionNames =
  RegisteredCMS extends Questpie<any> ? RegisteredCollectionNames : string;

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to fetch collection schema from the backend
 *
 * Returns full introspection data useful for building dynamic forms and UIs:
 * - fields: Complete field metadata including type, label, validation, admin config
 * - relations: Relation metadata with type, target collection(s), and keys
 * - access: Evaluated access control for the current user
 * - validation: JSON Schema for client-side validation
 * - options: Collection options (timestamps, softDelete, versioning)
 *
 * @example
 * ```tsx
 * const { data: schema } = useCollectionSchema("posts");
 *
 * // Build fields dynamically from schema
 * for (const [name, field] of Object.entries(schema?.fields ?? {})) {
 *   const FieldComponent = getFieldComponent(field.metadata.type);
 *   // Use field.metadata for rendering configuration
 * }
 *
 * // Check user access
 * if (schema?.access.operations.create.allowed) {
 *   // Show create button
 * }
 * ```
 */
export function useCollectionSchema<K extends ResolvedCollectionNames>(
  collection: K,
  queryOptions?: Omit<
    UseQueryOptions<CollectionSchema>,
    "queryKey" | "queryFn"
  >,
) {
  const client = useAdminStore(selectClient);

  return useQuery<CollectionSchema>({
    queryKey: getCollectionSchemaQueryKey(collection),
    queryFn: async () => {
      return (client as any).collections[collection].schema();
    },
    // Schema rarely changes, cache aggressively
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    ...queryOptions,
  });
}

/**
 * Query key for collection schema
 * Useful for prefetching or invalidation
 */
export function getCollectionSchemaQueryKey(collection: string) {
  return ["questpie", "collections", collection, "schema"] as const;
}
