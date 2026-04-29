/**
 * View Definition & Factory
 *
 * Defines reusable view components for collections and globals.
 * The `view()` factory returns a plain frozen object.
 *
 * A view definition is just a registry entry: name + kind → component mapping.
 * All view config flows from server introspection at runtime.
 */

import type { MaybeLazyComponent } from "../types/common";

// ============================================================================
// View Kind
// ============================================================================

/**
 * View kind discriminant — "list" for collection list pages, "form" for edit/create pages.
 */
export type ViewKind = "list" | "form";

// ============================================================================
// View Definition (plain frozen object)
// ============================================================================

/**
 * View definition — a registry entry mapping a view name to its component.
 *
 * Created by the `view()` factory. Has `kind` discriminant for list vs form views.
 * All view config (columns, sections, etc.) flows from server introspection.
 */
export interface ViewDefinition<
	TName extends string = string,
	TKind extends ViewKind = ViewKind,
> {
	readonly name: TName;
	readonly kind: TKind;
	readonly component: MaybeLazyComponent;
}

// ============================================================================
// Kind-Specific Type Aliases
// ============================================================================

/**
 * List view definition
 */
export type ListViewDefinition<TName extends string = string> = ViewDefinition<
	TName,
	"list"
>;

/**
 * Form view definition
 */
export type FormViewDefinition<TName extends string = string> = ViewDefinition<
	TName,
	"form"
>;

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a view definition as a plain frozen object.
 *
 * @example
 * ```ts
 * export default view("collection-table", {
 *   kind: "list",
 *   component: () => import("./table-view.js"),
 * });
 *
 * export default view("collection-form", {
 *   kind: "form",
 *   component: () => import("./form-view.js"),
 * });
 * ```
 */
export function view<TName extends string, TKind extends ViewKind>(
	name: TName,
	options: {
		kind: TKind;
		component: MaybeLazyComponent;
	},
): ViewDefinition<TName, TKind> {
	return Object.freeze({
		name,
		kind: options.kind,
		component: options.component,
	});
}
