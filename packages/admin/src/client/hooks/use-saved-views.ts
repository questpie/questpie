import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SavedView } from "../components/filter-builder/types.js";
import { useAdminStore } from "../runtime/provider.js";

/**
 * Hook to fetch saved views for a collection
 *
 * Note: This hook requires the `adminModule` to be used in your app setup.
 * If admin_saved_views collection is not available, returns empty array.
 */
export function useSavedViews(collectionName: string, userId?: string) {
	const client = useAdminStore((s) => s.client);

	return useQuery({
		queryKey: ["admin_saved_views", collectionName, userId],
		queryFn: async (): Promise<{ docs: SavedView[] }> => {
			// Check if the collection exists on the client
			const collections = client?.collections as
				| Record<string, any>
				| undefined;
			if (!collections?.admin_saved_views) {
				return { docs: [] };
			}

			const where = userId ? { collectionName, userId } : { collectionName };
			const result = await collections.admin_saved_views.find({ where });
			return { docs: (result?.docs ?? []) as SavedView[] };
		},
		enabled: !!client,
	});
}

/**
 * Hook to save a new view
 */
export function useSaveView(collectionName: string, userId?: string) {
	const client = useAdminStore((s) => s.client);
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: {
			name: string;
			configuration: SavedView["configuration"];
			userId?: string;
		}) => {
			const collections = client?.collections as
				| Record<string, any>
				| undefined;
			if (!collections?.admin_saved_views) {
				throw new Error(
					"admin_saved_views collection not available. Make sure to use the adminModule in your app setup.",
				);
			}

			return collections.admin_saved_views.create({
				...data,
				collectionName,
				userId: data.userId || userId || "anonymous",
				isDefault: false,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["admin_saved_views", collectionName, userId],
			});
		},
	});
}

/**
 * Hook to delete a view
 */
export function useDeleteSavedView(collectionName: string, userId?: string) {
	const client = useAdminStore((s) => s.client);
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (viewId: string) => {
			const collections = client?.collections as
				| Record<string, any>
				| undefined;
			if (!collections?.admin_saved_views) {
				throw new Error(
					"admin_saved_views collection not available. Make sure to use the adminModule in your app setup.",
				);
			}

			return collections.admin_saved_views.delete({ id: viewId });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["admin_saved_views", collectionName, userId],
			});
		},
	});
}
