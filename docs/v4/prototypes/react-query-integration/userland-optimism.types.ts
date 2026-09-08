import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";

import type { GeneratedClientScope } from "./generated/client";
import { createQueryAdapter } from "./generated/client.react-query";

// Application UI, not a framework overlay: keep current authorized data separate
// from pending intent. No Operation DTO or cache key is restated by the author.
export function usePendingTaskTransition(
	scope: GeneratedClientScope,
	cache: QueryClient,
	id: string,
) {
	const adapter = createQueryAdapter(scope, cache);
	const current = useQuery(adapter.queries["tasks.detail"].options({ id }));
	const operation = adapter.mutations["tasks.transition"];
	const transition = useMutation({
		...operation.options(),
		onMutate: (variables) => ({ requestedStatus: variables.targetStatus }),
		onSuccess: (result, variables, intent) => {
			result.updatedAt.toISOString();
			// @ts-expect-error generated timestamp results are Dates, not wire strings
			const wireTimestamp: string = result.updatedAt;
			void wireTimestamp;
			variables.expectedVersion.toFixed();
			intent.requestedStatus.toUpperCase();
			// @ts-expect-error native onMutate context preserves its inferred string
			intent.requestedStatus.toFixed();
		},
		onError: (error, variables, intent) => {
			variables.expectedVersion.toFixed();
			intent?.requestedStatus.toUpperCase();
			if (operation.isError(error)) error.payload.currentVersion.toFixed();
			// @ts-expect-error arbitrary transport failure is not a declared error
			error.payload.currentVersion;
		},
		onSettled: (_result, _error, _variables, intent) => {
			intent?.requestedStatus.toUpperCase();
		},
	});
	const base = current.isSuccess ? current.data : undefined;
	return {
		base,
		pendingStatus:
			base && transition.isPending && transition.variables.id === base.id
				? transition.variables.targetStatus
				: undefined,
		transition,
	};
}
