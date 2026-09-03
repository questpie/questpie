import { useSyncExternalStore } from "react";

export function useQueryResource(resource) {
	return useSyncExternalStore(resource.subscribe, resource.getSnapshot);
}
