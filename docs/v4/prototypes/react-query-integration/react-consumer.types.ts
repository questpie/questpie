import {
	useMutation,
	useQueries,
	useQuery,
	useSuspenseQueries,
	useSuspenseQuery,
	type QueryClient,
} from "@tanstack/react-query";

import type { GeneratedClientScope } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

// Compile-only native hook consumers. No handwritten result types or casts.
export function useTaskConsumers(
	scope: GeneratedClientScope,
	cache: QueryClient,
) {
	const adapter = createQueryAdapter(scope, cache);
	const options = adapter.queries["tasks.detail"].options({ id: "example" });
	const historical = adapter.queries["tasks.detail"].options({
		id: "example",
		asOf: new Date("2026-09-08T10:00:00.000Z"),
	});
	const normal = useQuery(options);
	const suspense = useSuspenseQuery(options);
	const selected = useQuery({
		...options,
		select: (value) => value?.title ?? "Missing",
	});
	const multiple = useQueries({ queries: [options, historical] });
	const suspended = useSuspenseQueries({ queries: [options, historical] });
	const mutation = useMutation(adapter.mutations["tasks.transition"].options());
	normal.data?.updatedAt.toISOString();
	suspense.data?.updatedAt.toISOString();
	selected.data?.toUpperCase();
	multiple[0]?.data?.updatedAt.toISOString();
	suspended[0]?.data?.updatedAt.toISOString();
	mutation.mutate({ id: "example", expectedVersion: 1, targetStatus: "done" });
	// @ts-expect-error output timestamp is a Date
	normal.data?.updatedAt.toUpperCase();
	// @ts-expect-error selector output is a string
	selected.data?.updatedAt;
	mutation.mutate({
		id: "example",
		// @ts-expect-error mutation variables retain the generated version type
		expectedVersion: "1",
		targetStatus: "done",
	});
}
