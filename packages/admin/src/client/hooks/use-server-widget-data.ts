/**
 * Hook for fetching widget data from server via fetchWidgetData RPC.
 * Used when a widget has hasFetchFn=true (server-side fetchFn).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { selectClient, useAdminStore } from "../runtime";

/**
 * Fetches widget data from server via the fetchWidgetData RPC endpoint.
 *
 * @param widgetId - The widget ID to fetch data for
 * @param options - Query options
 * @returns TanStack Query result with the widget data
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useServerWidgetData<{ count: number }>(
 *   "my-widget",
 *   { enabled: config.hasFetchFn }
 * );
 * ```
 */
export function useServerWidgetData<T = unknown>(
  widgetId: string,
  options?: { enabled?: boolean; refreshInterval?: number },
): UseQueryResult<T> {
  const client = useAdminStore(selectClient);

  return useQuery<T>({
    queryKey: ["widget", "serverData", widgetId],
    queryFn: () =>
      (client as any).rpc.fetchWidgetData({ widgetId }) as Promise<T>,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refreshInterval,
  });
}
