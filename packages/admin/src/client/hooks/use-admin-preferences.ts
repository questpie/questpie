import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminStore } from "../runtime/provider.js";
import { useCurrentUser } from "./use-current-user.js";

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
    queryKey: ["admin_preferences", user?.id, key],
    queryFn: async (): Promise<T | null> => {
      if (!user?.id) return null;

      const result = await client.collections.admin_preferences.findOne({
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
      if (!collections?.admin_preferences) {
        throw new Error(
          "admin_preferences collection not available. Make sure to use adminModule in your CMS setup.",
        );
      }

      // Try to find existing preference
      const existing = await collections.admin_preferences.findOne({
        where: { userId: user.id, key },
      });

      if (existing) {
        // Update existing
        return collections.admin_preferences.update({
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
      if (!collections?.admin_preferences) {
        throw new Error(
          "admin_preferences collection not available. Make sure to use adminModule in your CMS setup.",
        );
      }

      // Find existing preference
      const existing = await collections.admin_preferences.findOne({
        where: { userId: user.id, key },
      });

      if (existing) {
        return collections.admin_preferences.delete({ id: existing.id });
      }

      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin_preferences", user?.id, key],
      });
    },
  });
}
