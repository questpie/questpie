/**
 * Typed Hooks Factory
 *
 * Creates type-safe React hooks for collections and globals without module augmentation.
 * This is the recommended approach for new projects.
 *
 * @example
 * ```ts
 * // In your admin setup file:
 * import type { App } from "#questpie";
 * import { createTypedHooks } from '@questpie/admin/client';
 *
 * export const {
 *   useCollectionList,
 *   useCollectionItem,
 *   useCollectionCreate,
 *   useCollectionUpdate,
 *   useCollectionDelete,
 *   useCollectionCount,
 *   useGlobal,
 *   useGlobalUpdate,
 * } = createTypedHooks<App>();
 * ```
 */

import {
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { QuestpieApp } from "questpie/client";

import type { QuestpieQueryOptionsProxy } from "@questpie/tanstack-query";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

import {
	selectContentLocale,
	useAdminStore,
	useScopedLocale,
} from "../runtime";
import {
	type CollectionQueryKey,
	getCollectionQueryApi,
	getGlobalQueryApi,
	useAppClient,
} from "./query-access";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract collection names from a QuestpieApp config
 */
type CollectionNames<TApp extends QuestpieApp> = CollectionQueryKey<TApp>;

/**
 * Extract global names from a QuestpieApp config
 */
type GlobalNames<TApp extends QuestpieApp> =
	keyof QuestpieQueryOptionsProxy<TApp>["globals"] & string;

// ============================================================================
// Typed Hooks Interface
// ============================================================================

export interface TypedHooks<TApp extends QuestpieApp> {
	/**
	 * Hook to fetch collection list with filters, sorting, pagination
	 */
	useCollectionList: <K extends CollectionNames<TApp>>(
		collection: K,
		options?: any,
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	) => any;

	/**
	 * Hook to count collection items with optional filters
	 */
	useCollectionCount: <K extends CollectionNames<TApp>>(
		collection: K,
		options?: { where?: any; includeDeleted?: boolean },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	) => any;

	/**
	 * Hook to fetch single collection item
	 */
	useCollectionItem: <K extends CollectionNames<TApp>>(
		collection: K,
		id: string,
		options?: {
			localeFallback?: boolean;
			with?: Record<string, boolean>;
		},
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	) => any;

	/**
	 * Hook to create collection item
	 */
	useCollectionCreate: <K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	) => any;

	/**
	 * Hook to update collection item
	 */
	useCollectionUpdate: <K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	) => any;

	/**
	 * Hook to delete collection item
	 */
	useCollectionDelete: <K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	) => any;

	/**
	 * Hook to restore soft-deleted collection item
	 */
	useCollectionRestore: <K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	) => any;

	/**
	 * Hook to fetch collection item versions
	 */
	useCollectionVersions: <K extends CollectionNames<TApp>>(
		collection: K,
		id: string,
		options?: { limit?: number; offset?: number },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	) => any;

	/**
	 * Hook to revert collection item to a previous version
	 */
	useCollectionRevertVersion: <K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	) => any;

	/**
	 * Hook to fetch global settings
	 */
	useGlobal: <K extends GlobalNames<TApp>>(
		globalName: K,
		options?: any,
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	) => any;

	/**
	 * Hook to update global settings
	 */
	useGlobalUpdate: <K extends GlobalNames<TApp>>(
		globalName: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	) => any;

	/**
	 * Hook to fetch global versions
	 */
	useGlobalVersions: <K extends GlobalNames<TApp>>(
		globalName: K,
		options?: { id?: string; limit?: number; offset?: number },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	) => any;

	/**
	 * Hook to revert global to a previous version
	 */
	useGlobalRevertVersion: <K extends GlobalNames<TApp>>(
		globalName: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	) => any;
}

// ============================================================================
// Factory Implementation
// ============================================================================

/**
 * Create type-safe hooks for collections and globals.
 *
 * This factory creates hooks that are typed to your specific app configuration,
 * providing autocomplete for collection/global names without module augmentation.
 *
 * @example
 * ```ts
 * import type { App } from "#questpie";
 * import { createTypedHooks } from '@questpie/admin/client';
 *
 * // Create typed hooks
 * export const {
 *   useCollectionList,
 *   useCollectionItem,
 *   useCollectionCreate,
 *   useCollectionUpdate,
 *   useCollectionDelete,
 *   useGlobal,
 *   useGlobalUpdate,
 * } = createTypedHooks<App>();
 *
 * // Usage - collection names are autocompleted!
 * const { data } = useCollectionList("barbers");
 * const { data: settings } = useGlobal("siteSettings");
 * ```
 */
export function createTypedHooks<TApp extends QuestpieApp>(): TypedHooks<TApp> {
	// Collection list hook
	function useCollectionList<K extends CollectionNames<TApp>>(
		collection: K,
		options?: any,
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseQuery = collection
			? getCollectionQueryApi(
					queryOpts,
					collection as CollectionQueryKey<TApp>,
				).find({
					...options,
					locale: contentLocale,
				})
			: {
					queryKey: ["questpie", "collections", "__none__", "find"],
					queryFn: () => ({ docs: [], totalDocs: 0 }),
				};

		return useQuery({
			...(baseQuery as any),
			enabled: !!collection && (queryOptions?.enabled ?? true),
			...queryOptions,
		});
	}

	// Collection count hook
	function useCollectionCount<K extends CollectionNames<TApp>>(
		collection: K,
		options?: { where?: any; includeDeleted?: boolean },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseQuery = collection
			? getCollectionQueryApi(
					queryOpts,
					collection as CollectionQueryKey<TApp>,
				).count({
					...options,
					locale: contentLocale,
				} as any)
			: {
					queryKey: ["questpie", "collections", "__none__", "count"],
					queryFn: () => 0,
				};

		return useQuery({
			...(baseQuery as any),
			enabled: !!collection && (queryOptions?.enabled ?? true),
			...queryOptions,
		});
	}

	// Collection item hook
	function useCollectionItem<K extends CollectionNames<TApp>>(
		collection: K,
		id: string,
		options?: {
			localeFallback?: boolean;
			with?: Record<string, boolean>;
		},
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseQuery = collection
			? getCollectionQueryApi(
					queryOpts,
					collection as CollectionQueryKey<TApp>,
				).findOne({
					where: { id },
					locale: contentLocale,
					...options,
				} as any)
			: {
					queryKey: ["questpie", "collections", "__none__", "findOne"],
					queryFn: () => null,
				};

		return useQuery({
			...(baseQuery as any),
			enabled: !!collection && (queryOptions?.enabled ?? true),
			...queryOptions,
		});
	}

	// Collection create hook
	function useCollectionCreate<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = getCollectionQueryApi(
			queryOpts,
			collection as CollectionQueryKey<TApp>,
		).create();
		const listQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"find",
			contentLocale,
		]);
		const countQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"count",
			contentLocale,
		]);

		return useMutation({
			...baseOptions,
			onSuccess: (data: any, variables: any, context: any) => {
				(mutationOptions?.onSuccess as any)?.(data, variables, context);
			},
			onSettled: (data: any, error: any, variables: any, context: any) => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
				queryClient.invalidateQueries({ queryKey: countQueryKey });
				(mutationOptions?.onSettled as any)?.(data, error, variables, context);
			},
			...mutationOptions,
		} as any);
	}

	// Collection update hook
	function useCollectionUpdate<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = getCollectionQueryApi(
			queryOpts,
			collection as CollectionQueryKey<TApp>,
		).update();
		const listQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"find",
			contentLocale,
		]);
		const countQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"count",
			contentLocale,
		]);
		const itemQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"findOne",
			contentLocale,
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

	// Collection delete hook
	function useCollectionDelete<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = getCollectionQueryApi(
			queryOpts,
			collection as CollectionQueryKey<TApp>,
		).delete();
		const listQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"find",
			contentLocale,
		]);
		const countQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"count",
			contentLocale,
		]);
		const itemQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"findOne",
			contentLocale,
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

	// Collection restore hook
	function useCollectionRestore<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = getCollectionQueryApi(
			queryOpts,
			collection as CollectionQueryKey<TApp>,
		).restore();
		const listQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"find",
			contentLocale,
		]);
		const countQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"count",
			contentLocale,
		]);
		const itemQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"findOne",
			contentLocale,
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

	// Collection versions hook
	function useCollectionVersions<K extends CollectionNames<TApp>>(
		collection: K,
		id: string,
		options?: { limit?: number; offset?: number },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseQuery = collection
			? getCollectionQueryApi(
					queryOpts,
					collection as CollectionQueryKey<TApp>,
				).findVersions({
					id,
					...(options?.limit !== undefined ? { limit: options.limit } : {}),
					...(options?.offset !== undefined ? { offset: options.offset } : {}),
				} as any)
			: {
					queryKey: ["questpie", "collections", "__none__", "findVersions"],
					queryFn: () => ({ docs: [], totalDocs: 0 }),
				};

		return useQuery({
			...(baseQuery as any),
			enabled: !!collection && !!id && (queryOptions?.enabled ?? true),
			...queryOptions,
		});
	}

	// Collection revert version hook
	function useCollectionRevertVersion<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAppClient<TApp>();
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = getCollectionQueryApi(
			queryOpts,
			collection as CollectionQueryKey<TApp>,
		).revertToVersion();
		const listQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"find",
			contentLocale,
		]);
		const countQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"count",
			contentLocale,
		]);
		const itemQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"findOne",
			contentLocale,
		]);
		const versionsQueryKey = queryOpts.key([
			"collections",
			collection as string,
			"findVersions",
			contentLocale,
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

	// Global hook
	function useGlobal<K extends GlobalNames<TApp>>(
		globalName: K,
		options?: any,
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAppClient<TApp>();
		const contentLocale = useAdminStore(selectContentLocale);
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		return useQuery({
			...(getGlobalQueryApi(queryOpts, globalName as any).get({
				...options,
				locale: contentLocale,
			}) as any),
			...queryOptions,
		});
	}

	// Global update hook
	function useGlobalUpdate<K extends GlobalNames<TApp>>(
		globalName: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAppClient<TApp>();
		const contentLocale = useAdminStore(selectContentLocale);
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const globalQueryKey = queryOpts.key([
			"globals",
			globalName as string,
			"get",
			contentLocale,
		]);

		return useMutation({
			...getGlobalQueryApi(queryOpts, globalName as any).update(),
			onSuccess: (data: any, variables: any, context: any) => {
				(mutationOptions?.onSuccess as any)?.(data, variables, context);
			},
			onSettled: (data: any, error: any, variables: any, context: any) => {
				queryClient.invalidateQueries({ queryKey: globalQueryKey });
				(mutationOptions?.onSettled as any)?.(data, error, variables, context);
			},
			...mutationOptions,
		} as any);
	}

	// Global versions hook
	function useGlobalVersions<K extends GlobalNames<TApp>>(
		globalName: K,
		options?: { id?: string; limit?: number; offset?: number },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAppClient<TApp>();
		const contentLocale = useAdminStore(selectContentLocale);
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		return useQuery({
			...(getGlobalQueryApi(queryOpts, globalName as any).findVersions({
				...options,
				locale: contentLocale,
			} as any) as any),
			...queryOptions,
		} as any);
	}

	// Global revert version hook
	function useGlobalRevertVersion<K extends GlobalNames<TApp>>(
		globalName: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAppClient<TApp>();
		const contentLocale = useAdminStore(selectContentLocale);
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions<TApp>(client, {
			keyPrefix,
			locale: contentLocale,
		});

		const globalQueryKey = queryOpts.key([
			"globals",
			globalName as string,
			"get",
			contentLocale,
		]);
		const versionsQueryKey = queryOpts.key([
			"globals",
			globalName as string,
			"findVersions",
			contentLocale,
		]);

		return useMutation({
			...getGlobalQueryApi(queryOpts, globalName as any).revertToVersion(),
			onSuccess: (data: any, variables: any, context: any) => {
				(mutationOptions?.onSuccess as any)?.(data, variables, context);
			},
			onSettled: (data: any, error: any, variables: any, context: any) => {
				queryClient.invalidateQueries({ queryKey: globalQueryKey });
				queryClient.invalidateQueries({ queryKey: versionsQueryKey });
				(mutationOptions?.onSettled as any)?.(data, error, variables, context);
			},
			...mutationOptions,
		} as any);
	}

	return {
		useCollectionList,
		useCollectionCount,
		useCollectionItem,
		useCollectionCreate,
		useCollectionUpdate,
		useCollectionDelete,
		useCollectionRestore,
		useCollectionVersions,
		useCollectionRevertVersion,
		useGlobal,
		useGlobalUpdate,
		useGlobalVersions,
		useGlobalRevertVersion,
	};
}
