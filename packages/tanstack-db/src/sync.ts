import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type QuestpieDbSyncMode = "refetch" | "snapshot";

type Snapshot<TRow> = { docs: TRow[] };

type SyncCollectionClient<TRow> = {
	find: (options?: unknown) => Promise<Snapshot<TRow>>;
	live: (
		options: unknown,
		onSnapshot: (snapshot: Snapshot<TRow>) => void,
		opts?: { onError?: (error: Error) => void },
	) => () => void;
};

export function resolveSync<TRow>(options: {
	client: SyncCollectionClient<TRow>;
	findOptions?: unknown;
	mode: QuestpieDbSyncMode;
	queryClient: QueryClient;
	queryKey: QueryKey;
	onDispose: (dispose: () => void) => void;
}): {
	queryFn: () => Promise<TRow[]>;
	updateSnapshot: (update: (rows: TRow[]) => TRow[]) => void;
} {
	const { client, findOptions, mode, queryClient, queryKey, onDispose } =
		options;

	if (mode === "refetch") {
		return {
			queryFn: async () => (await client.find(findOptions)).docs,
			updateSnapshot: () => {},
		};
	}

	let latest: TRow[] | undefined;
	let initial: Promise<TRow[]> | undefined;
	return {
		updateSnapshot: (update) => {
			latest = update(
				latest ?? queryClient.getQueryData<TRow[]>(queryKey) ?? [],
			);
			queryClient.setQueryData(queryKey, latest);
		},
		queryFn: () => {
			if (latest) return Promise.resolve(latest);
			if (initial) return initial;

			initial = new Promise<TRow[]>((resolve, reject) => {
				let settled = false;
				const dispose = client.live(
					findOptions,
					(snapshot) => {
						latest = snapshot.docs;
						queryClient.setQueryData(queryKey, latest);
						if (!settled) {
							settled = true;
							resolve(latest);
						}
					},
					{
						onError: (error) => {
							if (!settled) {
								settled = true;
								reject(error);
							}
						},
					},
				);
				onDispose(dispose);
			});

			return initial;
		},
	};
}
