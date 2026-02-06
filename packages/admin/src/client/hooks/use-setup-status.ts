/**
 * Setup Status Hook
 *
 * Hook to check if the CMS setup is required (no users exist).
 * Useful for redirecting to setup page on first visit.
 */

import { useQuery } from "@tanstack/react-query";
import { selectClient, useAdminStore } from "../runtime/provider";

export interface SetupStatus {
  /** Whether setup is required (no users exist) */
  required: boolean;
}

/**
 * Check if CMS setup is required.
 *
 * Returns `required: true` if no users exist in the system,
 * meaning the setup page should be shown to create the first admin.
 *
 * @example
 * ```tsx
 * function App() {
 *   const { data, isLoading } = useSetupStatus();
 *
 *   if (isLoading) return <LoadingSpinner />;
 *
 *   if (data?.required) {
 *     return <Navigate to="/admin/setup" />;
 *   }
 *
 *   return <AdminPanel />;
 * }
 * ```
 */
export function useSetupStatus() {
  const client = useAdminStore(selectClient);

  return useQuery<SetupStatus>({
    queryKey: ["questpie", "setup-status"],
    queryFn: async () => {
      try {
        const result = await (client as any).rpc.isSetupRequired({});
        return { required: result.required };
      } catch {
        // If the function doesn't exist, setup is not required
        return { required: false };
      }
    },
    staleTime: 1000 * 60, // Cache for 1 minute
    retry: false,
  });
}
