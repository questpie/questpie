import type { Query, QueryClient } from "@tanstack/react-query";

/** Finish native state cleanup even when application notification code throws. */
export function retireQuery(
	client: QueryClient,
	query: Query,
	error: Error,
): unknown[] {
	const failures: unknown[] = [];
	const observers = [...query.observers];
	try {
		query.setState({
			data: undefined,
			error,
			status: "error",
			fetchStatus: "idle",
		});
	} catch (failure) {
		failures.push(failure);
		// Native dispatch stores Query state before notifying observers. A throwing
		// listener interrupts that loop; advance the remaining native results too.
		for (const observer of observers) {
			try {
				observer.onQueryUpdate();
			} catch (failure) {
				failures.push(failure);
			}
		}
	}
	try {
		client.getQueryCache().remove(query);
	} catch (failure) {
		failures.push(failure);
	}
	return failures;
}
