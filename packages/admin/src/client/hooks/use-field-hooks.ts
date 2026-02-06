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

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type {
  FieldHookContext,
  SelectOption,
} from "../builder/types/field-types";

// ============================================================================
// Proxy Tracking Utilities
// ============================================================================

/**
 * Result of tracking dependencies via Proxy
 */
interface TrackingResult<T> {
  result: T;
  deps: string[];
}

/**
 * Track which fields are accessed during a function call using Proxy.
 * Returns the result and the list of accessed field names.
 */
function trackDependencies<T>(
  values: Record<string, any>,
  fn: (values: Record<string, any>) => T,
): TrackingResult<T> {
  const deps: string[] = [];

  const proxy = new Proxy(values, {
    get(target, prop: string) {
      if (typeof prop === "string" && !prop.startsWith("_")) {
        deps.push(prop);
      }
      return target[prop];
    },
  });

  const result = fn(proxy);
  return { result, deps: [...new Set(deps)] }; // dedupe
}

/**
 * Execute a function with tracked values (for computing)
 */
export function computeWithTracking<T>(
  values: Record<string, any>,
  computeFn: (values: Record<string, any>) => T,
): TrackingResult<T> {
  return trackDependencies(values, computeFn);
}

// ============================================================================
// Types
// ============================================================================

export interface UseFieldHooksOptions {
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

export interface UseFieldHooksResult {
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
  const [asyncOptions, setAsyncOptions] = React.useState<
    SelectOption[] | undefined
  >(undefined);
  const [optionsLoading, setOptionsLoading] = React.useState(false);

  // Track dependencies for loadOptions (stored in state to trigger re-render when detected)
  const [loadOptionsDeps, setLoadOptionsDeps] = React.useState<string[]>([]);

  // Create stable hook context
  const hookCtx = React.useMemo(
    () => createHookContext(form, fieldName, locale),
    [form, fieldName, locale],
  );

  // ========================================================================
  // Watch form values reactively (React best practice: useWatch hook)
  // ========================================================================

  // Watch all form values for compute reactivity
  // useWatch properly integrates with React's lifecycle
  const watchedValues = useWatch({ control: form.control });
  const allValues = React.useMemo(
    () => (watchedValues ?? {}) as Record<string, any>,
    [watchedValues],
  );

  // ========================================================================
  // Detect loadOptions dependencies (run once)
  // ========================================================================

  React.useEffect(() => {
    if (!loadOptions) return;

    // Run loadOptions once with a tracking proxy to detect deps
    const values = form.getValues();
    const deps: string[] = [];
    const proxy = new Proxy(values, {
      get(target, prop: string) {
        if (typeof prop === "string" && !prop.startsWith("_")) {
          deps.push(prop);
        }
        return target[prop];
      },
    });

    // Call loadOptions to track deps, catch and ignore errors
    try {
      loadOptions(proxy);
    } catch {
      // Ignore - we just wanted to track access
    }

    const uniqueDeps = [...new Set(deps)];
    setLoadOptionsDeps(uniqueDeps);
  }, [loadOptions, form]);

  // ========================================================================
  // Computed Value (reactive via useWatch + useMemo)
  // ========================================================================

  // Use useMemo for computed value - recomputes when allValues change
  // This is the proper React pattern: derived state via useMemo
  const computedValue = React.useMemo(() => {
    if (!compute) return undefined;
    try {
      return compute(allValues);
    } catch (error) {
      console.error(`Compute error for ${fieldName}:`, error);
      return undefined;
    }
  }, [compute, allValues, fieldName]);

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

  // Extract only the tracked dependency values for comparison
  const trackedDepValues = React.useMemo(() => {
    if (!loadOptionsDeps.length) return [];
    return loadOptionsDeps.map((dep) => allValues[dep]);
  }, [loadOptionsDeps, allValues]);

  // Stable serialization for deep comparison
  const trackedDepKey = React.useMemo(
    () => JSON.stringify(trackedDepValues),
    [trackedDepValues],
  );

  const initialOptionsLoadDone = React.useRef(false);
  const prevDepKeyRef = React.useRef<string>("");

  React.useEffect(() => {
    if (!loadOptions) return;

    // Skip if deps haven't been detected yet
    if (loadOptionsDeps.length === 0 && !initialOptionsLoadDone.current) {
      return;
    }

    // Check if this is initial load or deps changed
    const depsChanged =
      !initialOptionsLoadDone.current ||
      prevDepKeyRef.current !== trackedDepKey;

    if (!depsChanged) return;

    prevDepKeyRef.current = trackedDepKey;
    initialOptionsLoadDone.current = true;

    const fetchOptions = async () => {
      setOptionsLoading(true);
      try {
        // Use allValues (from useWatch) for the loadOptions call
        const options = await loadOptions(allValues);
        setAsyncOptions(options);
      } catch (error) {
        console.error(`Failed to load options for ${fieldName}:`, error);
        setAsyncOptions([]);
      } finally {
        setOptionsLoading(false);
      }
    };

    fetchOptions();
  }, [loadOptions, loadOptionsDeps, trackedDepKey, allValues, fieldName]);

  // ========================================================================
  // onChange Handler
  // ========================================================================

  const handleChange = React.useCallback(
    (value: any) => {
      // Don't allow changes for computed fields
      if (compute) return;

      // Set the value first
      form.setValue(fullFieldName, value, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
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
