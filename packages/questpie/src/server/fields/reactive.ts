/**
 * Reactive Field System — Core Runtime
 *
 * Re-exports plain types from reactive-types.ts and provides
 * Proxy-based dependency tracking for introspection serialization.
 *
 * Higher-level serialization helpers (serializeReactiveConfig,
 * serializeOptionsConfig, getHandler) have been moved to
 * `@questpie/admin` (server/fields/reactive-runtime.ts).
 *
 * For type-only imports (no runtime dependency), use reactive-types.ts.
 */

// Re-export all plain types for backward compatibility
export type {
	ReactiveServerContext,
	ReactiveContext,
	ReactiveHandler,
	ReactiveConfig,
	OptionsContext,
	OptionsHandler,
	OptionsResult,
	OptionsConfig,
	ReactiveAdminMeta,
	ReactivePropPlaceholder,
	ReactivePropValue,
	SerializedReactiveConfig,
	SerializedOptionsConfig,
	TrackingResult,
} from "./reactive-types.js";

import type {
	ReactiveContext,
	ReactiveConfig,
	ReactiveHandler,
	ReactivePropPlaceholder,
	ReactivePropValue,
	TrackingResult,
} from "./reactive-types.js";

// ============================================================================
// Dependency Tracking (Runtime — uses Proxy)
// ============================================================================

/**
 * Track dependencies accessed by a handler function using Proxy.
 * Runs the function with proxy objects that record property access.
 *
 * @param fn - Handler function to track
 * @returns Object with result and detected dependencies
 *
 * @example
 * ```ts
 * const { result, deps } = trackDependencies(
 *   (ctx) => ctx.data.status === 'draft' && ctx.data.type === 'post'
 * );
 * // deps = ['status', 'type']
 * ```
 */
export function trackDependencies<T>(
	fn: (ctx: ReactiveContext) => T,
): TrackingResult<T | undefined> {
	const deps = new Set<string>();

	const createProxy = (prefix: string): any =>
		new Proxy({} as any, {
			get(_, prop: string | symbol) {
				// Skip internal properties and symbols
				if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") {
					return undefined;
				}

				const path = prefix ? `${prefix}.${prop}` : prop;
				deps.add(path);

				// Return nested proxy for chained access (e.g., data.nested.field)
				return createProxy(path);
			},
		});

	const ctx: ReactiveContext = {
		data: createProxy(""),
		sibling: createProxy("$sibling"),
		prev: {
			data: createProxy("$prev"),
			sibling: createProxy("$prev.$sibling"),
		},
		ctx: {} as any, // Dummy, won't be used during tracking
	};

	let result: T | undefined;
	try {
		result = fn(ctx);
	} catch {
		// Ignore runtime errors during tracking
		// We only want to capture property access
	}

	return { result, deps: [...deps] };
}

/**
 * Track dependencies from a deps function.
 * The deps function can access ctx.data, ctx.sibling, etc.
 *
 * @param depsFn - Deps function that returns array of values
 * @returns Array of dependency paths
 */
export function trackDepsFunction(
	depsFn: (ctx: ReactiveContext) => any[],
): string[] {
	const { deps } = trackDependencies((ctx) => {
		depsFn(ctx);
		return undefined;
	});
	return deps;
}

/**
 * Extract dependencies from a ReactiveConfig.
 * Handles both short syntax (function) and full syntax (object with handler/deps).
 *
 * @param config - Reactive configuration
 * @returns Array of dependency paths
 */
export function extractDependencies(config: ReactiveConfig<any>): string[] {
	if (typeof config === "function") {
		// Short syntax - track from handler
		return trackDependencies(config).deps;
	}

	// Full syntax
	const { handler, deps } = config;

	if (Array.isArray(deps)) {
		// Explicit string array
		return deps;
	}

	if (typeof deps === "function") {
		// Deps function - track from it
		return trackDepsFunction(deps);
	}

	// No deps specified - track from handler
	return trackDependencies(handler).deps;
}

/**
 * Get debounce value from ReactiveConfig.
 */
export function getDebounce(config: ReactiveConfig<any>): number | undefined {
	return typeof config === "function" ? undefined : config.debounce;
}

/**
 * Check if a value is a ReactiveConfig (function or config object).
 */
export function isReactiveConfig(value: unknown): value is ReactiveConfig<any> {
	if (typeof value === "function") {
		return true;
	}
	if (typeof value === "object" && value !== null && "handler" in value) {
		return typeof (value as any).handler === "function";
	}
	return false;
}

// ============================================================================
// Reactive Prop Values (per-field-instance escape hatch)
// ============================================================================

/**
 * True if the value is a function or `{ handler }` config — i.e. a value
 * that needs to be evaluated server-side and replaced with a placeholder
 * before being shipped to the client.
 */
function isReactivePropDynamic(
	value: unknown,
): value is
	| ReactiveHandler<unknown>
	| { handler: ReactiveHandler<unknown>; deps?: unknown; debounce?: number } {
	if (typeof value === "function") return true;
	if (typeof value !== "object" || value === null) return false;
	const obj = value as { handler?: unknown };
	return typeof obj.handler === "function";
}

/**
 * True if the value is a `ReactivePropPlaceholder` (i.e. came back from the
 * wire after introspection serialized a function value). Used by the client
 * to decide whether a `props.<key>` value needs RPC resolution or can be
 * used directly.
 */
export function isReactivePropPlaceholder(
	value: unknown,
): value is ReactivePropPlaceholder {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { "~reactive"?: unknown })["~reactive"] === "prop"
	);
}

/**
 * Serialize a single prop value. Static values pass through unchanged.
 * Function / `{ handler, deps, debounce }` values become a
 * `ReactivePropPlaceholder` carrying just the dependency list and debounce —
 * the handler stays on the server and is evaluated on demand by the
 * `/admin/reactive` `prop` endpoint.
 */
export function serializeReactivePropValue<T>(
	value: ReactivePropValue<T> | undefined,
): unknown {
	if (value === undefined) return undefined;
	if (!isReactivePropDynamic(value)) return value;

	const config: ReactiveConfig<unknown> =
		typeof value === "function"
			? (value as ReactiveHandler<unknown>)
			: (value as {
					handler: ReactiveHandler<unknown>;
					deps?: string[] | ((ctx: ReactiveContext) => any[]);
					debounce?: number;
				});
	const watch = extractDependencies(config);
	const debounce = getDebounce(config);
	const placeholder: ReactivePropPlaceholder = {
		"~reactive": "prop",
		watch,
		...(debounce !== undefined ? { debounce } : {}),
	};
	return placeholder;
}

/**
 * Walk a `props` object and serialize every value through
 * `serializeReactivePropValue`. Returns a new object with dynamic values
 * replaced by placeholders; `undefined` if the input had no entries to
 * serialize (caller can skip emitting the key in that case).
 */
export function serializeReactivePropsRecord(
	props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!props || typeof props !== "object") return undefined;
	const out: Record<string, unknown> = {};
	let any = false;
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined) continue;
		out[key] = serializeReactivePropValue(value as ReactivePropValue<unknown>);
		any = true;
	}
	return any ? out : undefined;
}

/**
 * Recursively walk an admin form layout (`fields`, sections, tabs, sidebar)
 * and replace each `props` record with its serialized form. The input is
 * treated as opaque — anything we don't recognise as a layout container is
 * returned untouched. We never mutate the input.
 */
export function serializeFormLayoutProps<T>(layout: T): T {
	if (Array.isArray(layout)) {
		return layout.map((item) => serializeFormLayoutProps(item)) as unknown as T;
	}
	if (!layout || typeof layout !== "object") return layout;
	const obj = layout as Record<string, unknown>;
	const result: Record<string, unknown> = { ...obj };
	if (obj.props && typeof obj.props === "object" && !Array.isArray(obj.props)) {
		const serialized = serializeReactivePropsRecord(
			obj.props as Record<string, unknown>,
		);
		if (serialized !== undefined) {
			result.props = serialized;
		}
	}
	for (const key of ["fields", "tabs", "sections", "items"] as const) {
		const value = obj[key];
		if (Array.isArray(value)) {
			result[key] = value.map((item) => serializeFormLayoutProps(item));
		}
	}
	if (obj.sidebar && typeof obj.sidebar === "object") {
		result.sidebar = serializeFormLayoutProps(obj.sidebar);
	}
	return result as T;
}
