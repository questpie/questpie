import { useSyncExternalStore } from "react";

type QueryResource<Snapshot> = Readonly<{
	getSnapshot(): Snapshot;
	subscribe(notify: () => void): () => void;
}>;

export function useQueryResource<Snapshot>(
	resource: QueryResource<Snapshot>,
): Snapshot {
	return useSyncExternalStore(resource.subscribe, resource.getSnapshot);
}
