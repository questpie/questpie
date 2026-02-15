import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { useQueryClient } from "@tanstack/react-query";
import {
	selectClient,
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
	const { locale } = useScopedLocale();
	const queryClient = useQueryClient();
	const queryOpts = createQuestpieQueryOptions(client as any, {
		keyPrefix,
		locale,
	});

	return { queryOpts, queryClient, locale, client } as const;
}
