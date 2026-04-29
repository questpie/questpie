import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type {
	FilterRule,
	SortConfig,
	ViewConfiguration,
} from "../components/filter-builder/types.js";
import { useAdminStore } from "../runtime/provider.js";
import {
	getAdminPreferenceQueryKey,
	useSetAdminPreference,
} from "./use-admin-preferences.js";

const EMPTY_CONFIG: ViewConfiguration = {
	filters: [],
	sortConfig: null,
	visibleColumns: [],
	groupBy: null,
	collapsedGroups: [],
	realtime: undefined,
	includeDeleted: false,
	pagination: { page: 1, pageSize: 25 },
};

/**
 * Get the preference key for a collection's view state
 */
function getPreferenceKey(collectionName: string): string {
	return `viewState:${collectionName}`;
}

/**
 * Merge stored visible columns with default columns to include new fields
 *
 * When a new field is added to the collection, it should appear in the column picker
 * but not automatically become visible (preserving user's existing preference).
 *
 * The merge logic:
 * 1. Start with stored visible columns (in user's preferred order)
 * 2. New columns that weren't in the previous default set are NOT auto-added to visible
 *    (they appear in column picker but hidden by default)
 */
function mergeVisibleColumns(
	storedColumns: string[] | undefined,
	defaultColumns: string[],
): string[] {
	// If no stored columns, use defaults
	if (!storedColumns?.length) {
		return defaultColumns;
	}

	// Return stored columns as-is
	// New columns are available in the column picker but not auto-visible
	return storedColumns;
}

/**
 * Hook to manage view configuration state with database persistence.
 *
 * Uses Suspense for loading and queryClient for optimistic updates.
 * Must be used within a Suspense boundary.
 *
 * Architecture:
 * - Query data is the single source of truth
 * - Config is derived (useMemo) from query data + defaults
 * - Updates use optimistic mutations via queryClient.setQueryData
 * - Changes are debounced and persisted to DB
 *
 * @param defaultColumns - Default columns to show when no config is set
 * @param initialConfig - Optional initial configuration to start with
 * @param collectionName - Collection name for preference key
 * @param userId - User ID (required - must be available, use inside Suspense after auth)
 *
 * @example
 * ```tsx
 * // Inside Suspense boundary, after user is loaded
 * function TableViewInner({ collection, userId }) {
 *   const viewState = useViewState(
 *     ["_title", "status", "createdAt"],
 *     undefined,
 *     collection,
 *     userId
 *   );
 *
 *   // config is guaranteed to be ready
 *   const { config, setVisibleColumns, toggleSort } = viewState;
 * }
 * ```
 */
export function useViewState(
	defaultColumns: string[],
	initialConfig?: Partial<ViewConfiguration>,
	collectionName?: string,
	userId?: string,
) {
	const queryClient = useQueryClient();
	const client = useAdminStore((s) => s.client);

	// Preference key for this collection
	const preferenceKey = collectionName
		? getPreferenceKey(collectionName)
		: null;

	// Query key for cache operations
	const queryKey = getAdminPreferenceQueryKey(userId, preferenceKey ?? "");

	// Fetch stored preference from DB using Suspense
	// This will suspend until data is loaded
	const { data: storedConfig } = useSuspenseQuery<ViewConfiguration | null>({
		queryKey,
		queryFn: async (): Promise<ViewConfiguration | null> => {
			if (!userId || !preferenceKey) return null;

			const result = await (
				client.collections as any
			).admin_preferences.findOne({
				where: { userId, key: preferenceKey },
			});

			return ((result as any)?.value as unknown as ViewConfiguration) ?? null;
		},
	});

	// Mutation to save preference
	const { mutate: savePreference } = useSetAdminPreference<ViewConfiguration>(
		preferenceKey ?? "",
	);

	// DERIVED state from query - no useState needed!
	// This is the single source of truth pattern
	const config = useMemo<ViewConfiguration>(() => {
		if (storedConfig) {
			return {
				filters: storedConfig.filters ?? [],
				sortConfig: storedConfig.sortConfig ?? null,
				visibleColumns: mergeVisibleColumns(
					storedConfig.visibleColumns,
					defaultColumns,
				),
				groupBy:
					storedConfig.groupBy !== undefined
						? storedConfig.groupBy
						: (initialConfig?.groupBy ?? null),
				collapsedGroups: storedConfig.collapsedGroups ?? [],
				realtime:
					storedConfig.realtime !== undefined
						? storedConfig.realtime
						: initialConfig?.realtime,
				includeDeleted:
					storedConfig.includeDeleted !== undefined
						? storedConfig.includeDeleted
						: (initialConfig?.includeDeleted ?? false),
				pagination: storedConfig.pagination ?? { page: 1, pageSize: 25 },
			};
		}

		// No stored config - use defaults
		return {
			filters: initialConfig?.filters ?? [],
			sortConfig: initialConfig?.sortConfig ?? null,
			visibleColumns: defaultColumns,
			groupBy: initialConfig?.groupBy ?? null,
			collapsedGroups: initialConfig?.collapsedGroups ?? [],
			realtime: initialConfig?.realtime,
			includeDeleted: initialConfig?.includeDeleted ?? false,
			pagination: initialConfig?.pagination ?? { page: 1, pageSize: 25 },
		};
	}, [storedConfig, defaultColumns, initialConfig]);

	// Debounce ref for save
	const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}
		};
	}, []);

	// Update config with optimistic update + debounced persist
	const setConfig = useCallback(
		(
			newConfig:
				| ViewConfiguration
				| ((prev: ViewConfiguration) => ViewConfiguration),
		) => {
			const next =
				typeof newConfig === "function" ? newConfig(config) : newConfig;

			// OPTIMISTIC UPDATE - immediately update query cache
			// This makes UI instantly responsive
			if (preferenceKey && userId) {
				queryClient.setQueryData<ViewConfiguration | null>(queryKey, next);
			}

			// Debounced persist to DB
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}

			saveTimeoutRef.current = setTimeout(() => {
				if (preferenceKey) {
					savePreference(next);
				}
			}, 500);
		},
		[config, preferenceKey, userId, queryClient, queryKey, savePreference],
	);

	// Add a filter
	const addFilter = useCallback(
		(filter: FilterRule) => {
			setConfig((prev) => ({
				...prev,
				filters: [...prev.filters, filter],
			}));
		},
		[setConfig],
	);

	// Remove a filter by ID
	const removeFilter = useCallback(
		(filterId: string) => {
			setConfig((prev) => ({
				...prev,
				filters: prev.filters.filter((f) => f.id !== filterId),
			}));
		},
		[setConfig],
	);

	// Update a filter by ID
	const updateFilter = useCallback(
		(filterId: string, updates: Partial<FilterRule>) => {
			setConfig((prev) => ({
				...prev,
				filters: prev.filters.map((f) =>
					f.id === filterId ? { ...f, ...updates } : f,
				),
			}));
		},
		[setConfig],
	);

	// Clear all filters
	const clearFilters = useCallback(() => {
		setConfig((prev) => ({
			...prev,
			filters: [],
		}));
	}, [setConfig]);

	// Set sort configuration
	const setSort = useCallback(
		(sortConfig: SortConfig | null) => {
			setConfig((prev) => ({ ...prev, sortConfig }));
		},
		[setConfig],
	);

	// Toggle sort on a field
	const toggleSort = useCallback(
		(field: string) => {
			setConfig((prev) => {
				if (prev.sortConfig?.field === field) {
					if (prev.sortConfig.direction === "asc") {
						return { ...prev, sortConfig: { field, direction: "desc" } };
					}
					return { ...prev, sortConfig: null };
				}
				return { ...prev, sortConfig: { field, direction: "asc" } };
			});
		},
		[setConfig],
	);

	// Set visible columns
	const setVisibleColumns = useCallback(
		(columns: string[]) => {
			setConfig((prev) => ({ ...prev, visibleColumns: columns }));
		},
		[setConfig],
	);

	const setGroupBy = useCallback(
		(groupBy: string | null) => {
			setConfig((prev) => ({
				...prev,
				groupBy,
				collapsedGroups: [],
				pagination: { ...(prev.pagination ?? { pageSize: 25 }), page: 1 },
			}));
		},
		[setConfig],
	);

	const toggleCollapsedGroup = useCallback(
		(groupKey: string) => {
			setConfig((prev) => {
				const collapsedGroups = prev.collapsedGroups ?? [];
				return {
					...prev,
					collapsedGroups: collapsedGroups.includes(groupKey)
						? collapsedGroups.filter((key) => key !== groupKey)
						: [...collapsedGroups, groupKey],
				};
			});
		},
		[setConfig],
	);

	// Set page number
	const setPage = useCallback(
		(page: number) => {
			setConfig((prev) => ({
				...prev,
				pagination: { ...prev.pagination!, page },
			}));
		},
		[setConfig],
	);

	// Set page size and reset to page 1
	const setPageSize = useCallback(
		(pageSize: number) => {
			setConfig((prev) => ({
				...prev,
				pagination: { page: 1, pageSize },
			}));
		},
		[setConfig],
	);

	// Toggle column visibility
	const toggleColumn = useCallback(
		(column: string) => {
			setConfig((prev) => {
				if (prev.visibleColumns.includes(column)) {
					return {
						...prev,
						visibleColumns: prev.visibleColumns.filter((c) => c !== column),
					};
				}
				return {
					...prev,
					visibleColumns: [...prev.visibleColumns, column],
				};
			});
		},
		[setConfig],
	);

	// Load a complete configuration
	const loadConfig = useCallback(
		(newConfig: ViewConfiguration) => {
			setConfig(newConfig);
		},
		[setConfig],
	);

	// Reset to default configuration
	const resetConfig = useCallback(() => {
		setConfig({
			...EMPTY_CONFIG,
			visibleColumns: defaultColumns,
		});
	}, [setConfig, defaultColumns]);

	// Check if config has any changes from default
	const hasChanges = useMemo(() => {
		return (
			config.filters.length > 0 ||
			config.sortConfig !== null ||
			(config.groupBy ?? null) !== (initialConfig?.groupBy ?? null) ||
			(config.collapsedGroups?.length ?? 0) > 0 ||
			config.realtime !== initialConfig?.realtime ||
			(config.includeDeleted ?? false) !==
				(initialConfig?.includeDeleted ?? false) ||
			config.pagination?.page !== 1 ||
			config.pagination?.pageSize !== 25 ||
			JSON.stringify([...config.visibleColumns].sort()) !==
				JSON.stringify([...defaultColumns].sort())
		);
	}, [
		config,
		defaultColumns,
		initialConfig?.includeDeleted,
		initialConfig?.groupBy,
		initialConfig?.realtime,
	]);

	return {
		config,
		setConfig,
		addFilter,
		removeFilter,
		updateFilter,
		clearFilters,
		setSort,
		toggleSort,
		setVisibleColumns,
		setGroupBy,
		toggleCollapsedGroup,
		toggleColumn,
		setPage,
		setPageSize,
		loadConfig,
		resetConfig,
		hasChanges,
		// No loading state needed - Suspense handles it
		isLoading: false,
	};
}
