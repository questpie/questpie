import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { SerializedOptionsConfig } from "questpie";
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { useAdminStore } from "../runtime/provider.js";
import { useDebouncedValue } from "./use-search.js";

// ============================================================================
// Types
// ============================================================================

export interface OptionItem {
	value: string | number;
	label: string | Record<string, string>;
}

export interface UseFieldOptionsOptions {
	/** Collection or global name */
	collection: string;

	/** Entity type - collection or global */
	mode?: "collection" | "global";

	/** Field path */
	field: string;

	/** Options config from introspection */
	optionsConfig?: SerializedOptionsConfig;

	/** Static options (fallback if no dynamic config) */
	staticOptions?: OptionItem[];

	/** Initial search query */
	initialSearch?: string;

	/** Items per page */
	limit?: number;

	/** Whether to enable fetching */
	enabled?: boolean;
}

export interface UseFieldOptionsResult {
	/** Current options */
	options: OptionItem[];

	/** Whether options are loading */
	isLoading: boolean;

	/** Whether more options are available */
	hasMore: boolean;

	/** Total count (if available) */
	total?: number;

	/** Current search query */
	search: string;

	/** Set search query */
	setSearch: (search: string) => void;

	/** Load more options (pagination) */
	loadMore: () => void;

	/** Refresh options */
	refresh: () => void;

	/** Error */
	error: Error | null;
}

// ============================================================================
// Utility Functions
// ============================================================================

function getSiblingData(
	values: Record<string, any>,
	fieldPath: string,
): Record<string, any> | null {
	const parts = fieldPath.split(".");
	const numericIndex = parts.findIndex((p) => /^\d+$/.test(p));

	if (numericIndex === -1) {
		return null;
	}

	const arrayItemPath = parts.slice(0, numericIndex + 1).join(".");

	let sibling = values;
	for (const part of arrayItemPath.split(".")) {
		if (sibling && typeof sibling === "object") {
			sibling = sibling[part];
		} else {
			return null;
		}
	}

	return typeof sibling === "object" ? sibling : null;
}

function getWatchedValues(
	allValues: Record<string, any>,
	siblingData: Record<string, any> | null,
	watchDeps: string[],
): Record<string, any> {
	const result: Record<string, any> = {};

	for (const dep of watchDeps) {
		if (dep.startsWith("$sibling.")) {
			const siblingKey = dep.slice("$sibling.".length);
			result[dep] = siblingData?.[siblingKey];
		} else if (!dep.startsWith("$")) {
			result[dep] = allValues[dep];
		}
	}

	return result;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useFieldOptions({
	collection,
	mode = "collection",
	field,
	optionsConfig,
	staticOptions,
	initialSearch = "",
	limit = 20,
	enabled = true,
}: UseFieldOptionsOptions): UseFieldOptionsResult {
	const client = useAdminStore((s) => s.client);
	const form = useFormContext();
	const queryClient = useQueryClient();

	const [search, setSearch] = React.useState(initialSearch);
	const debouncedSearch = useDebouncedValue(search, 300);

	const watchedValues = useWatch({ control: form.control });
	const formValues = React.useMemo(
		() => (watchedValues ?? {}) as Record<string, any>,
		[watchedValues],
	);
	const siblingData = React.useMemo(
		() => getSiblingData(formValues, field),
		[formValues, field],
	);
	const watchDeps = optionsConfig?.watch ?? [];
	const depValues = React.useMemo(
		() => getWatchedValues(formValues, siblingData, watchDeps),
		[formValues, siblingData, watchDeps],
	);
	const depKey = JSON.stringify(depValues);

	const filteredStaticOptions = React.useMemo(() => {
		if (optionsConfig || !staticOptions) return null;
		if (!debouncedSearch) return staticOptions;
		const searchLower = debouncedSearch.toLowerCase();
		return staticOptions.filter((opt) => {
			const label =
				typeof opt.label === "string"
					? opt.label
					: Object.values(opt.label).join(" ");
			return label.toLowerCase().includes(searchLower);
		});
	}, [optionsConfig, staticOptions, debouncedSearch]);

	const {
		data,
		isLoading: queryLoading,
		error: queryError,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useInfiniteQuery({
		queryKey: [
			"questpie",
			"field-options",
			collection,
			mode,
			field,
			debouncedSearch,
			depKey,
		],
		queryFn: async ({ pageParam = 0 }) => {
			const currentFormValues = (form.getValues() ?? {}) as Record<string, any>;
			const currentSiblingData = getSiblingData(currentFormValues, field);
			const response = await (client!.routes as any).fieldOptions({
				collection,
				type: mode,
				field,
				formData: currentFormValues,
				siblingData: currentSiblingData,
				search: debouncedSearch,
				page: pageParam,
				limit,
			});
			return {
				options: response.options as OptionItem[],
				hasMore: response.hasMore ?? false,
				total: response.total as number | undefined,
				page: pageParam,
			};
		},
		initialPageParam: 0,
		getNextPageParam: (lastPage) =>
			lastPage.hasMore ? lastPage.page + 1 : undefined,
		enabled: enabled && !!optionsConfig && !!client,
		staleTime: 10_000,
		placeholderData: (prev) => prev,
	});

	const serverOptions = React.useMemo(() => {
		if (!data) return [];
		return data.pages.flatMap((page) => page.options);
	}, [data]);

	const total = data?.pages[data.pages.length - 1]?.total;

	const options = filteredStaticOptions ?? serverOptions;
	const isLoading = filteredStaticOptions ? false : queryLoading;
	const hasMore = filteredStaticOptions ? false : (hasNextPage ?? false);

	const loadMore = React.useCallback(() => {
		if (!isFetchingNextPage && hasNextPage) {
			fetchNextPage();
		}
	}, [isFetchingNextPage, hasNextPage, fetchNextPage]);

	const refresh = React.useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: ["questpie", "field-options", collection, mode, field],
		});
	}, [queryClient, collection, mode, field]);

	return {
		options,
		isLoading,
		hasMore,
		total,
		search,
		setSearch,
		loadMore,
		refresh,
		error: (queryError as Error) ?? null,
	};
}
