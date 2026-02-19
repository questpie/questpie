import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { selectClient, useAdminStore, useScopedLocale } from "../runtime";

const DEFAULT_KEY_PREFIX = ["questpie", "collections"] as const;

/**
 * Shared hook that creates questpie query options with the current client and scoped locale.
 * Deduplicates the common pattern used across collection/global hooks.
 */
export function useQuestpieQueryOptions(
	keyPrefix: readonly string[] = DEFAULT_KEY_PREFIX,
) {
	const client = useAdminStore(selectClient);
	const { locale } = useScopedLocale();
	const queryClient = useQueryClient();
	const queryOpts = React.useMemo(
		() =>
			createQuestpieQueryOptions(client as any, {
				keyPrefix,
				locale,
			}),
		[client, locale, keyPrefix],
	);

	return { queryOpts, queryClient, locale, client } as const;
}
