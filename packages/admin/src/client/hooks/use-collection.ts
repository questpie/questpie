import {
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { buildCollectionTopic } from "@questpie/tanstack-query";

import type { AnyQuestpieClient } from "../builder";
import { subscribeAdminCollectionRealtime } from "./realtime-subscription";
import { useQuestpieQueryOptions } from "./use-questpie-query-options";

type CollectionRealtimeOptions = {
	realtime?: boolean;
};

function useCollectionRealtimeInvalidation({
	client,
	collection,
	options,
	realtime,
	queryClient,
}: {
	client: any;
	collection: string | undefined;
	options: any;
	realtime: boolean | undefined;
	queryClient: ReturnType<typeof useQuestpieQueryOptions>["queryClient"];
}) {
	const topicSignature = JSON.stringify(
		collection ? buildCollectionTopic(collection, options) : null,
	);

	useEffect(() => {
		const topic = JSON.parse(topicSignature);
		return subscribeAdminCollectionRealtime({
			client,
			collection,
			topic,
			enabled: realtime,
			onChange: () => {
				void queryClient.invalidateQueries({
					queryKey: ["questpie", "collections", "collections", collection],
				});
			},
		});
	}, [client, collection, queryClient, realtime, topicSignature]);
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Resolved app type (Questpie<any> if not registered)
 */

/**
 * Resolved collection names (string if not registered)
 */
type ResolvedCollectionNames = string;

// ============================================================================
// Collection Hooks
// ============================================================================

/**
 * Hook to fetch collection list with filters, sorting, pagination
 *
 * Collection and global names are plain strings — the module-augmentation
 * registry that once narrowed them was never reachable by users.
 *
 * @example
 * ```tsx
 * // Types inferred from module augmentation!
 * const { data } = useCollectionList("barbers");
 * ```
 */
export function useCollectionList<K extends ResolvedCollectionNames>(
	collection: K,
	options?: any,
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	realtimeOptions?: CollectionRealtimeOptions,
): any {
	const { queryOpts, queryClient, locale, client } = useQuestpieQueryOptions();

	const findOptions = {
		...options,
		locale,
	};

	// Pass realtime option to query options builder - this uses streamedQuery internally
	const baseQuery = collection
		? (queryOpts as any).collections[collection as string].find(
				findOptions as any,
				{ realtime: realtimeOptions?.realtime },
			)
		: {
				queryKey: ["questpie", "collections", "__none__", "find"],
				queryFn: () => ({ docs: [], totalDocs: 0 }),
			};

	useCollectionRealtimeInvalidation({
		client,
		collection: collection ? String(collection) : undefined,
		options: findOptions,
		realtime: realtimeOptions?.realtime,
		queryClient,
	});

	return useQuery({
		...baseQuery,
		enabled: !!collection && (queryOptions?.enabled ?? true),
		...queryOptions,
	});
}

/**
 * Hook to count collection items with optional filters
 *
 * More efficient than useCollectionList when you only need the count.
 * Uses dedicated count endpoint that doesn't fetch actual documents.
 *
 * @example
 * ```tsx
 * // Count all items
 * const { data: count } = useCollectionCount("barbers");
 *
 * // Count with filter
 * const { data: count } = useCollectionCount("appointments", {
 *   where: { status: "pending" }
 * });
 * ```
 */
export function useCollectionCount<K extends ResolvedCollectionNames>(
	collection: K,
	options?: { where?: any; includeDeleted?: boolean },
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	realtimeOptions?: CollectionRealtimeOptions,
): any {
	const { queryOpts, queryClient, locale, client } = useQuestpieQueryOptions();

	const countOptions = {
		...options,
		locale,
	};

	// Pass realtime option to query options builder - this uses streamedQuery internally
	// The reducer in tanstack-query already extracts totalDocs from the snapshot
	const baseQuery = collection
		? (queryOpts as any).collections[collection as string].count(
				countOptions as any,
				{ realtime: realtimeOptions?.realtime },
			)
		: {
				queryKey: ["questpie", "collections", "__none__", "count"],
				queryFn: () => 0,
			};

	useCollectionRealtimeInvalidation({
		client,
		collection: collection ? String(collection) : undefined,
		options: countOptions,
		realtime: realtimeOptions?.realtime,
		queryClient,
	});

	return useQuery({
		...baseQuery,
		enabled: !!collection && (queryOptions?.enabled ?? true),
		...queryOptions,
	});
}

/**
 * Hook to fetch single collection item
 *
 * Collection and global names are plain strings — the module-augmentation
 * registry that once narrowed them was never reachable by users.
 *
 * @example
 * ```tsx
 * // Types inferred from module augmentation!
 * const { data } = useCollectionItem("barbers", "123");
 * ```
 */
export function useCollectionItem<K extends ResolvedCollectionNames>(
	collection: K,
	id: string,
	options?: Omit<
		Parameters<AnyQuestpieClient["collections"][K & string]["findOne"]>[0],
		"where"
	> & {
		localeFallback?: boolean;
		with?: Record<string, boolean>;
	},
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
): any {
	const { queryOpts, locale } = useQuestpieQueryOptions();

	const baseQuery = collection
		? (queryOpts as any).collections[collection as string].findOne({
				where: { id },
				locale,
				...options,
			})
		: {
				queryKey: ["questpie", "collections", "__none__", "findOne"],
				queryFn: () => null,
			};

	return useQuery({
		...baseQuery,
		enabled: !!collection && (queryOptions?.enabled ?? true),
		...queryOptions,
	});
}

/**
 * Hook to create collection item
 *
 * Collection and global names are plain strings — the module-augmentation
 * registry that once narrowed them was never reachable by users.
 *
 * @example
 * ```tsx
 * // Types inferred from module augmentation!
 * const { mutate } = useCollectionCreate("barbers");
 * mutate({ name: "John", ... });
 * ```
 */
export function useCollectionCreate<K extends ResolvedCollectionNames>(
	collection: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const { queryOpts, queryClient, locale } = useQuestpieQueryOptions();

	const baseOptions = (queryOpts.collections as any)[
		collection as string
	].create();
	const listQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"find",
		locale,
	]);
	const countQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"count",
		locale,
	]);

	return useMutation({
		...baseOptions,
		onSuccess: (data: any, variables: any, context: any) => {
			(mutationOptions?.onSuccess as any)?.(data, variables, context);
		},
		onSettled: (data: any, error: any, variables: any, context: any) => {
			queryClient.invalidateQueries({
				queryKey: listQueryKey,
			});
			queryClient.invalidateQueries({
				queryKey: countQueryKey,
			});
			(mutationOptions?.onSettled as any)?.(data, error, variables, context);
		},
		...mutationOptions,
	} as any);
}

/**
 * Hook to update collection item
 *
 * Collection and global names are plain strings — the module-augmentation
 * registry that once narrowed them was never reachable by users.
 *
 * @example
 * ```tsx
 * // Types inferred from module augmentation!
 * const { mutate } = useCollectionUpdate("barbers");
 * mutate({ id: "123", data: { name: "John" } });
 * ```
 */
export function useCollectionUpdate<K extends ResolvedCollectionNames>(
	collection: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const { queryOpts, queryClient, locale } = useQuestpieQueryOptions();

	const baseOptions = (queryOpts.collections as any)[
		collection as string
	].update();
	const listQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"find",
		locale,
	]);
	const countQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"count",
		locale,
	]);
	const itemQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"findOne",
		locale,
	]);

	return useMutation({
		...baseOptions,
		onSuccess: (data: any, variables: any, context: any) => {
			(mutationOptions?.onSuccess as any)?.(data, variables, context);
		},
		onSettled: (data: any, error: any, variables: any, context: any) => {
			queryClient.invalidateQueries({
				queryKey: listQueryKey,
			});
			queryClient.invalidateQueries({
				queryKey: countQueryKey,
			});
			queryClient.invalidateQueries({
				queryKey: itemQueryKey,
			});
			(mutationOptions?.onSettled as any)?.(data, error, variables, context);
		},
		...mutationOptions,
	} as any);
}

/**
 * Hook to update multiple collection items with distinct data per record.
 */
export function useCollectionUpdateBatch<K extends ResolvedCollectionNames>(
	collection: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const { client, queryOpts, queryClient, locale } = useQuestpieQueryOptions();

	const listQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"find",
		locale,
	]);
	const countQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"count",
		locale,
	]);
	const itemQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"findOne",
		locale,
	]);

	return useMutation({
		mutationFn: (params: any) =>
			(client.collections as any)[collection as string].updateBatch(params, {
				locale,
			}),
		onSuccess: (data: any, variables: any, context: any) => {
			(mutationOptions?.onSuccess as any)?.(data, variables, context);
		},
		onSettled: (data: any, error: any, variables: any, context: any) => {
			queryClient.invalidateQueries({ queryKey: listQueryKey });
			queryClient.invalidateQueries({ queryKey: countQueryKey });
			queryClient.invalidateQueries({ queryKey: itemQueryKey });
			(mutationOptions?.onSettled as any)?.(data, error, variables, context);
		},
		...mutationOptions,
	} as any);
}

/**
 * Hook to delete collection item
 *
 * Collection and global names are plain strings — the module-augmentation
 * registry that once narrowed them was never reachable by users.
 *
 * @example
 * ```tsx
 * // Types inferred from module augmentation!
 * const { mutate } = useCollectionDelete("barbers");
 * mutate("123");
 * ```
 */
export function useCollectionDelete<K extends ResolvedCollectionNames>(
	collection: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const { queryOpts, queryClient, locale } = useQuestpieQueryOptions();

	const baseOptions = (queryOpts.collections as any)[
		collection as string
	].delete();
	const listQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"find",
		locale,
	]);
	const countQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"count",
		locale,
	]);
	const itemQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"findOne",
		locale,
	]);

	return useMutation({
		...baseOptions,
		onSuccess: (data: any, variables: any, context: any) => {
			(mutationOptions?.onSuccess as any)?.(data, variables, context);
		},
		onSettled: (data: any, error: any, variables: any, context: any) => {
			queryClient.invalidateQueries({
				queryKey: listQueryKey,
			});
			queryClient.invalidateQueries({
				queryKey: countQueryKey,
			});
			queryClient.removeQueries({
				queryKey: itemQueryKey,
			});
			(mutationOptions?.onSettled as any)?.(data, error, variables, context);
		},
		...mutationOptions,
	} as any);
}

/**
 * Hook to restore soft-deleted collection item
 */
export function useCollectionRestore<K extends ResolvedCollectionNames>(
	collection: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const { queryOpts, queryClient, locale } = useQuestpieQueryOptions();

	const baseOptions = (queryOpts.collections as any)[
		collection as string
	].restore();
	const listQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"find",
		locale,
	]);
	const countQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"count",
		locale,
	]);
	const itemQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"findOne",
		locale,
	]);

	return useMutation({
		...baseOptions,
		onSuccess: (data: any, variables: any, context: any) => {
			(mutationOptions?.onSuccess as any)?.(data, variables, context);
		},
		onSettled: (data: any, error: any, variables: any, context: any) => {
			queryClient.invalidateQueries({ queryKey: listQueryKey });
			queryClient.invalidateQueries({ queryKey: countQueryKey });
			queryClient.invalidateQueries({ queryKey: itemQueryKey });
			(mutationOptions?.onSettled as any)?.(data, error, variables, context);
		},
		...mutationOptions,
	} as any);
}

/**
 * Hook to fetch version history for a collection item
 */
export function useCollectionVersions<K extends ResolvedCollectionNames>(
	collection: K,
	id: string,
	options?: { limit?: number; offset?: number },
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
): any {
	const { queryOpts } = useQuestpieQueryOptions();

	const baseQuery = collection
		? (queryOpts as any).collections[collection as string].findVersions({
				id,
				...(options?.limit !== undefined ? { limit: options.limit } : {}),
				...(options?.offset !== undefined ? { offset: options.offset } : {}),
			})
		: {
				queryKey: ["questpie", "collections", "__none__", "findVersions"],
				queryFn: () => ({ docs: [], totalDocs: 0 }),
			};

	return useQuery({
		...baseQuery,
		enabled: !!collection && !!id && (queryOptions?.enabled ?? true),
		...queryOptions,
	});
}

/**
 * Hook to revert a collection item to a previous version
 */
export function useCollectionRevertVersion<K extends ResolvedCollectionNames>(
	collection: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const { queryOpts, queryClient, locale } = useQuestpieQueryOptions();

	const baseOptions = (queryOpts.collections as any)[
		collection as string
	].revertToVersion();
	const listQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"find",
		locale,
	]);
	const countQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"count",
		locale,
	]);
	const itemQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"findOne",
		locale,
	]);
	const versionsQueryKey = queryOpts.key([
		"collections",
		collection as string,
		"findVersions",
		locale,
	]);

	return useMutation({
		...baseOptions,
		onSuccess: (data: any, variables: any, context: any) => {
			(mutationOptions?.onSuccess as any)?.(data, variables, context);
		},
		onSettled: (data: any, error: any, variables: any, context: any) => {
			queryClient.invalidateQueries({ queryKey: listQueryKey });
			queryClient.invalidateQueries({ queryKey: countQueryKey });
			queryClient.invalidateQueries({ queryKey: itemQueryKey });
			queryClient.invalidateQueries({ queryKey: versionsQueryKey });
			(mutationOptions?.onSettled as any)?.(data, error, variables, context);
		},
		...mutationOptions,
	} as any);
}
