/**
 * Field Hooks
 *
 * React hooks for field-level compute, onChange handlers, and async options.
 * Uses Proxy-based dependency tracking for automatic reactivity.
 *
 * Best Practices:
 * - useWatch() hook for reactive form values (React pattern)
 * - form.getValues() only inside callbacks/effects (one-time reads)
 * - useMemo for computed values to avoid unnecessary recalculations
 */

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";

import type {
	FieldHookContext,
	SelectOption,
} from "../builder/types/field-types";
import { trackDependencies } from "../utils/dependency-tracker.js";

// ============================================================================
// Types
// ============================================================================

interface UseFieldHooksOptions {
	/**
	 * Field name
	 */
	fieldName: string;

	/**
	 * Field name with prefix (for nested fields)
	 */
	fullFieldName: string;

	/**
	 * Current locale
	 */
	locale?: string;

	/**
	 * Compute function (proxy-tracked)
	 */
	compute?: (values: Record<string, any>) => any;

	/**
	 * onChange callback from field config
	 */
	onChange?: (value: any, ctx: FieldHookContext) => void | Promise<void>;

	/**
	 * Default value (static, sync function, or async function)
	 */
	defaultValue?:
		| any
		| ((values: Record<string, any>) => any)
		| ((values: Record<string, any>) => Promise<any>);

	/**
	 * Async options loader (proxy-tracked)
	 */
	loadOptions?: (values: Record<string, any>) => Promise<SelectOption[]>;

	/**
	 * Static options (from config)
	 */
	staticOptions?: SelectOption[];
}

interface UseFieldHooksResult {
	/**
	 * Wrapped onChange handler that calls user's onChange hook
	 */
	handleChange: (value: any) => void;

	/**
	 * Computed value (if compute is provided)
	 */
	computedValue: any;

	/**
	 * Whether this field has a compute function (implies readonly)
	 */
	isComputed: boolean;

	/**
	 * Resolved options (from static, sync function, or async loader)
	 */
	options: SelectOption[] | undefined;

	/**
	 * Whether options are loading
	 */
	optionsLoading: boolean;
}

// ============================================================================
// Hook Context Factory
// ============================================================================

function createHookContext(
	form: ReturnType<typeof useFormContext>,
	fieldName: string,
	locale?: string,
): FieldHookContext {
	return {
		fieldName,
		locale,
		setValue: (name: string, value: any) => {
			form.setValue(name, value, {
				shouldDirty: true,
				shouldTouch: true,
				shouldValidate: false,
			});
		},
		getValues: () => form.getValues(),
		getValue: (name: string) => form.getValues(name),
	};
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook for implementing field-level hooks (compute, onChange, loadOptions).
 * Uses Proxy-based dependency tracking for automatic reactivity.
 *
 * @example
 * ```tsx
 * const { handleChange, computedValue, isComputed, options, optionsLoading } = useFieldHooks({
 *   fieldName: 'pricePerMinute',
 *   fullFieldName: 'pricePerMinute',
 *   compute: (values) => values.price / values.duration,
 * });
 * ```
 */
export function useFieldHooks({
	fieldName,
	fullFieldName,
	locale,
	compute,
	onChange,
	defaultValue,
	loadOptions,
	staticOptions,
}: UseFieldHooksOptions): UseFieldHooksResult {
	const form = useFormContext();

	// Track dependencies for loadOptions (stored in state to trigger re-render when detected)
	const [loadOptionsDeps, setLoadOptionsDeps] = React.useState<string[]>([]);
	const [computeDeps, setComputeDeps] = React.useState<string[]>([]);

	// Create stable hook context
	const hookCtx = React.useMemo(
		() => createHookContext(form, fieldName, locale),
		[form, fieldName, locale],
	);

	// ========================================================================
	// Detect compute dependencies
	// ========================================================================

	React.useEffect(() => {
		if (!compute) {
			setComputeDeps([]);
			return;
		}

		const values = (form.getValues() ?? {}) as Record<string, any>;
		const tracked = trackDependencies(values, compute);
		setComputeDeps([...new Set(tracked.deps)]);
	}, [compute, form]);

	// ========================================================================
	// Detect loadOptions dependencies
	// ========================================================================

	React.useEffect(() => {
		if (!loadOptions) {
			setLoadOptionsDeps([]);
			return;
		}

		// Run loadOptions once with a tracking proxy to detect deps
		const values = (form.getValues() ?? {}) as Record<string, any>;
		const tracked = trackDependencies(values, (proxyValues) => {
			void loadOptions(proxyValues);
			return null;
		});

		setLoadOptionsDeps([...new Set(tracked.deps)]);
	}, [loadOptions, form]);

	const watchedDeps = React.useMemo(
		() => [...new Set([...computeDeps, ...loadOptionsDeps])],
		[computeDeps, loadOptionsDeps],
	);

	const watchedDepValues = useWatch({
		control: form.control,
		name: watchedDeps as any,
		disabled: watchedDeps.length === 0,
	});

	const watchedDepMap = React.useMemo(() => {
		const depMap: Record<string, unknown> = {};

		if (watchedDeps.length === 0) {
			return depMap;
		}

		const values = Array.isArray(watchedDepValues)
			? watchedDepValues
			: [watchedDepValues];

		for (const [index, dep] of watchedDeps.entries()) {
			depMap[dep] = values[index];
		}

		return depMap;
	}, [watchedDeps, watchedDepValues]);

	const computeDepKey = React.useMemo(() => {
		if (!computeDeps.length) return "";
		return JSON.stringify(computeDeps.map((dep) => watchedDepMap[dep]));
	}, [computeDeps, watchedDepMap]);

	// ========================================================================
	// Computed Value (reactive via useWatch + useMemo)
	// ========================================================================

	// Use useMemo for computed value - recomputes when tracked deps change
	// This is the proper React pattern: derived state via useMemo
	const computedValue = React.useMemo(() => {
		if (!compute) return undefined;
		try {
			void computeDepKey;
			const values = (form.getValues() ?? {}) as Record<string, any>;
			return compute(values);
		} catch (error) {
			console.error(`Compute error for ${fieldName}:`, error);
			return undefined;
		}
	}, [compute, form, fieldName, computeDepKey]);

	// ========================================================================
	// Default Value Effect
	// ========================================================================

	const defaultValueInitialized = React.useRef(false);

	React.useEffect(() => {
		if (defaultValueInitialized.current) return;
		if (defaultValue === undefined) return;
		// Don't set default for computed fields
		if (compute) {
			defaultValueInitialized.current = true;
			return;
		}

		const currentValue = form.getValues(fullFieldName);
		if (currentValue !== undefined && currentValue !== null) {
			defaultValueInitialized.current = true;
			return;
		}

		const initDefaultValue = async () => {
			let resolvedValue: any;

			if (typeof defaultValue === "function") {
				const values = form.getValues();
				resolvedValue = await Promise.resolve(defaultValue(values));
			} else {
				resolvedValue = defaultValue;
			}

			// Double-check value hasn't been set while we were resolving
			const currentVal = form.getValues(fullFieldName);
			if (currentVal === undefined || currentVal === null) {
				form.setValue(fullFieldName, resolvedValue, {
					shouldDirty: false,
					shouldTouch: false,
				});
			}

			defaultValueInitialized.current = true;
		};

		initDefaultValue();
	}, [defaultValue, fullFieldName, form, compute]);

	// ========================================================================
	// Async Options Loader (reactive via tracked deps)
	// ========================================================================

	// Stable serialization for tracked loadOptions dependency values
	const trackedDepKey = React.useMemo(() => {
		if (!loadOptionsDeps.length) return "";
		return JSON.stringify(loadOptionsDeps.map((dep) => watchedDepMap[dep]));
	}, [loadOptionsDeps, watchedDepMap]);

	const { data: asyncOptions, isLoading: optionsLoading } = useQuery({
		queryKey: ["questpie", "field-hooks-options", fieldName, trackedDepKey],
		queryFn: async () => {
			if (!loadOptions) {
				return [];
			}
			const values = (form.getValues() ?? {}) as Record<string, any>;
			return loadOptions(values);
		},
		enabled: !!loadOptions && loadOptionsDeps.length > 0,
		staleTime: 30_000,
		placeholderData: (prev) => prev,
	});

	// ========================================================================
	// onChange Handler
	// ========================================================================

	const handleChange = React.useCallback(
		(value: any) => {
			// Don't allow changes for computed fields
			if (compute) return;

			// Set the value first
			// Note: shouldValidate is false to avoid blocking on complex fields like richText
			// Validation will still happen on form submit
			form.setValue(fullFieldName, value, {
				shouldDirty: true,
				shouldTouch: true,
				shouldValidate: false,
			});

			// Then call user's onChange if provided
			if (onChange) {
				const runOnChange = async () => {
					try {
						await Promise.resolve(onChange(value, hookCtx));
					} catch (error) {
						console.error(`onChange error for ${fieldName}:`, error);
					}
				};
				runOnChange();
			}
		},
		[form, fullFieldName, onChange, hookCtx, fieldName, compute],
	);

	// ========================================================================
	// Resolve Options
	// ========================================================================

	const options = React.useMemo(() => {
		// Async options take priority
		if (loadOptions) {
			return asyncOptions;
		}
		// Static options
		return staticOptions;
	}, [loadOptions, asyncOptions, staticOptions]);

	return {
		handleChange,
		computedValue,
		isComputed: !!compute,
		options,
		optionsLoading,
	};
}
