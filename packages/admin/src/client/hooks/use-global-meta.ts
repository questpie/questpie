/**
 * Hook for fetching global metadata from the backend
 *
 * Used to get introspection info about globals like:
 * - Whether timestamps are enabled
 * - Whether versioning is enabled
 * - Localized fields
 * - Virtual fields
 */

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { GlobalMeta } from "questpie/client";

import { selectClient, useAdminStore } from "../runtime";

type ResolvedGlobalNames = string;

/**
 * Hook to fetch global metadata from the backend
 *
 * Returns metadata useful for building dynamic UIs:
 * - timestamps: Whether createdAt/updatedAt are enabled
 * - versioning: Whether versioning is enabled
 * - localizedFields: Fields that support i18n
 * - virtualFields: Fields that are computed
 *
 * @example
 * ```tsx
 * const { data: meta } = useGlobalMeta("siteSettings");
 *
 * if (meta?.timestamps) {
 *   console.log("Timestamps enabled for this global");
 * }
 * ```
 */
export function useGlobalMeta<K extends ResolvedGlobalNames>(
	global: K,
	queryOptions?: Omit<UseQueryOptions<GlobalMeta>, "queryKey" | "queryFn">,
) {
	const client = useAdminStore(selectClient);

	return useQuery<GlobalMeta>({
		queryKey: getGlobalMetaQueryKey(global),
		queryFn: async () => {
			return (client as any).globals[global].meta();
		},
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		...queryOptions,
	});
}

/**
 * Query key for global meta
 * Useful for prefetching or invalidation
 */
function getGlobalMetaQueryKey(global: string) {
	return ["questpie", "globals", global, "meta"] as const;
}

/**
 * Query options factory for global metadata
 * Can be used with TanStack Query's prefetching in loaders or with useSuspenseQuery
 *
 * @example
 * ```ts
 * // In TanStack Start loader
 * export const Route = createFileRoute("/admin/globals/:name")({
 *   loader: async ({ context, params }) => {
 *     await context.queryClient.ensureQueryData(
 *       getGlobalMetaQueryOptions(params.name, context.client)
 *     );
 *   },
 * });
 * ```
 */
export function getGlobalMetaQueryOptions(global: string, client: any) {
	return {
		queryKey: getGlobalMetaQueryKey(global),
		queryFn: async (): Promise<GlobalMeta> => {
			return client.globals[global].meta();
		},
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
	};
}
