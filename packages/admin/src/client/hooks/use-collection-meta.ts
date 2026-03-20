/**
 * Hook for fetching collection metadata from the backend
 *
 * Used to get introspection info about collections like:
 * - Title field configuration (which field to display first)
 * - Whether timestamps are enabled
 * - Whether soft delete is enabled
 * - Localized fields
 * - Virtual fields
 */

import {
	type UseQueryOptions,
	useQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import type { Questpie } from "questpie";
import type { CollectionMeta } from "questpie/client";

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
 * Hook to fetch collection metadata from the backend
 *
 * Returns introspection info useful for building dynamic UIs:
 * - title.fieldName: The field to use as display title (instead of _title)
 * - title.type: "field" (sortable) or "virtual" (computed)
 * - timestamps: Whether createdAt/updatedAt are enabled
 * - softDelete: Whether soft delete is enabled
 * - localizedFields: Fields that support i18n
 *
 * @example
 * ```tsx
 * const { data: meta } = useCollectionMeta("posts");
 *
 * // Use title.fieldName instead of _title for first column
 * const firstColumn = meta?.title.fieldName || "_title";
 *
 * // Only show timestamps columns if enabled
 * if (meta?.timestamps) {
 *   columns.push("createdAt", "updatedAt");
 * }
 * ```
 */
export function useCollectionMeta<K extends ResolvedCollectionNames>(
	collection: K,
	queryOptions?: Omit<UseQueryOptions<CollectionMeta>, "queryKey" | "queryFn">,
) {
	const client = useAdminStore(selectClient);

	return useQuery<CollectionMeta>({
		queryKey: ["questpie", "collections", collection, "meta"],
		queryFn: async () => {
			return (client as any).collections[collection].meta();
		},
		// Meta rarely changes, cache aggressively
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
		...queryOptions,
	});
}

/**
 * Query key for collection meta
 * Useful for prefetching or invalidation
 */
function getCollectionMetaQueryKey(collection: string) {
	return ["questpie", "collections", collection, "meta"] as const;
}

// ============================================================================
// Query Options Factory
// ============================================================================

/**
 * Query options factory for collection metadata.
 * Can be used with TanStack Query's prefetching in loaders or with useSuspenseQuery.
 *
 * @example
 * ```ts
 * // In TanStack Start loader
 * export const Route = createFileRoute("/admin/collections/:name")({
 *   loader: async ({ context, params }) => {
 *     await context.queryClient.ensureQueryData(
 *       getCollectionMetaQueryOptions(params.name, context.client)
 *     );
 *   },
 * });
 * ```
 */
export function getCollectionMetaQueryOptions(collection: string, client: any) {
	return {
		queryKey: getCollectionMetaQueryKey(collection),
		queryFn: async (): Promise<CollectionMeta> => {
			return client.collections[collection].meta();
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
		gcTime: 30 * 60 * 1000, // 30 minutes
	};
}

// ============================================================================
// Suspense Hook
// ============================================================================

/**
 * Suspense-enabled hook to fetch collection metadata.
 *
 * Uses useSuspenseQuery so the component will suspend until data is loaded.
 * Must be used within a Suspense boundary.
 *
 * @example
 * ```tsx
 * function TableViewInner({ collection }: Props) {
 *   // This will suspend until meta is loaded
 *   const { data: meta } = useSuspenseCollectionMeta(collection);
 *
 *   // meta is guaranteed to be defined here
 *   const titleField = meta.title.fieldName;
 * }
 *
 * // Wrap with Suspense
 * <Suspense fallback={<Loading />}>
 *   <TableViewInner collection="posts" />
 * </Suspense>
 * ```
 */
export function useSuspenseCollectionMeta<K extends ResolvedCollectionNames>(
	collection: K,
) {
	const client = useAdminStore(selectClient);

	return useSuspenseQuery<CollectionMeta>(
		getCollectionMetaQueryOptions(collection, client),
	);
}
