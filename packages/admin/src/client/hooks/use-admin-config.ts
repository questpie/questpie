/**
 * Hook for fetching server-side admin config
 */

import {
	type UseQueryOptions,
	useQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";

import { selectClient, useAdminStore } from "../runtime";
import type { AdminConfigResponse } from "../types/admin-config";

/** Query key for admin config */
const adminConfigQueryKey = ["questpie", "admin", "config"] as const;
const publicAdminConfigQueryKey = [
	"questpie",
	"admin",
	"public-config",
] as const;

/** Query options factory for admin config — can be used for prefetching in loaders */
export function getAdminConfigQueryOptions(client: unknown) {
	return {
		queryKey: adminConfigQueryKey,
		queryFn: async (): Promise<AdminConfigResponse> => {
			if (!client || !(client as any).routes) {
				return {};
			}
			return (client as any).routes.getAdminConfig();
		},
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
	};
}

/** Query options for auth-page-safe public branding/bootstrap config. */
export function getPublicAdminConfigQueryOptions(client: unknown) {
	return {
		queryKey: publicAdminConfigQueryKey,
		queryFn: async (): Promise<AdminConfigResponse> => {
			if (!client || !(client as any).routes) {
				return {};
			}
			const routes = (client as any).routes;
			if (typeof routes.getPublicAdminConfig === "function") {
				return routes.getPublicAdminConfig();
			}
			return {};
		},
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
	};
}

/** Standard query hook - returns loading/error states */
export function useAdminConfig(
	queryOptions?: Omit<
		UseQueryOptions<AdminConfigResponse>,
		"queryKey" | "queryFn"
	>,
) {
	const client = useAdminStore(selectClient);

	return useQuery<AdminConfigResponse>({
		...getAdminConfigQueryOptions(client),
		...queryOptions,
	});
}

/** Suspense query hook - suspends until data is ready, no loading checks needed */
export function useSuspenseAdminConfig() {
	const client = useAdminStore(selectClient);

	return useSuspenseQuery<AdminConfigResponse>({
		...getAdminConfigQueryOptions(client),
	});
}
