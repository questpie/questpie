/**
 * Reactive Field System — Admin Runtime
 *
 * Runtime functions for reactive field serialization that were moved from core.
 * Core retains only types (reactive-types.ts) and dependency tracking (reactive.ts).
 * This module provides higher-level serialization helpers used only by admin.
 *
 * @module
 */

import type {
	OptionsConfig,
	OptionsContext,
	ReactiveConfig,
	ReactiveHandler,
	SerializedOptionsConfig,
	SerializedReactiveConfig,
} from "questpie";

import {
	extractDependencies,
	getDebounce,
	trackDepsFunction,
} from "questpie";

/**
 * Get handler function from ReactiveConfig.
 */
export function getHandler<T>(config: ReactiveConfig<T>): ReactiveHandler<T> {
	return typeof config === "function" ? config : config.handler;
}

/**
 * Serialize a ReactiveConfig for introspection response.
 */
export function serializeReactiveConfig(
	config: ReactiveConfig<any>,
): SerializedReactiveConfig {
	return {
		watch: extractDependencies(config),
		debounce: getDebounce(config),
	};
}

/**
 * Serialize an OptionsConfig for introspection response.
 */
export function serializeOptionsConfig(
	config: OptionsConfig<any>,
): SerializedOptionsConfig {
	let watch: string[];

	if (Array.isArray(config.deps)) {
		watch = config.deps;
	} else if (typeof config.deps === "function") {
		watch = trackDepsFunction(config.deps as any);
	} else {
		// Track from handler (create dummy OptionsContext)
		const deps = new Set<string>();

		const createProxy = (prefix: string): any =>
			new Proxy({} as any, {
				get(_, prop: string | symbol) {
					if (typeof prop === "symbol" || prop === "then") {
						return undefined;
					}
					const path = prefix ? `${prefix}.${prop}` : prop;
					deps.add(path);
					return createProxy(path);
				},
			});

		const ctx: OptionsContext = {
			data: createProxy(""),
			sibling: createProxy("$sibling"),
			search: "",
			page: 0,
			limit: 20,
			ctx: {} as any,
		};

		try {
			config.handler(ctx);
		} catch {
			// Ignore
		}

		watch = [...deps];
	}

	return {
		watch,
		searchable: true, // Options handlers always support search
		paginated: true, // Options handlers always support pagination
	};
}
