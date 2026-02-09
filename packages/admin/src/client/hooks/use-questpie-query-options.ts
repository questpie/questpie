import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { useQueryClient } from "@tanstack/react-query";
import {
	selectClient,
	selectRealtime,
	useAdminStore,
	useScopedLocale,
} from "../runtime";

/**
 * Shared hook that creates questpie query options with the current client and scoped locale.
 * Deduplicates the common pattern used across collection/global hooks.
 */
export function useQuestpieQueryOptions(
	keyPrefix: readonly string[] = ["questpie", "collections"],
) {
	const client = useAdminStore(selectClient);
	const realtimeConfig = useAdminStore(selectRealtime);
	const { locale } = useScopedLocale();
	const queryClient = useQueryClient();
	const queryOpts = createQuestpieQueryOptions(client as any, {
		keyPrefix,
		locale,
		realtime: realtimeConfig.enabled
			? {
					baseUrl: realtimeConfig.basePath,
					enabled: realtimeConfig.enabled,
					withCredentials: true,
				}
			: undefined,
	});

	return { queryOpts, queryClient, locale, client } as const;
}
