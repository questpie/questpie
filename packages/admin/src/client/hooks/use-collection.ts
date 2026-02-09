import {
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import type { Questpie } from "questpie";
import type { QuestpieClient } from "questpie/client";
import type {
	RegisteredCMS,
	RegisteredCollectionNames,
} from "../builder/registry";
import { useQuestpieQueryOptions } from "./use-questpie-query-options";

type CollectionRealtimeOptions = {
	realtime?: boolean;
};

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Resolved CMS type (Questpie<any> if not registered)
 */
type ResolvedCMS =
	RegisteredCMS extends Questpie<any> ? RegisteredCMS : Questpie<any>;

/**
 * Resolved collection names (string if not registered)
 */
type ResolvedCollectionNames =
	RegisteredCMS extends Questpie<any> ? RegisteredCollectionNames : string;

// ============================================================================
// Collection Hooks
// ============================================================================

/**
 * Hook to fetch collection list with filters, sorting, pagination
 *
 * Uses RegisteredCMS from module augmentation for automatic type inference.
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
	const { queryOpts, locale } = useQuestpieQueryOptions();

	const findOptions = {
		...options,
		locale,
	};

	// Pass realtime option to query options builder - this uses streamedQuery internally
	const baseQuery = (queryOpts as any).collections[collection as string].find(
		findOptions as any,
		{ realtime: realtimeOptions?.realtime },
	);

	return useQuery({
		...baseQuery,
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
	const { queryOpts, locale } = useQuestpieQueryOptions();

	const countOptions = {
		...options,
		locale,
	};

	// Pass realtime option to query options builder - this uses streamedQuery internally
	// The reducer in tanstack-query already extracts totalDocs from the snapshot
	const baseQuery = (queryOpts as any).collections[collection as string].count(
		countOptions as any,
		{ realtime: realtimeOptions?.realtime },
	);

	return useQuery({
		...baseQuery,
		...queryOptions,
	});
}

/**
 * Hook to fetch single collection item
 *
 * Uses RegisteredCMS from module augmentation for automatic type inference.
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
		Parameters<
			QuestpieClient<ResolvedCMS>["collections"][K & string]["findOne"]
		>[0],
		"where"
	> & {
		localeFallback?: boolean;
		with?: Record<string, boolean>;
	},
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
): any {
	const { queryOpts, locale } = useQuestpieQueryOptions();

	return useQuery({
		...(queryOpts as any).collections[collection as string].findOne({
			where: { id },
			locale,
			...options,
		}),
		...queryOptions,
	});
}

/**
 * Hook to create collection item
 *
 * Uses RegisteredCMS from module augmentation for automatic type inference.
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

	const baseOptions = queryOpts.collections[collection as string].create();
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
 * Uses RegisteredCMS from module augmentation for automatic type inference.
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

	const baseOptions = queryOpts.collections[collection as string].update();
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
 * Hook to delete collection item
 *
 * Uses RegisteredCMS from module augmentation for automatic type inference.
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

	const baseOptions = queryOpts.collections[collection as string].delete();
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
