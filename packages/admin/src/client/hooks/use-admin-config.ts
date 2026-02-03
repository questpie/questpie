/**
 * Hook for fetching server-side admin config
 */

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { selectClient, useAdminStore } from "../runtime";
import type { AdminConfigResponse } from "../types/admin-config";

export function useAdminConfig(
	queryOptions?: Omit<
		UseQueryOptions<AdminConfigResponse>,
		"queryKey" | "queryFn"
	>,
) {
	const client = useAdminStore(selectClient);

	return useQuery<AdminConfigResponse>({
		queryKey: ["questpie", "admin", "config"],
		queryFn: async () => {
			if (!client || !(client as any).functions?.getAdminConfig) {
				return {};
			}
			return (client as any).functions.getAdminConfig();
		},
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		...queryOptions,
	});
}
