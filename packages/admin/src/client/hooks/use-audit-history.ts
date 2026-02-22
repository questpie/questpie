import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { selectClient, useAdminStore } from "../runtime";

export type AuditEntry = {
	id: string;
	action: string;
	resourceType: string;
	resource: string;
	resourceId?: string | null;
	resourceLabel?: string | null;
	userId?: string | null;
	userName?: string | null;
	locale?: string | null;
	changes?: Record<string, { from: unknown; to: unknown }> | null;
	metadata?: Record<string, unknown> | null;
	title: string;
	createdAt: string;
	updatedAt?: string;
};

function useAuditFetcher(path: string) {
	const client = useAdminStore(selectClient);
	const basePath = React.useMemo(
		() => (client as any).getBasePath?.() ?? "",
		[client],
	);

	return React.useCallback(
		async (signal?: AbortSignal): Promise<AuditEntry[]> => {
			const response = await fetch(`${basePath}${path}`, {
				credentials: "include",
				headers: {
					Accept: "application/json",
				},
				signal,
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch audit history: ${response.status}`);
			}

			const data = await response.json();
			// Response could be { docs: [...] } or just an array
			return Array.isArray(data) ? data : (data?.docs ?? data ?? []);
		},
		[basePath, path],
	);
}

export function useCollectionAuditHistory(
	collection: string,
	id: string,
	options?: { limit?: number },
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
) {
	const params = new URLSearchParams();
	if (options?.limit) params.set("limit", String(options.limit));

	const path = `/${collection}/${id}/audit${params.toString() ? `?${params}` : ""}`;
	const fetchAudit = useAuditFetcher(path);

	return useQuery<AuditEntry[]>({
		queryKey: ["questpie", "audit", "collection", collection, id, options],
		queryFn: ({ signal }: { signal?: AbortSignal }) => fetchAudit(signal),
		enabled: !!collection && !!id && (queryOptions?.enabled ?? true),
		...queryOptions,
	} as any);
}

export function useGlobalAuditHistory(
	globalName: string,
	options?: { limit?: number },
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
) {
	const params = new URLSearchParams();
	if (options?.limit) params.set("limit", String(options.limit));

	const path = `/globals/${globalName}/audit${params.toString() ? `?${params}` : ""}`;
	const fetchAudit = useAuditFetcher(path);

	return useQuery<AuditEntry[]>({
		queryKey: ["questpie", "audit", "global", globalName, options],
		queryFn: ({ signal }: { signal?: AbortSignal }) => fetchAudit(signal),
		enabled: !!globalName && (queryOptions?.enabled ?? true),
		...queryOptions,
	} as any);
}
