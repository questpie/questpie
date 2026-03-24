/**
 * View & Component Definition Types
 *
 * View kind registry, view definitions, component definitions,
 * component factory types, and view factory callback context types.
 */

import type { I18nText } from "questpie/shared";

import type { ComponentReference } from "./common.js";
import type { FormViewConfig, ListViewConfig } from "./form-layout.js";

// ============================================================================
// View Kind Registry — Plugin-Extensible
// ============================================================================

/**
 * Open augmentation point for view kinds.
 * Plugins extend this interface to register new view kinds.
 *
 * The admin plugin registers "list" and "form" by default.
 * Third-party plugins can add new kinds (e.g., "dashboard", "kanban-board").
 *
 * @example
 * ```ts
 * // Admin plugin declares:
 * declare module "@questpie/admin/server" {
 *   interface ViewKindRegistry {
 *     list: {};
 *     edit: {};
 *   }
 * }
 *
 * // Third-party plugin extends:
 * declare module "@questpie/admin/server" {
 *   interface ViewKindRegistry {
 *     dashboard: {};
 *   }
 * }
 * ```
 */
export interface ViewKindRegistry {
	list: {};
	form: {};
}

/**
 * Union of all registered view kind names.
 * Derived from ViewKindRegistry — automatically extends when plugins
 * augment the registry.
 */
export type ViewKind = keyof ViewKindRegistry;

/**
 * Type-level filter that selects views matching a specific kind.
 *
 * Used by codegen to derive list/form view types from the unified `views` registry
 * without needing separate `listViews`/`formViews` categories.
 *
 * @example
 * ```ts
 * type ListViews = FilterViewsByKind<AllViews, "list">;
 * type FormViews = FilterViewsByKind<AllViews, "form">;
 * ```
 */
export type FilterViewsByKind<TViews, TKind extends ViewKind> = {
	[K in keyof TViews as TViews[K] extends { kind: TKind }
		? K
		: never]: TViews[K];
};

// ============================================================================
// View Definition — Unified
// ============================================================================

/**
 * Unified view definition with `kind` discriminant.
 *
 * The `kind` field determines which builder extension this view is used in:
 * - `"list"` → available in `.list()` callback
 * - `"form"` → available in `.form()` callback
 *
 * Each view carries its own config — codegen extracts the type and
 * introspection serializes the schema for the client.
 */
export interface ViewDefinition<
	TName extends string = string,
	TKind extends ViewKind = ViewKind,
	TConfig = unknown,
> {
	type: "view";
	name: TName;
	kind: TKind;
	/**
	 * Phantom type marker carrying the view's config type.
	 *
	 * Not used at runtime — only exists for TypeScript to extract
	 * per-view config in `ListViewFactory` / `EditViewFactory`.
	 * When a user calls `v.collectionTable({ columns: [...] })`, TypeScript
	 * infers the config shape from this phantom field.
	 *
	 * @example
	 * ```ts
	 * // views/kanban.ts
	 * export default view<KanbanConfig>("kanban", { kind: "list" });
	 * // → ViewDefinition<"kanban", "list", KanbanConfig>
	 * // → v.kanban({ groupBy: "status" }) type-checks against KanbanConfig
	 * ```
	 */
	readonly "~config"?: TConfig;
	[key: string]: unknown;
}

/**
 * View definition for list views (table, cards, etc.)
 * @deprecated Use ViewDefinition with kind: "list" instead.
 */
export interface ListViewDefinition<TName extends string = string> {
	type: "listView";
	name: TName;
}

/**
 * View definition for edit views (form, wizard, etc.)
 * @deprecated Use ViewDefinition with kind: "form" instead.
 */
export interface EditViewDefinition<TName extends string = string> {
	type: "editView";
	name: TName;
}

/**
 * Component definition for reusable UI components.
 *
 * The `TProps` phantom type carries the input props type that
 * `c.myComponent(props)` accepts in `.admin()` callbacks.
 * When omitted, falls back to `Record<string, unknown> | string`.
 *
 * @example
 * ```ts
 * // components/icon.ts
 * export default component<string | { name: string }>("icon");
 * // → c.icon("ph:users") type-checks against string | { name: string }
 *
 * // components/rating.ts
 * interface RatingProps { value: number; max?: number }
 * export default component<RatingProps>("rating");
 * // → c.rating({ value: 4, max: 5 }) type-checks against RatingProps
 * ```
 */
export interface ComponentDefinition<
	TName extends string = string,
	TProps = unknown,
> {
	type: "component";
	name: TName;
	/** Phantom type marker carrying the component's input props type. */
	readonly "~props"?: TProps;
}

/**
 * Extract the input props type from a ComponentDefinition.
 * Falls back to `TFallback` when the component has `unknown` props.
 */
type ExtractComponentProps<
	TComponent,
	TFallback = Record<string, unknown> | string,
> =
	TComponent extends ComponentDefinition<any, infer P>
		? unknown extends P
			? TFallback
			: P
		: TFallback;

/**
 * Normalize component input props to output props for ComponentReference.
 * Handles string shorthand: `string | X` → just `X` (the string is
 * normalized to the object form at runtime by the proxy).
 */
type NormalizeComponentOutput<TProps> = TProps extends string
	? Record<string, unknown>
	: Exclude<TProps, string>;

/**
 * Component factory API generated from registered components.
 *
 * Each key is a callable that accepts the **per-component props type** extracted
 * from the ComponentDefinition's `~props` phantom field.
 *
 * Accepts either a components record (per-component typed props) or a string
 * union (fallback: all components use `Record<string, unknown> | string`).
 *
 * Note: `c.icon("ph:users")` string shorthand is supported when the component
 * definition includes `string` in its props union.
 */
export type ComponentFactory<
	TComponents extends Record<string, any> | string = string,
> =
	TComponents extends Record<string, any>
		? {
				[K in keyof TComponents & string]: (
					props: ExtractComponentProps<TComponents[K]>,
				) => ComponentReference<
					K,
					NormalizeComponentOutput<
						ExtractComponentProps<TComponents[K]>
					> extends Record<string, unknown>
						? NormalizeComponentOutput<ExtractComponentProps<TComponents[K]>>
						: Record<string, unknown>
				>;
			}
		: {
				[K in TComponents & string]: (
					props: Record<string, unknown> | string,
				) => ComponentReference<K, Record<string, unknown>>;
			};

// ============================================================================
// View Factory Types & Builder Context
// ============================================================================

/**
 * Extract the config type from a ViewDefinition.
 * Falls back to `TFallback` when the view has `unknown` config
 * (i.e. was defined without a config type parameter).
 */
type ExtractViewConfig<TView, TFallback = Record<string, unknown>> =
	TView extends ViewDefinition<any, any, infer C>
		? unknown extends C
			? TFallback
			: C
		: TFallback;

/**
 * View factory API generated from registered list views.
 *
 * Each key is a callable that accepts the **per-view config type** extracted
 * from the ViewDefinition's `~config` phantom field. When a view was defined
 * with `view<ListViewConfig>("collection-table", { kind: "list" })`, calling `v.collectionTable()`
 * type-checks against `Omit<ListViewConfig, "view">`. A custom
 * `view<KanbanConfig>("kanban", ...)` would type-check against `KanbanConfig`.
 *
 * Accepts either a views record (per-view typed config) or a string union
 * (fallback: all views use `ListViewConfig`).
 */
export type ListViewFactory<
	TListViews extends Record<string, any> | string = string,
> =
	TListViews extends Record<string, any>
		? {
				[K in keyof TListViews & string]: (
					config: Omit<
						ExtractViewConfig<TListViews[K], ListViewConfig>,
						"view"
					>,
				) => ExtractViewConfig<TListViews[K], ListViewConfig> & { view: K };
			}
		: {
				[K in TListViews & string]: (
					config: Omit<ListViewConfig, "view">,
				) => ListViewConfig & { view: K };
			};

/**
 * View factory API generated from registered edit views.
 *
 * Same pattern as ListViewFactory but for edit views,
 * with `FormViewConfig` as the fallback config type.
 */
export type EditViewFactory<
	TEditViews extends Record<string, any> | string = string,
> =
	TEditViews extends Record<string, any>
		? {
				[K in keyof TEditViews & string]: (
					config: Omit<
						ExtractViewConfig<TEditViews[K], FormViewConfig>,
						"view"
					>,
				) => ExtractViewConfig<TEditViews[K], FormViewConfig> & { view: K };
			}
		: {
				[K in TEditViews & string]: (
					config: Omit<FormViewConfig, "view">,
				) => FormViewConfig & { view: K };
			};

/**
 * Context for list view config functions.
 *
 * `TListViews` can be either a views record (per-view typed config)
 * or a string union (backward-compatible, all views use `ListViewConfig`).
 */
export interface ListViewConfigContext<
	TFields extends Record<string, any> = Record<string, any>,
	TListViews extends Record<string, any> | string = string,
> {
	/** View factory — per-view typed config extracted from ViewDefinition */
	v: ListViewFactory<TListViews>;
	/** Field reference proxy - returns field names as strings */
	f: { [K in keyof TFields]: K };
	/** Action reference proxy */
	a: {
		create: string;
		save: string;
		delete: string;
		deleteMany: string;
		restore: string;
		restoreMany: string;
		duplicate: string;
		export: string;
		custom: (
			name: string,
			config?: unknown,
		) => { type: string; config?: unknown };
	};
}

/**
 * Context for form view config functions.
 *
 * `TEditViews` can be either a views record (per-view typed config)
 * or a string union (backward-compatible, all views use `FormViewConfig`).
 */
export interface FormViewConfigContext<
	TFields extends Record<string, any> = Record<string, any>,
	TEditViews extends Record<string, any> | string = string,
> {
	/** View factory — per-view typed config extracted from ViewDefinition */
	v: EditViewFactory<TEditViews>;
	/** Field reference proxy - returns field names as strings */
	f: { [K in keyof TFields]: K };
}

/**
 * Context for admin config functions with component proxy.
 *
 * `TComponents` can be either a components record (per-component typed props)
 * or a string union (backward-compatible, all components use `Record<string, unknown> | string`).
 */
export interface AdminConfigContext<
	TComponents extends Record<string, any> | string = string,
> {
	c: ComponentFactory<TComponents>;
}
