/**
 * Typed Hooks Factory
 *
 * Creates type-safe React hooks for collections and globals without module augmentation.
 * This is the recommended approach for new projects.
 *
 * @example
 * ```ts
 * // In your admin setup file:
 * import type { App } from "./server/app";
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

import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import {
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { Questpie } from "questpie";
import type { QuestpieClient } from "questpie/client";
import { selectClient, useAdminStore, useScopedLocale } from "../runtime";
import { selectContentLocale } from "../runtime/provider";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract collection names from a Questpie app
 */
type CollectionNames<TApp extends Questpie<any>> =
	keyof TApp["config"]["collections"] & string;

/**
 * Extract global names from a Questpie app
 */
type GlobalNames<TApp extends Questpie<any>> =
	TApp extends Questpie<infer TConfig>
		? keyof TConfig["globals"] & string
		: never;

// ============================================================================
// Typed Hooks Interface
// ============================================================================

export interface TypedHooks<TApp extends Questpie<any>> {
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
 * import type { App } from "./server/app";
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
export function createTypedHooks<
	TApp extends Questpie<any>,
>(): TypedHooks<TApp> {
	// Collection list hook
	function useCollectionList<K extends CollectionNames<TApp>>(
		collection: K,
		options?: any,
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(
			client as any,
			{
				keyPrefix,
				locale: contentLocale,
			} as any,
		);

		return useQuery({
			...(queryOpts as any).collections[collection as string].find({
				...options,
				locale: contentLocale,
			} as any),
			...queryOptions,
		});
	}

	// Collection count hook
	function useCollectionCount<K extends CollectionNames<TApp>>(
		collection: K,
		options?: { where?: any; includeDeleted?: boolean },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(
			client as any,
			{
				keyPrefix,
				locale: contentLocale,
			} as any,
		);

		return useQuery({
			...(queryOpts as any).collections[collection as string].count({
				...options,
				locale: contentLocale,
			} as any),
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
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(client as any, {
			keyPrefix,
			locale: contentLocale,
		});

		return useQuery({
			...(queryOpts as any).collections[collection as string].findOne({
				where: { id },
				locale: contentLocale,
				...options,
			}),
			...queryOptions,
		});
	}

	// Collection create hook
	function useCollectionCreate<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(client as any, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = queryOpts.collections[collection as string].create();
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

	// Collection update hook
	function useCollectionUpdate<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(client as any, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = queryOpts.collections[collection as string].update();
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

	// Collection delete hook
	function useCollectionDelete<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(client as any, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = queryOpts.collections[collection as string].delete();
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

	// Collection restore hook
	function useCollectionRestore<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(client as any, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions = queryOpts.collections[collection as string].restore();
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

	// Collection versions hook
	function useCollectionVersions<K extends CollectionNames<TApp>>(
		collection: K,
		id: string,
		options?: { limit?: number; offset?: number },
		queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(client as any, {
			keyPrefix,
			locale: contentLocale,
		});

		return useQuery({
			...(queryOpts as any).collections[collection as string].findVersions({
				id,
				...(options?.limit !== undefined ? { limit: options.limit } : {}),
				...(options?.offset !== undefined ? { offset: options.offset } : {}),
			}),
			enabled: !!id && (queryOptions?.enabled ?? true),
			...queryOptions,
		});
	}

	// Collection revert version hook
	function useCollectionRevertVersion<K extends CollectionNames<TApp>>(
		collection: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAdminStore(selectClient);
		const { locale: contentLocale } = useScopedLocale();
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "collections"] as const;
		const queryOpts = createQuestpieQueryOptions(client as any, {
			keyPrefix,
			locale: contentLocale,
		});

		const baseOptions =
			queryOpts.collections[collection as string].revertToVersion();
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
				queryClient.invalidateQueries({
					queryKey: listQueryKey,
				});
				queryClient.invalidateQueries({
					queryKey: countQueryKey,
				});
				queryClient.invalidateQueries({
					queryKey: itemQueryKey,
				});
				queryClient.invalidateQueries({
					queryKey: versionsQueryKey,
				});
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
		const client = useAdminStore(selectClient);
		const contentLocale = useAdminStore(selectContentLocale);
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions(
			client as any,
			{
				keyPrefix,
				locale: contentLocale,
			} as any,
		);

		return useQuery({
			...(queryOpts as any).globals[globalName as string].get({
				...options,
				locale: contentLocale,
			} as any),
			...queryOptions,
		});
	}

	// Global update hook
	function useGlobalUpdate<K extends GlobalNames<TApp>>(
		globalName: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAdminStore(selectClient);
		const contentLocale = useAdminStore(selectContentLocale);
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions(
			client as any,
			{
				keyPrefix,
				locale: contentLocale,
			} as any,
		);

		const globalQueryKey = queryOpts.key([
			"globals",
			globalName as string,
			"get",
			contentLocale,
		]);

		return useMutation({
			...(queryOpts as any).globals[globalName as string].update(),
			onSuccess: (data: any, variables: any, context: any) => {
				(mutationOptions?.onSuccess as any)?.(data, variables, context);
			},
			onSettled: (data: any, error: any, variables: any, context: any) => {
				queryClient.invalidateQueries({
					queryKey: globalQueryKey,
				});
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
		const client = useAdminStore(selectClient);
		const contentLocale = useAdminStore(selectContentLocale);
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions(
			client as any,
			{
				keyPrefix,
				locale: contentLocale,
			} as any,
		);

		return useQuery({
			...(queryOpts as any).globals[globalName as string].findVersions({
				...options,
				locale: contentLocale,
			}),
			...queryOptions,
		});
	}

	// Global revert version hook
	function useGlobalRevertVersion<K extends GlobalNames<TApp>>(
		globalName: K,
		mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
	): any {
		const client = useAdminStore(selectClient);
		const contentLocale = useAdminStore(selectContentLocale);
		const queryClient = useQueryClient();
		const keyPrefix = ["questpie", "globals"] as const;
		const queryOpts = createQuestpieQueryOptions(
			client as any,
			{
				keyPrefix,
				locale: contentLocale,
			} as any,
		);

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
			...(queryOpts as any).globals[globalName as string].revertToVersion(),
			onSuccess: (data: any, variables: any, context: any) => {
				(mutationOptions?.onSuccess as any)?.(data, variables, context);
			},
			onSettled: (data: any, error: any, variables: any, context: any) => {
				queryClient.invalidateQueries({
					queryKey: globalQueryKey,
				});
				queryClient.invalidateQueries({
					queryKey: versionsQueryKey,
				});
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
