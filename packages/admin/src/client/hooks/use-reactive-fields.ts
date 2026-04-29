/**
 * Reactive Fields Hook
 *
 * Watches form changes and triggers server-side reactive handlers.
 * Supports batched RPC calls with debouncing.
 */

import { useMutation } from "@tanstack/react-query";
import type { FieldReactiveSchema } from "questpie/client";
import * as React from "react";
import { type UseFormReturn, useFormContext, useWatch } from "react-hook-form";

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

	/** Form instance - pass directly when calling outside FormProvider */
	form?: UseFormReturn<any>;
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

type ReactiveType = "hidden" | "readOnly" | "disabled" | "compute";

type ReactiveRequestDescriptor = {
	field: string;
	type: ReactiveType;
	watchDeps: string[];
};

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

function normalizeWatchDeps(deps: string[] | undefined): string[] {
	if (!deps?.length) return [];
	return deps.filter((dep) => dep.length > 0 && !dep.startsWith("$"));
}

function buildReactiveRequestDescriptors(
	reactiveConfigs: Record<string, FieldReactiveSchema>,
): ReactiveRequestDescriptor[] {
	const descriptors: ReactiveRequestDescriptor[] = [];

	for (const [field, config] of Object.entries(reactiveConfigs)) {
		for (const type of ["hidden", "readOnly", "disabled", "compute"] as const) {
			const reactiveConfig = config[type];
			if (!reactiveConfig) continue;

			descriptors.push({
				field,
				type,
				watchDeps: normalizeWatchDeps(reactiveConfig.watch),
			});
		}
	}

	return descriptors;
}

function buildDependencyGraph(
	descriptors: ReactiveRequestDescriptor[],
): Map<string, ReactiveRequestDescriptor[]> {
	const graph = new Map<string, ReactiveRequestDescriptor[]>();

	for (const descriptor of descriptors) {
		for (const dep of descriptor.watchDeps) {
			const items = graph.get(dep) ?? [];
			items.push(descriptor);
			graph.set(dep, items);
		}
	}

	return graph;
}

function mapDepValues(
	deps: string[],
	watchedValues: unknown,
): Record<string, unknown> {
	if (deps.length === 0) return {};

	const values = Array.isArray(watchedValues) ? watchedValues : [watchedValues];
	const result: Record<string, unknown> = {};

	for (const [index, dep] of deps.entries()) {
		result[dep] = values[index];
	}

	return result;
}

function getChangedDeps(
	prevDeps: Record<string, unknown>,
	nextDeps: Record<string, unknown>,
): string[] {
	const changed: string[] = [];

	for (const [dep, value] of Object.entries(nextDeps)) {
		if (prevDeps[dep] !== value) {
			changed.push(dep);
		}
	}

	return changed;
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
	form: formProp,
}: UseReactiveFieldsOptions): UseReactiveFieldsResult {
	const client = useAdminStore((s) => s.client);
	const formContext = useFormContext();
	const form = formProp ?? formContext;

	// State
	const [fieldStates, setFieldStates] = React.useState<
		Record<string, ReactiveFieldState>
	>({});

	const requestDescriptors = React.useMemo(
		() => buildReactiveRequestDescriptors(reactiveConfigs),
		[reactiveConfigs],
	);

	const dependencyGraph = React.useMemo(
		() => buildDependencyGraph(requestDescriptors),
		[requestDescriptors],
	);

	const watchDeps = React.useMemo(
		() => [...new Set(requestDescriptors.flatMap((item) => item.watchDeps))],
		[requestDescriptors],
	);

	const watchedDepValues = useWatch({
		control: form?.control as any,
		name: watchDeps as any,
		disabled: !form || watchDeps.length === 0,
	});

	const currentDepValues = React.useMemo(
		() => mapDepValues(watchDeps, watchedDepValues),
		[watchDeps, watchedDepValues],
	);

	const prevFormValuesRef = React.useRef<Record<string, any>>({});
	const prevDepValuesRef = React.useRef<Record<string, unknown>>({});
	const isInitializedRef = React.useRef(false);

	// Debounce timer ref
	const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const mutateRef =
		React.useRef<(descriptors: ReactiveRequestDescriptor[]) => void>(undefined);
	const reactiveMutation = useMutation({
		mutationFn: async (descriptors: ReactiveRequestDescriptor[]) => {
			if (!client) {
				return { results: [] as ReactiveFieldResult[] };
			}

			const formData = (form.getValues() ?? {}) as Record<string, any>;
			const prevData = prevFormValuesRef.current;
			const requests = descriptors.map((descriptor) => ({
				field: descriptor.field,
				type: descriptor.type,
				siblingData: getSiblingData(formData, descriptor.field),
				prevSiblingData: getSiblingData(prevData, descriptor.field),
			}));
			return (client.routes as any).batchReactive({
				collection,
				type: mode,
				formData,
				prevData,
				requests,
			});
		},
		onSuccess: (response) => {
			setFieldStates((prevState) => {
				const nextState: Record<string, ReactiveFieldState> = {
					...prevState,
				};

				for (const result of response.results as ReactiveFieldResult[]) {
					if (!nextState[result.field]) {
						nextState[result.field] = {};
					}

					if (result.type === "compute") {
						if (result.value !== undefined) {
							form.setValue(result.field, result.value, {
								shouldDirty: true,
								shouldTouch: false,
								shouldValidate: true,
							});
						}
					} else {
						nextState[result.field][result.type] = result.value as boolean;
					}
				}

				return nextState;
			});
			prevFormValuesRef.current = {
				...((form.getValues() ?? {}) as Record<string, any>),
			};
		},
	});
	mutateRef.current = reactiveMutation.mutate;

	React.useEffect(() => {
		void collection;
		void mode;
		void requestDescriptors;

		isInitializedRef.current = false;
		prevFormValuesRef.current = {};
		prevDepValuesRef.current = {};

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}
	}, [collection, mode, requestDescriptors]);

	React.useEffect(() => {
		if (!enabled || requestDescriptors.length === 0) {
			return;
		}

		if (!isInitializedRef.current) {
			isInitializedRef.current = true;
			prevFormValuesRef.current = {
				...((form.getValues() ?? {}) as Record<string, any>),
			};
			prevDepValuesRef.current = currentDepValues;
			mutateRef.current?.(requestDescriptors);
			return;
		}

		if (watchDeps.length === 0) {
			return;
		}

		const changedDeps = getChangedDeps(
			prevDepValuesRef.current,
			currentDepValues,
		);
		if (changedDeps.length === 0) {
			return;
		}

		prevDepValuesRef.current = currentDepValues;

		const affectedDescriptors = new Map<string, ReactiveRequestDescriptor>();
		for (const dep of changedDeps) {
			const depDescriptors = dependencyGraph.get(dep) ?? [];
			for (const descriptor of depDescriptors) {
				affectedDescriptors.set(
					`${descriptor.field}:${descriptor.type}`,
					descriptor,
				);
			}
		}

		if (affectedDescriptors.size === 0) {
			return;
		}

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => {
			mutateRef.current?.([...affectedDescriptors.values()]);
		}, debounce);

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [
		enabled,
		requestDescriptors,
		form,
		currentDepValues,
		watchDeps,
		dependencyGraph,
		debounce,
	]);

	React.useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, []);

	return {
		fieldStates,
		isPending: reactiveMutation.isPending,
		error: reactiveMutation.error ?? null,
		refresh: () => mutateRef.current?.(requestDescriptors),
	};
}
