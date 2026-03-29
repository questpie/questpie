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
	SerializedReactiveConfig,
	SerializedOptionsConfig,
	TrackingResult,
} from "./reactive-types.js";

import type {
	ReactiveContext,
	ReactiveConfig,
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
