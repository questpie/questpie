/**
 * Reactive Fields Hook
 *
 * Watches form changes and triggers server-side reactive handlers.
 * Supports batched RPC calls with debouncing.
 */

import type { FieldReactiveSchema } from "questpie/client";
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useAdminStore } from "../runtime/provider.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Reactive field state
 */
export interface ReactiveFieldState {
	hidden?: boolean;
	readOnly?: boolean;
	disabled?: boolean;
}

/**
 * Reactive field result
 */
export interface ReactiveFieldResult {
	field: string;
	type: "hidden" | "readOnly" | "disabled" | "compute";
	value: unknown;
	error?: string;
}

/**
 * Options for useReactiveFields hook
 */
export interface UseReactiveFieldsOptions {
	/** Collection or global name */
	collection: string;

	/** Entity type - collection or global */
	mode?: "collection" | "global";

	/** Map of field paths to their reactive configs */
	reactiveConfigs: Record<string, FieldReactiveSchema>;

	/** Debounce delay in ms */
	debounce?: number;

	/** Whether to enable reactive updates */
	enabled?: boolean;
}

/**
 * Result from useReactiveFields hook
 */
export interface UseReactiveFieldsResult {
	/** Field states (hidden, readOnly, disabled) by field path */
	fieldStates: Record<string, ReactiveFieldState>;

	/** Whether a reactive update is pending */
	isPending: boolean;

	/** Last error */
	error: Error | null;

	/** Force refresh reactive states */
	refresh: () => void;
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
	// Check if field is inside an array (e.g., "items.0.variant")
	const parts = fieldPath.split(".");
	const numericIndex = parts.findIndex((p) => /^\d+$/.test(p));

	if (numericIndex === -1) {
		// Not in array
		return null;
	}

	// Get the array item path (e.g., "items.0")
	const arrayItemPath = parts.slice(0, numericIndex + 1).join(".");

	// Navigate to the array item
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
 * Build watch dependencies from reactive configs
 */
function buildWatchDependencies(
	reactiveConfigs: Record<string, FieldReactiveSchema>,
): Set<string> {
	const deps = new Set<string>();

	for (const config of Object.values(reactiveConfigs)) {
		// Add deps from hidden, readOnly, disabled, compute
		for (const key of ["hidden", "readOnly", "disabled", "compute"] as const) {
			const reactiveConfig = config[key];
			if (reactiveConfig?.watch) {
				for (const dep of reactiveConfig.watch) {
					// Filter out sibling deps ($sibling.*) for root-level watching
					if (!dep.startsWith("$")) {
						deps.add(dep);
					}
				}
			}
		}
	}

	return deps;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook to manage reactive field states.
 * Watches form changes and triggers server-side handlers when dependencies change.
 *
 * @example
 * ```tsx
 * const { fieldStates, isPending } = useReactiveFields({
 *   collection: "posts",
 *   reactiveConfigs: fieldsWithReactive,
 * });
 *
 * // Apply states to fields
 * const isHidden = fieldStates["slug"]?.hidden ?? false;
 * const isReadOnly = fieldStates["slug"]?.readOnly ?? false;
 * ```
 */
export function useReactiveFields({
	collection,
	mode = "collection",
	reactiveConfigs,
	debounce = 100,
	enabled = true,
}: UseReactiveFieldsOptions): UseReactiveFieldsResult {
	const client = useAdminStore((s) => s.client);
	const form = useFormContext();

	// State
	const [fieldStates, setFieldStates] = React.useState<
		Record<string, ReactiveFieldState>
	>({});
	const [isPending, setIsPending] = React.useState(false);
	const [error, setError] = React.useState<Error | null>(null);

	// Build list of dependencies to watch
	const watchDeps = React.useMemo(
		() => buildWatchDependencies(reactiveConfigs),
		[reactiveConfigs],
	);

	// Watch form values
	const watchedValues = useWatch({ control: form.control });
	const formValues = React.useMemo(
		() => (watchedValues ?? {}) as Record<string, any>,
		[watchedValues],
	);

	// Previous values ref for change detection
	const prevValuesRef = React.useRef<Record<string, any>>({});

	// Debounce timer ref
	const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	// Fetch reactive states from server
	const fetchReactiveStates = React.useCallback(async () => {
		if (!enabled || !client || Object.keys(reactiveConfigs).length === 0) {
			return;
		}

		// Build batch requests
		const requests: Array<{
			field: string;
			type: "hidden" | "readOnly" | "disabled" | "compute";
			formData: Record<string, any>;
			siblingData: Record<string, any> | null;
			prevData: Record<string, any> | null;
			prevSiblingData: Record<string, any> | null;
		}> = [];

		for (const [fieldPath, config] of Object.entries(reactiveConfigs)) {
			const siblingData = getSiblingData(formValues, fieldPath);
			const prevSiblingData = getSiblingData(prevValuesRef.current, fieldPath);

			// Add request for each reactive type that has a config
			for (const type of [
				"hidden",
				"readOnly",
				"disabled",
				"compute",
			] as const) {
				if (config[type]?.watch) {
					requests.push({
						field: fieldPath,
						type,
						formData: formValues,
						siblingData,
						prevData: prevValuesRef.current,
						prevSiblingData,
					});
				}
			}
		}

		if (requests.length === 0) {
			return;
		}

		setIsPending(true);
		setError(null);

		try {
			const response = await (client.rpc as any).batchReactive({
				collection,
				type: mode,
				requests,
			});

			// Update field states
			const newStates: Record<string, ReactiveFieldState> = { ...fieldStates };

			for (const result of response.results as ReactiveFieldResult[]) {
				if (!newStates[result.field]) {
					newStates[result.field] = {};
				}

				if (result.type === "compute") {
					// Apply computed value to form
					if (result.value !== undefined) {
						form.setValue(result.field, result.value, {
							shouldDirty: true,
							shouldTouch: false,
							shouldValidate: false,
						});
					}
				} else {
					// Update field state
					newStates[result.field][result.type] = result.value as boolean;
				}
			}

			setFieldStates(newStates);
		} catch (err) {
			console.error("Reactive fields error:", err);
			setError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			setIsPending(false);
		}
	}, [
		enabled,
		client,
		collection,
		mode,
		reactiveConfigs,
		formValues,
		fieldStates,
		form,
	]);

	// Track if we've done initial fetch (to avoid running on empty form data)
	const isInitializedRef = React.useRef(false);

	// Effect to trigger reactive updates on dep changes
	// Also handles initial fetch when form data becomes available (fixes race condition)
	React.useEffect(() => {
		if (!enabled || watchDeps.size === 0) return;

		// Check if form has actual data (not empty defaults)
		// This prevents fetching before form data is loaded
		const hasFormData = Object.keys(formValues).some(
			(key) => formValues[key] !== undefined && formValues[key] !== null,
		);
		if (!hasFormData) return;

		// Initial fetch when data first becomes available
		if (!isInitializedRef.current) {
			isInitializedRef.current = true;
			prevValuesRef.current = { ...formValues };
			fetchReactiveStates();
			return;
		}

		// Check if any watched deps changed
		let hasChanges = false;
		for (const dep of watchDeps) {
			if (formValues[dep] !== prevValuesRef.current[dep]) {
				hasChanges = true;
				break;
			}
		}

		if (!hasChanges) return;

		// Update prev values
		prevValuesRef.current = { ...formValues };

		// Debounce the fetch
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => {
			fetchReactiveStates();
		}, debounce);

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [enabled, watchDeps, formValues, debounce, fetchReactiveStates]);

	// Refresh function
	const refresh = React.useCallback(() => {
		fetchReactiveStates();
	}, [fetchReactiveStates]);

	return {
		fieldStates,
		isPending,
		error,
		refresh,
	};
}
