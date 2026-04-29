/**
 * Shared lazy component resolution helper.
 *
 * Handles three `MaybeLazyComponent` forms:
 *  - `React.ComponentType` — used directly, no async
 *  - `React.lazy(...)` — exotic component, used directly
 *  - `() => import(...)` — dynamic loader, resolved async
 *
 * @internal Not part of the public API.
 */

import * as React from "react";

import type { MaybeLazyComponent } from "../builder/types/common.js";

interface UseLazyComponentOptions {
	/**
	 * Whether to resolve raw `() => import(...)` loaders.
	 *
	 * Some call sites (like registry-backed chrome overrides) legitimately use
	 * zero-argument function components, so those call sites disable raw loader
	 * detection and treat functions as direct components.
	 *
	 * @default true
	 */
	allowDynamicImportLoaders?: boolean;
}

function isLazyLoader(
	loader: MaybeLazyComponent,
	allowDynamicImportLoaders: boolean,
): boolean {
	if (!allowDynamicImportLoaders) {
		return false;
	}

	return (
		typeof loader === "function" &&
		!loader.prototype?.render &&
		!loader.prototype?.isReactComponent &&
		loader.length === 0 &&
		// Exclude React.lazy exotic components — they have $$typeof
		!(loader as any).$$typeof
	);
}

/**
 * Resolve a MaybeLazyComponent to a concrete React component.
 *
 * Returns `{ Component, loading }`:
 * - `loading: true` while a lazy loader is in-flight
 * - `Component: null` if loader is undefined or failed to resolve
 * - Falls back to null on error (callers should fall back to built-in)
 */
export function useLazyComponent(
	loader: MaybeLazyComponent | undefined,
	options: UseLazyComponentOptions = {},
): {
	Component: React.ComponentType<any> | null;
	loading: boolean;
} {
	const { allowDynamicImportLoaders = true } = options;

	const [state, setState] = React.useState<{
		Component: React.ComponentType<any> | null;
		loading: boolean;
	}>(() => {
		if (!loader) return { Component: null, loading: false };
		if (!isLazyLoader(loader, allowDynamicImportLoaders)) {
			return { Component: loader as React.ComponentType<any>, loading: false };
		}
		return { Component: null, loading: true };
	});

	React.useEffect(() => {
		if (!loader) {
			setState({ Component: null, loading: false });
			return;
		}

		if (!isLazyLoader(loader, allowDynamicImportLoaders)) {
			setState({
				Component: loader as React.ComponentType<any>,
				loading: false,
			});
			return;
		}

		let mounted = true;
		(async () => {
			try {
				const result = await (loader as () => Promise<any>)();
				if (mounted) {
					const Component = result.default || result;
					setState({ Component, loading: false });
				}
			} catch {
				if (mounted) {
					setState({ Component: null, loading: false });
				}
			}
		})();

		return () => {
			mounted = false;
		};
	}, [allowDynamicImportLoaders, loader]);

	return state;
}
