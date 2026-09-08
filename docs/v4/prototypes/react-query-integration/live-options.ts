import type {
	DataTag,
	QueryClient,
	QueryObserverOptions,
} from "@tanstack/query-core";

import type { ProjectionWatchFailure } from "./projection-contract";

export function createLiveQueryOptions<Output>(
	input: Readonly<{
		client: QueryClient;
		key: readonly string[];
		watch(
			callback: (value: Output) => void,
			onError: (failure: ProjectionWatchFailure) => void,
		): () => void;
	}>,
) {
	let retired = false;
	let stop: (() => void) | undefined;
	let generation = 0;
	let firstPending = false;
	let latest: Output | undefined;
	let rejectFirst: ((reason: unknown) => void) | undefined;
	const currentQuery = () =>
		input.client.getQueryCache().find({ queryKey: input.key, exact: true });
	let ownedQuery: ReturnType<typeof currentQuery>;
	const release = () => {
		generation++;
		const close = stop;
		stop = undefined;
		rejectFirst?.(new Error("WATCH_CANCELLED"));
		rejectFirst = undefined;
		close?.();
	};
	const unsubscribeCache = input.client.getQueryCache().subscribe((event) => {
		if (event.type === "removed" && event.query === ownedQuery) {
			release();
			return;
		}
		if (event.query !== currentQuery()) return;
		ownedQuery = event.query;
		if (
			(event.type === "observerRemoved" ||
				event.type === "observerOptionsUpdated") &&
			!event.query.isActive()
		)
			release();
		if (
			(event.type === "observerAdded" ||
				event.type === "observerOptionsUpdated") &&
			event.query.isActive() &&
			event.query.state.status === "success" &&
			!stop
		) {
			void input.client.refetchQueries({
				queryKey: input.key,
				exact: true,
				type: "active",
			});
		}
		if (
			event.type === "updated" &&
			event.action.type === "success" &&
			firstPending
		) {
			firstPending = false;
			if (latest !== undefined && latest !== event.query.state.data)
				input.client.setQueryData(input.key, latest);
		}
	});
	const retire = async (error: Error) => {
		if (retired) return;
		retired = true;
		release();
		unsubscribeCache();
		const cancelled = input.client.cancelQueries(
			{ queryKey: input.key, exact: true },
			{ revert: false },
		);
		currentQuery()?.setState({
			data: undefined,
			error,
			status: "error",
			fetchStatus: "idle",
		});
		latest = undefined;
		input.client.removeQueries({ queryKey: input.key, exact: true });
		await cancelled;
	};
	const options = {
		queryKey: input.key as DataTag<readonly string[], Output, Error>,
		retry: false,
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			if (retired) throw new Error("SCOPE_RETIRED");
			release();
			const opened = generation;
			firstPending = true;
			signal.throwIfAborted();
			const aborted = () => {
				if (opened === generation) release();
			};
			signal.addEventListener("abort", aborted, { once: true });
			let value: Output;
			try {
				value = await new Promise<Output>((resolve, reject) => {
					rejectFirst = reject;
					const close = input.watch(
						(next) => {
							if (retired || opened !== generation) return;
							latest = next;
							if (firstPending) resolve(next);
							else input.client.setQueryData(input.key, next);
						},
						(failure) => {
							if (retired || opened !== generation) return;
							void retire(new Error(failure.code));
						},
					);
					if (retired || opened !== generation) close();
					else stop = close;
				});
			} finally {
				signal.removeEventListener("abort", aborted);
				if (opened === generation) rejectFirst = undefined;
			}
			if (!currentQuery()?.isActive()) release();
			return value;
		},
	} satisfies QueryObserverOptions<Output>;
	return {
		options,
		get retired() {
			return retired;
		},
		detach() {
			release();
			unsubscribeCache();
			latest = undefined;
		},
		dispose: () => retire(new Error("SCOPE_RETIRED")),
	};
}
