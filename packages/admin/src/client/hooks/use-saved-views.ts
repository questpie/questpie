import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminStore } from "../runtime/provider.js";
import type { SavedView } from "../components/filter-builder/types.js";

/**
 * Hook to fetch saved views for a collection
 *
 * Note: This hook requires the adminModule to be used in your CMS setup.
 * If adminSavedViews collection is not available, returns empty array.
 */
export function useSavedViews(collectionName: string) {
  const client = useAdminStore((s) => s.client);

  return useQuery({
    queryKey: ["adminSavedViews", collectionName],
    queryFn: async (): Promise<{ docs: SavedView[] }> => {
      // Check if the collection exists on the client
      const collections = client?.collections as
        | Record<string, any>
        | undefined;
      if (!collections?.adminSavedViews) {
        return { docs: [] };
      }

      const result = await collections.adminSavedViews.find({
        where: { collectionName },
      });
      return { docs: (result?.docs ?? []) as SavedView[] };
    },
    enabled: !!client,
  });
}

/**
 * Hook to save a new view
 */
export function useSaveView(collectionName: string) {
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
      if (!collections?.adminSavedViews) {
        throw new Error(
          "adminSavedViews collection not available. Make sure to use adminModule in your CMS setup.",
        );
      }

      return collections.adminSavedViews.create({
        data: {
          ...data,
          collectionName,
          userId: data.userId || "anonymous",
          isDefault: false,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["adminSavedViews", collectionName],
      });
    },
  });
}

/**
 * Hook to update an existing view
 */
export function useUpdateSavedView(collectionName: string) {
  const client = useAdminStore((s) => s.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<SavedView>;
    }) => {
      const collections = client?.collections as
        | Record<string, any>
        | undefined;
      if (!collections?.adminSavedViews) {
        throw new Error(
          "adminSavedViews collection not available. Make sure to use adminModule in your CMS setup.",
        );
      }

      return collections.adminSavedViews.update({ id, data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["adminSavedViews", collectionName],
      });
    },
  });
}

/**
 * Hook to delete a view
 */
export function useDeleteSavedView(collectionName: string) {
  const client = useAdminStore((s) => s.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (viewId: string) => {
      const collections = client?.collections as
        | Record<string, any>
        | undefined;
      if (!collections?.adminSavedViews) {
        throw new Error(
          "adminSavedViews collection not available. Make sure to use adminModule in your CMS setup.",
        );
      }

      return collections.adminSavedViews.delete({ id: viewId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["adminSavedViews", collectionName],
      });
    },
  });
}
