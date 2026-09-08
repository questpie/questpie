import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
	type QueryClient,
} from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";

import type { GeneratedClientScope as PageScope } from "#factory-seam/page-client";
import type { GeneratedClientScope } from "#questpie/client";

export function useFactory(
	scope: GeneratedClientScope,
	pages: PageScope,
	cache: QueryClient,
	failure: unknown,
) {
	const adapter = createQueryAdapter(scope, cache);
	const options = adapter.queries["tasks.detail"].options({
		id: "example",
		asOf: new Date(),
	});
	const query = useQuery(options);
	const suspense = useSuspenseQuery(options);
	query.data?.updatedAt.toISOString();
	suspense.data?.updatedAt.toISOString();
	cache.getQueryData(options.queryKey)?.updatedAt.toISOString();
	// @ts-expect-error generated timestamps remain decoded Dates
	query.data?.updatedAt.toUpperCase();
	// @ts-expect-error no caller-authored operation names
	adapter.queries["tasks.missing"];
	// @ts-expect-error no public canonical descriptor material
	scope.canonicalScope;
	// @ts-expect-error no public projection getter
	scope.getClientProjection();
	createQueryAdapter(
		// @ts-expect-error a lookalike scope is not the generated opaque contract
		{ queries: scope.queries, mutations: scope.mutations },
		cache,
	);
	const mutation = adapter.mutations["tasks.transition"];
	if (mutation.isError(failure)) {
		const code: "VERSION_CONFLICT" = failure.code;
		failure.payload.currentVersion.toFixed();
		// @ts-expect-error exact declared payload remains numeric
		failure.payload.currentVersion.toUpperCase();
		void code;
	}
	useMutation({
		...mutation.options(),
		onMutate(variables) {
			return { requested: variables.targetStatus };
		},
		onSuccess(result, variables, context) {
			result.updatedAt.toISOString();
			variables.expectedVersion.toFixed();
			context.requested.toUpperCase();
			// @ts-expect-error native context inferred from onMutate, not an untyped record
			context.requested.toFixed();
		},
		onError(error, variables, context) {
			variables.expectedVersion.toFixed();
			context?.requested.toUpperCase();
			// @ts-expect-error arbitrary native failures are not all declared errors
			error.payload.currentVersion;
		},
		onSettled(result, _error, _variables, context) {
			result?.updatedAt.toISOString();
			context?.requested.toUpperCase();
		},
	});
	const paged = createQueryAdapter(pages, cache);
	const infinite = paged.queries["tickets.queue"].infiniteOptions({
		first: 25,
		statuses: null,
		teamIds: null,
	});
	useInfiniteQuery(infinite).data?.pages[0]?.nodes[0]?.updatedAt.toISOString();
	useSuspenseInfiniteQuery(infinite).data.pageParams[0]?.toUpperCase();
	cache
		.getQueryData(infinite.queryKey)
		?.pages[0]?.nodes[0]?.updatedAt.toISOString();
	// @ts-expect-error arbitrary handler results do not gain pagination
	paged.queries["tickets.detail"].infiniteOptions({ id: "example" });
	paged.queries["tickets.queue"].infiniteOptions({
		first: 25,
		statuses: null,
		teamIds: null,
		// @ts-expect-error cursor supplied by generated infinite options, not the caller
		after: null,
	});
	return adapter;
}
