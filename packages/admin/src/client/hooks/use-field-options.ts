/**
 * Field Options Hook
 *
 * Fetches dynamic options for select/relation fields from the server.
 * Supports search, pagination, and dependency-based refetching.
 */

import type { SerializedOptionsConfig } from "questpie";
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useAdminStore } from "../runtime/provider.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Option item
 */
export interface OptionItem {
	value: string | number;
	label: string | Record<string, string>;
}

/**
 * Options for useFieldOptions hook
 */
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

/**
 * Result from useFieldOptions hook
 */
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

/**
 * Get sibling data for a field path (for fields inside arrays)
 */
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

/**
 * Get watched dependency values
 */
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

/**
 * Hook to fetch dynamic options for select/relation fields.
 * Supports search, pagination, and dependency-based refetching.
 *
 * @example
 * ```tsx
 * const { options, isLoading, search, setSearch, loadMore } = useFieldOptions({
 *   collection: "orders",
 *   field: "items.0.city",
 *   optionsConfig: schema.fields.city.reactive?.options,
 * });
 *
 * return (
 *   <Select
 *     options={options}
 *     isLoading={isLoading}
 *     onInputChange={setSearch}
 *     onMenuScrollToBottom={loadMore}
 *   />
 * );
 * ```
 */
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

	// State
	const [options, setOptions] = React.useState<OptionItem[]>([]);
	const [isLoading, setIsLoading] = React.useState(false);
	const [hasMore, setHasMore] = React.useState(false);
	const [total, setTotal] = React.useState<number | undefined>();
	const [search, setSearch] = React.useState(initialSearch);
	const [page, setPage] = React.useState(0);
	const [error, setError] = React.useState<Error | null>(null);

	// Watch form values for deps
	const watchedValues = useWatch({ control: form.control });
	const formValues = React.useMemo(
		() => (watchedValues ?? {}) as Record<string, any>,
		[watchedValues],
	);

	// Get sibling data
	const siblingData = React.useMemo(
		() => getSiblingData(formValues, field),
		[formValues, field],
	);

	// Get watched dep values for comparison
	const watchDeps = optionsConfig?.watch ?? [];
	const depValues = React.useMemo(
		() => getWatchedValues(formValues, siblingData, watchDeps),
		[formValues, siblingData, watchDeps],
	);
	const depKey = JSON.stringify(depValues);

	// Previous dep key for change detection
	const prevDepKeyRef = React.useRef(depKey);

	// Fetch options from server
	const fetchOptions = React.useCallback(
		async (currentPage: number, append: boolean = false) => {
			// If no dynamic config, use static options
			if (!optionsConfig || !client) {
				if (staticOptions) {
					let filtered = staticOptions;
					if (search) {
						const searchLower = search.toLowerCase();
						filtered = staticOptions.filter((opt) => {
							const label =
								typeof opt.label === "string"
									? opt.label
									: Object.values(opt.label).join(" ");
							return label.toLowerCase().includes(searchLower);
						});
					}
					setOptions(filtered);
					setHasMore(false);
					setTotal(filtered.length);
				}
				return;
			}

			setIsLoading(true);
			setError(null);

			try {
				const response = await (client.rpc as any).fieldOptions({
					collection,
					type: mode,
					field,
					formData: formValues,
					siblingData,
					search,
					page: currentPage,
					limit,
				});

				const newOptions = response.options as OptionItem[];

				if (append) {
					setOptions((prev) => [...prev, ...newOptions]);
				} else {
					setOptions(newOptions);
				}

				setHasMore(response.hasMore ?? false);
				setTotal(response.total);
			} catch (err) {
				console.error("Field options error:", err);
				setError(err instanceof Error ? err : new Error(String(err)));
			} finally {
				setIsLoading(false);
			}
		},
		[
			client,
			collection,
			mode,
			field,
			formValues,
			siblingData,
			search,
			limit,
			optionsConfig,
			staticOptions,
		],
	);

	// Effect to fetch options when deps change
	React.useEffect(() => {
		if (!enabled) return;

		// Check if deps changed
		if (prevDepKeyRef.current !== depKey) {
			prevDepKeyRef.current = depKey;
			setPage(0);
			fetchOptions(0, false);
		}
	}, [enabled, depKey, fetchOptions]);

	// Effect to fetch options when search changes
	const searchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	React.useEffect(() => {
		if (!enabled) return;

		if (searchDebounceRef.current) {
			clearTimeout(searchDebounceRef.current);
		}

		searchDebounceRef.current = setTimeout(() => {
			setPage(0);
			fetchOptions(0, false);
		}, 300); // Debounce search

		return () => {
			if (searchDebounceRef.current) {
				clearTimeout(searchDebounceRef.current);
			}
		};
	}, [enabled, search, fetchOptions]);

	// Initial fetch
	React.useEffect(() => {
		if (enabled) {
			fetchOptions(0, false);
		}
		// Only run on mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Load more handler
	const loadMore = React.useCallback(() => {
		if (isLoading || !hasMore) return;
		const nextPage = page + 1;
		setPage(nextPage);
		fetchOptions(nextPage, true);
	}, [isLoading, hasMore, page, fetchOptions]);

	// Refresh handler
	const refresh = React.useCallback(() => {
		setPage(0);
		fetchOptions(0, false);
	}, [fetchOptions]);

	return {
		options,
		isLoading,
		hasMore,
		total,
		search,
		setSearch,
		loadMore,
		refresh,
		error,
	};
}
