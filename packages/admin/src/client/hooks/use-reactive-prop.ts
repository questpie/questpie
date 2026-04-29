/**
 * useReactiveProps — resolve `extraProps` placeholders against the live form.
 *
 * Field components (relation-select, relation-picker, …) accept user-supplied
 * config via the layout escape hatch:
 *
 *     v.collectionForm({
 *       fields: [
 *         { field: f.author, props: { filter: ({ data }) => ({ team: data.team }) } },
 *       ],
 *     })
 *
 * Functions never cross the wire — introspection serializes them to a
 * `ReactivePropPlaceholder` carrying just the dependency list. This hook is
 * called by `FieldRenderer` *before* it spreads `extraProps` into the field
 * component's props:
 *
 *  - Static JSON / `undefined` → returned synchronously, **no network**.
 *  - Placeholder shape `{ "~reactive": "prop", watch, debounce? }` → resolved
 *    by calling `/admin/reactive` (`type: "prop"`) with current `formData`.
 *
 * All placeholders inside a single `extraProps` record share **one** TanStack
 * Query — both for cache locality and to collapse N round-trips into one.
 * The query refetches only when any of the union of `watch` deps changes,
 * debounced by `max(placeholder.debounce)` (or the caller-supplied override,
 * default 100ms).
 */

import { useQuery } from "@tanstack/react-query";
import { isReactivePropPlaceholder } from "questpie/client";
import type { ReactivePropPlaceholder } from "questpie/client";
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { useAdminStore } from "../runtime/provider.js";

// ============================================================================
// Types
// ============================================================================

export interface UseReactivePropsOptions {
	/** Collection or global name. */
	entity: string;
	/** Entity type. Defaults to `"collection"`. */
	entityType?: "collection" | "global";
	/** Field path (e.g. "authorId" or "items.0.variant"). */
	field: string;
	/**
	 * The raw `extraProps` record handed to the field component.
	 * Static entries pass through unchanged; placeholder entries get
	 * resolved from the server.
	 */
	props: Record<string, unknown> | undefined;
	/** Disable the underlying network query (still resolves static values). */
	enabled?: boolean;
	/** Debounce override in ms; defaults to max placeholder debounce or 100. */
	debounce?: number;
}

export interface UseReactivePropsResult {
	/**
	 * Resolved props record. Static values pass through unchanged. Pending
	 * placeholders read `undefined` until the first response arrives.
	 */
	props: Record<string, unknown>;
	/** True only on the very first fetch. */
	isLoading: boolean;
	/** True whenever a network request is in flight. */
	isFetching: boolean;
	/** Last error from the resolver, if any. */
	error: Error | null;
}

// ============================================================================
// Internals
// ============================================================================

interface PlaceholderEntry {
	key: string;
	placeholder: ReactivePropPlaceholder;
}

/**
 * Stable hash of the watched dep values. Replacer keeps `undefined` slots so
 * `[1, undefined, 2]` ≠ `[1, 2]`.
 */
function hashDeps(values: unknown[]): string {
	return JSON.stringify(values, (_, v) => (v === undefined ? "__undef__" : v));
}

function useDebounced<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = React.useState(value);
	React.useEffect(() => {
		if (delay <= 0) {
			setDebounced(value);
			return;
		}
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}

// ============================================================================
// Hook
// ============================================================================

const EMPTY_PROPS: Record<string, unknown> = Object.freeze({});

export function useReactiveProps({
	entity,
	entityType = "collection",
	field,
	props,
	enabled = true,
	debounce: debounceOverride,
}: UseReactivePropsOptions): UseReactivePropsResult {
	// Split props into static + placeholder entries. Memoised so we don't
	// re-evaluate placeholder parsing on every render.
	const { staticProps, placeholders, watchUnion, debounceMax } =
		React.useMemo(() => {
			const staticOut: Record<string, unknown> = {};
			const dynamicOut: PlaceholderEntry[] = [];
			const watchSet = new Set<string>();
			let dbMax = 0;

			if (props) {
				for (const [key, value] of Object.entries(props)) {
					if (isReactivePropPlaceholder(value)) {
						dynamicOut.push({ key, placeholder: value });
						for (const dep of value.watch) watchSet.add(dep);
						if (typeof value.debounce === "number" && value.debounce > dbMax) {
							dbMax = value.debounce;
						}
					} else {
						staticOut[key] = value;
					}
				}
			}

			return {
				staticProps: dynamicOut.length === 0 ? props ?? EMPTY_PROPS : staticOut,
				placeholders: dynamicOut,
				watchUnion: [...watchSet],
				debounceMax: dbMax,
			};
		}, [props]);

	const debounce = debounceOverride ?? (debounceMax > 0 ? debounceMax : 100);

	const formContext = useFormContext();
	// `useWatch` returns a single value when `name` is a single path,
	// an array otherwise. We always pass an array name so the result is
	// uniformly an array (even of length 1).
	const watchedRaw = useWatch({
		control: formContext?.control as any,
		name: watchUnion as any,
		disabled:
			placeholders.length === 0 || !formContext || watchUnion.length === 0,
	});
	const watchedValues = React.useMemo<unknown[]>(() => {
		if (placeholders.length === 0) return [];
		if (watchUnion.length === 0) return [];
		return Array.isArray(watchedRaw) ? (watchedRaw as unknown[]) : [watchedRaw];
	}, [placeholders.length, watchUnion.length, watchedRaw]);

	const debouncedDeps = useDebounced(watchedValues, debounce);
	const depHash = React.useMemo(() => hashDeps(debouncedDeps), [debouncedDeps]);

	// Stable placeholder-key list for the query key (so unrelated reorders
	// don't bust the cache, but adding/removing a key does).
	const placeholderKeys = React.useMemo(
		() => placeholders.map((p) => p.key).sort(),
		[placeholders],
	);

	const client = useAdminStore((s) => s.client);
	const queryEnabled = enabled && placeholders.length > 0 && !!client;

	const query = useQuery<Record<string, unknown>>({
		queryKey: [
			"questpie",
			"reactive-props",
			entityType,
			entity,
			field,
			placeholderKeys,
			depHash,
		],
		queryFn: async () => {
			if (!client || placeholders.length === 0) return {};
			const formData = (formContext?.getValues?.() ?? {}) as Record<
				string,
				unknown
			>;
			const response = (await (client.routes as any).batchReactive({
				collection: entity,
				type: entityType,
				formData,
				requests: placeholders.map(({ key }) => ({
					field,
					type: "prop",
					propPath: key,
				})),
			})) as {
				results: Array<{
					field: string;
					type: string;
					propPath?: string;
					value: unknown;
					error?: string;
				}>;
			};
			const out: Record<string, unknown> = {};
			for (const r of response.results) {
				if (r.field !== field || r.type !== "prop" || !r.propPath) continue;
				if (r.error) {
					// Surface as a thrown error so React Query records it; sibling
					// placeholders' values from a previous successful fetch stay
					// available via `placeholderData`.
					throw new Error(`[${r.propPath}] ${r.error}`);
				}
				out[r.propPath] = r.value;
			}
			return out;
		},
		enabled: queryEnabled,
		// Keep previous data while refetching so consumers don't flicker
		// between dep changes — TanStack v5 `placeholderData` semantics.
		placeholderData: (prev) => prev,
		staleTime: 30_000,
	});

	const merged = React.useMemo<Record<string, unknown>>(() => {
		if (placeholders.length === 0) {
			return staticProps as Record<string, unknown>;
		}
		const out: Record<string, unknown> = { ...staticProps };
		const resolved = query.data ?? {};
		for (const { key } of placeholders) {
			out[key] = resolved[key];
		}
		return out;
	}, [staticProps, placeholders, query.data]);

	return {
		props: merged,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		error: (query.error as Error | null) ?? null,
	};
}
