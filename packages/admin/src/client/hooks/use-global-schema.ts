/**
 * Hook for fetching global schema from the backend
 *
 * Returns introspection data including fields, access, and validation.
 */

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { GlobalSchema } from "questpie";

import { selectClient, useAdminStore } from "../runtime";

// ==========================================================================
// Type Helpers
// ==========================================================================

/**
 * Resolved global names (string if not registered)
 */
type ResolvedGlobalNames = string;

// ==========================================================================
// Hook
// ==========================================================================

export function useGlobalSchema<K extends ResolvedGlobalNames>(
	global: K,
	queryOptions?: Omit<UseQueryOptions<GlobalSchema>, "queryKey" | "queryFn">,
) {
	const client = useAdminStore(selectClient);

	return useQuery<GlobalSchema>({
		queryKey: getGlobalSchemaQueryKey(global),
		queryFn: async () => {
			return (client as any).globals[global].schema();
		},
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		...queryOptions,
	});
}

function getGlobalSchemaQueryKey(global: string) {
	return ["questpie", "globals", global, "schema"] as const;
}
