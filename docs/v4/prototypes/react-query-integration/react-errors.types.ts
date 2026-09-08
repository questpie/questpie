import {
	useMutation,
	useQueries,
	useQuery,
	useSuspenseQueries,
	useSuspenseQuery,
} from "@tanstack/react-query";

import type { createQueryAdapter } from "./generated/client.react-query";

// Application-owned native TanStack configuration, not a library augmentation.
// This consumer compiles in its own project so other consumers retain defaults.
declare module "@tanstack/react-query" {
	interface Register {
		defaultError: unknown;
	}
}

export function useUnknownErrors(
	adapter: ReturnType<typeof createQueryAdapter>,
) {
	const options = adapter.queries["tasks.detail"].options({ id: "example" });
	const query = useQuery(options);
	const suspense = useSuspenseQuery(options);
	const queries = useQueries({ queries: [options] });
	const suspended = useSuspenseQueries({ queries: [options] });
	const mutation = useMutation(adapter.mutations["tasks.transition"].options());
	// @ts-expect-error arbitrary failures require narrowing
	query.error?.message;
	// @ts-expect-error arbitrary failures require narrowing
	suspense.error?.message;
	// @ts-expect-error arbitrary failures require narrowing
	queries[0]?.error?.message;
	// @ts-expect-error arbitrary failures require narrowing
	suspended[0]?.error?.message;
	if (adapter.mutations["tasks.transition"].isError(mutation.error)) {
		mutation.error.payload.currentVersion.toFixed();
	}
}
