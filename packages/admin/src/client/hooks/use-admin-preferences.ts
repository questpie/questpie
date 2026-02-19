import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
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
	return ["adminPreferences", userId, key] as const;
}

/**
 * Query options factory for admin preference.
 * Can be used with TanStack Query's prefetching or with useSuspenseQuery.
 *
 * @param client - client instance
 * @param userId - User ID (required for query to work)
 * @param key - Preference key
 *
 * @example
 * ```ts
 * // Prefetch in loader
 * await queryClient.ensureQueryData(
 *   getAdminPreferenceQueryOptions(client, userId, "viewState:posts")
 * );
 * ```
 */
export function getAdminPreferenceQueryOptions<T>(
	client: any,
	userId: string | undefined,
	key: string,
) {
	return {
		queryKey: getAdminPreferenceQueryKey(userId, key),
		queryFn: async (): Promise<T | null> => {
			if (!userId) return null;

			const result = await client.collections.adminPreferences.findOne({
				where: { userId, key },
			});

			return (result?.value as T) ?? null;
		},
		enabled: !!client && !!userId,
		staleTime: 30 * 1000, // 30 seconds
	};
}

/**
 * Admin Preference entity from the database
 */
export interface AdminPreference<T = unknown> {
	id: string;
	userId: string;
	key: string;
	value: T;
	createdAt: string;
	updatedAt: string;
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
		queryKey: ["adminPreferences", user?.id, key],
		queryFn: async (): Promise<T | null> => {
			if (!user?.id) return null;

			const result = await client.collections.adminPreferences.findOne({
				where: { userId: user.id, key },
			});

			return (result?.value as T) ?? null;
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
			if (!collections?.adminPreferences) {
				throw new Error(
					"adminPreferences collection not available. Make sure to use adminModule in your app setup.",
				);
			}

			// Try to find existing preference
			const existing = await collections.adminPreferences.findOne({
				where: { userId: user.id, key },
			});

			if (existing) {
				// Update existing
				return collections.adminPreferences.update({
					id: existing.id,
					data: { value },
				});
			}
			// Create new
			return collections.adminPreferences.create({
				userId: user.id,
				key,
				value,
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["adminPreferences", user?.id, key],
			});
		},
	});
}

/**
 * Hook to delete an admin preference
 *
 * @param key - Preference key (e.g., "viewState:posts")
 * @returns Mutation for deleting the preference
 *
 * @example
 * ```tsx
 * const { mutate: deletePreference } = useDeleteAdminPreference("viewState:posts");
 *
 * const handleReset = () => {
 *   deletePreference();
 * };
 * ```
 */
export function useDeleteAdminPreference(key: string) {
	const client = useAdminStore((s) => s.client);
	const user = useCurrentUser();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			if (!user?.id) {
				throw new Error("User must be logged in to delete preferences");
			}

			const collections = client?.collections as
				| Record<string, any>
				| undefined;
			if (!collections?.adminPreferences) {
				throw new Error(
					"adminPreferences collection not available. Make sure to use adminModule in your app setup.",
				);
			}

			// Find existing preference
			const existing = await collections.adminPreferences.findOne({
				where: { userId: user.id, key },
			});

			if (existing) {
				return collections.adminPreferences.delete({ id: existing.id });
			}

			return null;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["adminPreferences", user?.id, key],
			});
		},
	});
}

// ============================================================================
// Suspense Hook
// ============================================================================

/**
 * Suspense-enabled hook to fetch admin preference.
 *
 * Uses useSuspenseQuery so the component will suspend until data is loaded.
 * Must be used within a Suspense boundary and requires userId to be known.
 *
 * @param key - Preference key (e.g., "viewState:posts")
 * @param userId - User ID (must be available - use after session is loaded)
 *
 * @example
 * ```tsx
 * function ViewStateInner({ collection, userId }: Props) {
 *   // This will suspend until preference is loaded
 *   const { data: storedConfig } = useSuspenseAdminPreference<ViewConfiguration>(
 *     `viewState:${collection}`,
 *     userId
 *   );
 *
 *   // storedConfig is guaranteed to be loaded (may be null if not found)
 * }
 *
 * // Wrap with Suspense
 * <Suspense fallback={<Loading />}>
 *   <ViewStateInner collection="posts" userId={user.id} />
 * </Suspense>
 * ```
 */
export function useSuspenseAdminPreference<T = unknown>(
	key: string,
	userId: string,
) {
	const client = useAdminStore((s) => s.client);

	return useSuspenseQuery<T | null>({
		queryKey: getAdminPreferenceQueryKey(userId, key),
		queryFn: async () => {
			const result = await client.collections.adminPreferences.findOne({
				where: { userId, key },
			});

			return (result?.value as T) ?? null;
		},
	});
}
