import {
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { Questpie } from "questpie";
import * as React from "react";

import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

import type { RegisteredCMS, RegisteredGlobalNames } from "../builder/registry";
import { selectClient, selectContentLocale, useAdminStore } from "../runtime";

type GlobalRealtimeOptions = {
	realtime?: boolean;
};

const GLOBAL_QUERY_KEY_PREFIX = ["questpie", "globals"] as const;

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Resolved global names (string if not registered)
 */
type ResolvedGlobalNames =
	RegisteredCMS extends Questpie<any> ? RegisteredGlobalNames : string;

// ============================================================================
// Global Hooks
// ============================================================================

/**
 * Hook to fetch global settings
 *
 * Uses RegisteredCMS from module augmentation for automatic type inference.
 *
 * @example
 * ```tsx
 * // Types inferred from module augmentation!
 * const { data } = useGlobal("siteSettings");
 * ```
 */
export function useGlobal<K extends ResolvedGlobalNames>(
	globalName: K,
	options?: any,
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
	realtimeOptions?: GlobalRealtimeOptions,
): any {
	const client = useAdminStore(selectClient);
	const contentLocale = useAdminStore(selectContentLocale);
	const queryOpts = React.useMemo(
		() =>
			createQuestpieQueryOptions(client as any, {
				keyPrefix: GLOBAL_QUERY_KEY_PREFIX,
				locale: contentLocale,
			}),
		[client, contentLocale],
	);

	const globalOptions = {
		...options,
		locale: contentLocale,
	};

	// Pass realtime option to query options builder - this uses streamedQuery internally
	const baseQuery = (queryOpts as any).globals[globalName as string].get(
		globalOptions as any,
		{ realtime: realtimeOptions?.realtime },
	);

	return useQuery({
		...baseQuery,
		...queryOptions,
	});
}

/**
 * Hook to update global settings
 *
 * Uses RegisteredCMS from module augmentation for automatic type inference.
 *
 * @example
 * ```tsx
 * // Types inferred from module augmentation!
 * const { mutate } = useGlobalUpdate("siteSettings");
 * mutate({ data: { siteName: "New Name" } });
 * ```
 */
export function useGlobalUpdate<K extends ResolvedGlobalNames>(
	globalName: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const client = useAdminStore(selectClient);
	const contentLocale = useAdminStore(selectContentLocale);
	const queryClient = useQueryClient();
	const queryOpts = React.useMemo(
		() =>
			createQuestpieQueryOptions(client as any, {
				keyPrefix: GLOBAL_QUERY_KEY_PREFIX,
				locale: contentLocale,
			}),
		[client, contentLocale],
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

/**
 * Hook to fetch global version history
 */
export function useGlobalVersions<K extends ResolvedGlobalNames>(
	globalName: K,
	options?: { id?: string; limit?: number; offset?: number },
	queryOptions?: Omit<UseQueryOptions, "queryKey" | "queryFn">,
): any {
	const client = useAdminStore(selectClient);
	const contentLocale = useAdminStore(selectContentLocale);
	const queryOpts = React.useMemo(
		() =>
			createQuestpieQueryOptions(client as any, {
				keyPrefix: GLOBAL_QUERY_KEY_PREFIX,
				locale: contentLocale,
			}),
		[client, contentLocale],
	);

	const baseQuery = (queryOpts as any).globals[
		globalName as string
	].findVersions({
		...options,
		locale: contentLocale,
	});

	return useQuery({
		...baseQuery,
		...queryOptions,
	});
}

/**
 * Hook to revert global to a previous version
 */
export function useGlobalRevertVersion<K extends ResolvedGlobalNames>(
	globalName: K,
	mutationOptions?: Omit<UseMutationOptions, "mutationFn">,
): any {
	const client = useAdminStore(selectClient);
	const contentLocale = useAdminStore(selectContentLocale);
	const queryClient = useQueryClient();
	const queryOpts = React.useMemo(
		() =>
			createQuestpieQueryOptions(client as any, {
				keyPrefix: GLOBAL_QUERY_KEY_PREFIX,
				locale: contentLocale,
			}),
		[client, contentLocale],
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
