import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAdminStore } from "../runtime/provider.js";
import { useCurrentUser } from "./use-current-user.js";

// ============================================================================
// Query Keys & Options
// ============================================================================

/**
 * Get query key for admin preference
 */
export function getAdminPreferenceQueryKey(
	userId: string | undefined,
	key: string,
) {
	return ["admin_preferences", userId, key] as const;
}

/**
 * Hook to fetch a single admin preference by key
 *
 * @param key - Preference key (e.g., "viewState:posts")
 * @returns Query result with preference data or null if not found
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useAdminPreference<ViewConfiguration>("viewState:posts");
 * if (isLoading) return <Loading />;
 * const viewConfig = data ?? defaultConfig;
 * ```
 */
export function useAdminPreference<T = unknown>(key: string) {
	const client = useAdminStore((s) => s.client);
	const user = useCurrentUser();

	return useQuery({
		queryKey: ["admin_preferences", user?.id, key],
		queryFn: async (): Promise<T | null> => {
			if (!user?.id) return null;

			const result = await (
				client.collections as any
			).admin_preferences.findOne({
				where: { userId: user.id, key },
			});

			return ((result as any)?.value as T) ?? null;
		},
		enabled: !!client && !!user?.id,
	});
}

/**
 * Hook to set an admin preference
 *
 * Creates or updates the preference for the current user.
 *
 * @param key - Preference key (e.g., "viewState:posts")
 * @returns Mutation for setting the preference
 *
 * @example
 * ```tsx
 * const { mutate: setPreference, isPending } = useSetAdminPreference<ViewConfiguration>("viewState:posts");
 *
 * const handleSave = () => {
 *   setPreference(viewConfig);
 * };
 * ```
 */
export function useSetAdminPreference<T = unknown>(key: string) {
	const client = useAdminStore((s) => s.client);
	const user = useCurrentUser();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (value: T) => {
			if (!user?.id) {
				throw new Error("User must be logged in to save preferences");
			}

			const collections = client?.collections as
				| Record<string, any>
				| undefined;
			if (!collections?.admin_preferences) {
				throw new Error(
					"admin_preferences collection not available. Make sure to use the adminModule in your app setup.",
				);
			}

			// Try to find existing preference
			const existing = await collections.admin_preferences.findOne({
				where: { userId: user.id, key },
			});

			if (existing) {
				// Update existing
				return collections.admin_preferences.updateById({
					id: existing.id,
					data: { value },
				});
			}
			// Create new
			return collections.admin_preferences.create({
				userId: user.id,
				key,
				value,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["admin_preferences", user?.id, key],
			});
		},
	});
}
