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
	reconcileMutation: (
		revision: number,
		update: (rows: TRow[]) => TRow[],
		fallback: (rows: TRow[]) => TRow[],
	) => Promise<void>;
} {
	const { client, findOptions, mode, queryClient, queryKey, onDispose } =
		options;

	if (mode === "refetch") {
		return {
			queryFn: async () => (await client.find(findOptions)).docs,
			getSnapshotRevision: () => 0,
			reconcileMutation: async () => {},
		};
	}

	let latest: TRow[] | undefined;
	let initial: Promise<TRow[]> | undefined;
	let snapshotRevision = 0;
	const setLatest = (rows: TRow[]) => {
		latest = rows;
		queryClient.setQueryData(queryKey, latest);
	};
	const acceptSnapshot = (rows: TRow[]) => {
		snapshotRevision += 1;
		setLatest(rows);
	};
	return {
		getSnapshotRevision: () => snapshotRevision,
		reconcileMutation: async (revision, update, fallback) => {
			if (revision === snapshotRevision) {
				setLatest(
					update(latest ?? queryClient.getQueryData<TRow[]>(queryKey) ?? []),
				);
				return;
			}

			// Snapshot-mode queryFn serves the latest live value, so a normal
			// Query refetch cannot repair a snapshot that raced the mutation.
			const refreshRevision = snapshotRevision;
			try {
				const refreshed = await client.find(findOptions);
				if (refreshRevision === snapshotRevision) {
					acceptSnapshot(refreshed.docs);
				}
			} catch {
				if (refreshRevision === snapshotRevision) {
					setLatest(
						fallback(
							latest ?? queryClient.getQueryData<TRow[]>(queryKey) ?? [],
						),
					);
				}
			}
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
						acceptSnapshot(snapshot.docs);
						if (!settled) {
							settled = true;
							resolve(snapshot.docs);
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
