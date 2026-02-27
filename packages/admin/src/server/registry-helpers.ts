/**
 * Registry Helper Functions
 *
 * Standalone definition factories for list views, edit views, and components.
 * Used by admin module internals and exported for user-facing module() definitions.
 *
 * Extracted from patch.ts.
 *
 * @example
 * ```ts
 * import { listView, editView, component } from "@questpie/admin/server";
 *
 * module({ listViews: { table: listView("table") } });
 * ```
 */

import type {
	ComponentDefinition,
	EditViewDefinition,
	ListViewDefinition,
} from "./augmentation.js";

/**
 * Create a list view definition.
 */
export function listView<TName extends string>(
	name: TName,
	config: Record<string, unknown> = {},
): ListViewDefinition<TName> {
	return { type: "listView", name, ...config };
}

/**
 * Create an edit view definition.
 */
export function editView<TName extends string>(
	name: TName,
	config: Record<string, unknown> = {},
): EditViewDefinition<TName> {
	return { type: "editView", name, ...config };
}

/**
 * Create a component definition.
 */
export function component<TName extends string>(
	name: TName,
	config: Record<string, unknown> = {},
): ComponentDefinition<TName> {
	return { type: "component", name, ...config };
}
