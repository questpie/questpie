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
	onDispose: (dispose: () => void) => void | (() => void);
}): {
	queryFn: () => Promise<TRow[]>;
	getSnapshotRevision: () => number;
	updateSnapshot: (
		revision: number,
		update: (rows: TRow[]) => TRow[],
	) => boolean;
} {
	const { client, findOptions, mode, queryClient, queryKey, onDispose } =
		options;

	if (mode === "refetch") {
		return {
			queryFn: async () => (await client.find(findOptions)).docs,
			getSnapshotRevision: () => 0,
			updateSnapshot: () => false,
		};
	}

	let latest: TRow[] | undefined;
	let initial: Promise<TRow[]> | undefined;
	let snapshotRevision = 0;
	return {
		getSnapshotRevision: () => snapshotRevision,
		updateSnapshot: (revision, update) => {
			if (revision !== snapshotRevision) return false;
			latest = update(
				latest ?? queryClient.getQueryData<TRow[]>(queryKey) ?? [],
			);
			queryClient.setQueryData(queryKey, latest);
			return true;
		},
		queryFn: () => {
			if (latest) return Promise.resolve(latest);
			if (initial) return initial;

			initial = new Promise<TRow[]>((resolve, reject) => {
				let settled = false;
				let dispose = () => {};
				let unregisterDispose = () => {};
				let failedSynchronously = false;
				const liveDispose = client.live(
					findOptions,
					(snapshot) => {
						snapshotRevision += 1;
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
								failedSynchronously = true;
								dispose();
								unregisterDispose();
								reject(error);
							}
						},
					},
				);
				dispose = liveDispose;
				if (failedSynchronously) {
					dispose();
				} else {
					unregisterDispose = onDispose(dispose) ?? (() => {});
				}
			}).catch((error) => {
				initial = undefined;
				throw error;
			});

			return initial;
		},
	};
}
