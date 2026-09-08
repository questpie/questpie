import {
	useInfiniteQuery,
	useSuspenseInfiniteQuery,
	type QueryClient,
} from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";

import type { GeneratedClientScope } from "#questpie/test-pagination";

export function useQueue(scope: GeneratedClientScope, cache: QueryClient) {
	const adapter = createQueryAdapter(scope, cache);
	const options = adapter.queries["tickets.queue"].infiniteOptions({
		first: 25,
		statuses: null,
		teamIds: null,
	});
	const ordinary = useInfiniteQuery(options);
	const suspense = useSuspenseInfiniteQuery(options);
	const selected = useInfiniteQuery({
		...options,
		select: (data) =>
			data.pages.flatMap((page) => page.nodes.map((ticket) => ticket.summary)),
	});
	ordinary.data?.pages[0]?.nodes[0]?.updatedAt.toISOString();
	suspense.data.pages[0]?.nodes[0]?.updatedAt.toISOString();
	ordinary.data?.pageParams[0]?.toUpperCase();
	suspense.data.pageParams[0]?.toUpperCase();
	cache.getQueryData(options.queryKey)?.pageParams[0]?.toUpperCase();
	selected.data?.[0]?.toUpperCase();
	// @ts-expect-error result is codec-decoded, not raw timestamp text
	ordinary.data?.pages[0]?.nodes[0]?.updatedAt.toUpperCase();
	// @ts-expect-error selected data is a string array
	void selected.data?.pages;
	// @ts-expect-error a handler's internal structural plan is not a public paging contract
	adapter.queries["tickets.detail"].infiniteOptions({ id: "example" });
	adapter.queries["tickets.queue"].infiniteOptions({
		first: 25,
		statuses: null,
		teamIds: null,
		// @ts-expect-error the generated continuation supplies this input
		after: null,
	});
}
