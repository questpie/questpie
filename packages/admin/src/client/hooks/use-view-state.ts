import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FilterRule,
  SortConfig,
  ViewConfiguration,
} from "../components/filter-builder/types.js";
import {
  useAdminPreference,
  useSetAdminPreference,
} from "./use-admin-preferences.js";

const EMPTY_CONFIG: ViewConfiguration = {
  filters: [],
  sortConfig: null,
  visibleColumns: [],
  realtime: undefined,
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
 * Hook to manage view configuration state with database persistence
 *
 * Syncs view state (filters, sort, visible columns) to the adminPreferences
 * collection in the database. Falls back to local state when:
 * - User is not logged in
 * - adminPreferences collection is not available
 * - Data is still loading
 *
 * @param defaultColumns - Default columns to show when no config is set
 * @param initialConfig - Optional initial configuration to start with
 * @param collectionName - Collection name for preference key
 *
 * @example
 * ```tsx
 * const viewState = useViewState(
 *   ["_title", "status", "createdAt"],
 *   undefined,
 *   "posts"
 * );
 *
 * // Use view state
 * const { config, setVisibleColumns, toggleSort } = viewState;
 * ```
 */
export function useViewState(
  defaultColumns: string[],
  initialConfig?: Partial<ViewConfiguration>,
  collectionName?: string,
) {
  // Preference key for this collection
  const preferenceKey = collectionName
    ? getPreferenceKey(collectionName)
    : null;

  // Fetch stored preference from DB
  const { data: storedConfig, isLoading: isLoadingPreference } =
    useAdminPreference<ViewConfiguration>(preferenceKey ?? "");

  // Mutation to save preference
  const { mutate: savePreference } = useSetAdminPreference<ViewConfiguration>(
    preferenceKey ?? "",
  );

  // Track if we've initialized from DB
  const [hasInitialized, setHasInitialized] = useState(false);

  // Local state for immediate updates
  const [config, setConfigState] = useState<ViewConfiguration>(() => {
    // Start with initial config or defaults
    return {
      filters: initialConfig?.filters ?? [],
      sortConfig: initialConfig?.sortConfig ?? null,
      visibleColumns: initialConfig?.visibleColumns?.length
        ? initialConfig.visibleColumns
        : defaultColumns,
      realtime: initialConfig?.realtime,
    };
  });

  // Sync from DB when data loads
  useEffect(() => {
    if (
      !isLoadingPreference &&
      storedConfig &&
      preferenceKey &&
      !hasInitialized
    ) {
      setHasInitialized(true);
      setConfigState({
        filters: storedConfig.filters ?? [],
        sortConfig: storedConfig.sortConfig ?? null,
        visibleColumns: mergeVisibleColumns(
          storedConfig.visibleColumns,
          defaultColumns,
        ),
        realtime:
          storedConfig.realtime !== undefined
            ? storedConfig.realtime
            : initialConfig?.realtime,
      });
    } else if (!isLoadingPreference && !storedConfig && !hasInitialized) {
      // No stored config - use defaults
      setHasInitialized(true);
    }
  }, [
    isLoadingPreference,
    storedConfig,
    preferenceKey,
    hasInitialized,
    defaultColumns,
    initialConfig?.realtime,
  ]);

  // Debounced save to DB
  const saveTimeoutRef = useMemo(
    () => ({ current: null as NodeJS.Timeout | null }),
    [],
  );

  const saveToDb = useCallback(
    (newConfig: ViewConfiguration) => {
      if (!preferenceKey) return;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce save to avoid too many requests
      saveTimeoutRef.current = setTimeout(() => {
        savePreference(newConfig);
      }, 500);
    },
    [preferenceKey, savePreference, saveTimeoutRef],
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [saveTimeoutRef]);

  // Wrapper for setConfig that also persists
  const setConfig = useCallback(
    (
      newConfig:
        | ViewConfiguration
        | ((prev: ViewConfiguration) => ViewConfiguration),
    ) => {
      setConfigState((prev) => {
        const next =
          typeof newConfig === "function" ? newConfig(prev) : newConfig;
        saveToDb(next);
        return next;
      });
    },
    [saveToDb],
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
      config.realtime !== initialConfig?.realtime ||
      JSON.stringify([...config.visibleColumns].sort()) !==
        JSON.stringify([...defaultColumns].sort())
    );
  }, [config, defaultColumns, initialConfig?.realtime]);

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
    toggleColumn,
    loadConfig,
    resetConfig,
    hasChanges,
    // Additional state for loading indicator
    isLoading: isLoadingPreference && !hasInitialized,
  };
}
