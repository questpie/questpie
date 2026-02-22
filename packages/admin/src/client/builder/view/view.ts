/**
 * View Builders (List & Edit)
 *
 * Defines reusable view components for collections.
 */

import type { SetProperty } from "questpie/shared";
import type { MaybeLazyComponent } from "../types/common";

// ============================================================================
// Config Extraction Types
// ============================================================================

/**
 * Extract viewConfig type from a view component's props.
 *
 * Looks for `viewConfig?: T` prop and extracts T.
 * Returns `unknown` if not found (will be refined by $config).
 */
type ExtractViewConfigFromComponent<TComponent> =
	TComponent extends React.ComponentType<infer P>
		? P extends { viewConfig?: infer C }
			? C
			: unknown
		: unknown;

/**
 * Extract config from lazy component: () => Promise<{ default: Component }>
 */
type ExtractViewConfigFromLazy<TComponent> = TComponent extends () => Promise<{
	default: infer C;
}>
	? ExtractViewConfigFromComponent<C>
	: ExtractViewConfigFromComponent<TComponent>;

// ============================================================================
// View Definitions
// ============================================================================

/**
 * List view definition
 */
export interface ListViewDefinition<
	TName extends string = string,
	TConfig = unknown,
> {
	readonly name: TName;
	readonly kind: "list";
	readonly "~config": TConfig;
	readonly component: MaybeLazyComponent;
}

/**
 * Edit view definition
 */
export interface EditViewDefinition<
	TName extends string = string,
	TConfig = unknown,
> {
	readonly name: TName;
	readonly kind: "edit";
	readonly "~config": TConfig;
	readonly component: MaybeLazyComponent;
}

// ============================================================================
// Builder State Types
// ============================================================================

export interface ListViewBuilderState<TConfig = unknown> {
	readonly name: string;
	readonly kind: "list";
	readonly "~config": TConfig;
	readonly component: MaybeLazyComponent;
}

export interface EditViewBuilderState<TConfig = unknown> {
	readonly name: string;
	readonly kind: "edit";
	readonly "~config": TConfig;
	readonly component: MaybeLazyComponent;
}

// ============================================================================
// View Builders
// ============================================================================

/**
 * List view builder - implements ListViewDefinition for unified type handling
 */
export class ListViewBuilder<TState extends ListViewBuilderState>
	implements ListViewDefinition<TState["name"], TState["~config"]>
{
	constructor(public readonly state: TState) {}

	get name(): TState["name"] {
		return this.state.name;
	}

	get kind(): "list" {
		return "list";
	}

	get "~config"(): TState["~config"] {
		return this.state["~config"];
	}

	get component(): TState["component"] {
		return this.state.component;
	}

	/**
	 * Set or override config value and type.
	 *
	 * @param config - Optional config value (for runtime) or omit for type-only override
	 */
	$config<TNewConfig>(
		config?: TNewConfig,
	): ListViewBuilder<SetProperty<TState, "~config", TNewConfig>> {
		return new ListViewBuilder({
			...this.state,
			"~config": config ?? this.state["~config"],
		} as SetProperty<TState, "~config", TNewConfig>);
	}
}

/**
 * Edit view builder - implements EditViewDefinition for unified type handling
 */
export class EditViewBuilder<TState extends EditViewBuilderState>
	implements EditViewDefinition<TState["name"], TState["~config"]>
{
	constructor(public readonly state: TState) {}

	get name(): TState["name"] {
		return this.state.name;
	}

	get kind(): "edit" {
		return "edit";
	}

	get "~config"(): TState["~config"] {
		return this.state["~config"];
	}

	get component(): TState["component"] {
		return this.state.component;
	}

	/**
	 * Set or override config value and type.
	 *
	 * @param config - Optional config value (for runtime) or omit for type-only override
	 */
	$config<TNewConfig>(
		config?: TNewConfig,
	): EditViewBuilder<SetProperty<TState, "~config", TNewConfig>> {
		return new EditViewBuilder({
			...this.state,
			"~config": config ?? this.state["~config"],
		} as SetProperty<TState, "~config", TNewConfig>);
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a list view with automatic config type extraction.
 *
 * The config type is extracted from the component's `viewConfig` prop.
 * If extraction fails, use `.$config<MyConfigType>()` to set it manually.
 *
 * @example
 * ```ts
 * // Auto-extraction from component props
 * const tableView = listView("table", { component: TableView });
 * // ^? ListViewBuilder<{ ~config: TableViewConfig }>
 *
 * // Manual config type for lazy imports
 * const lazyTable = listView("table", { component: () => import('./TableView') })
 *   .$config<TableViewConfig>();
 * ```
 */
export function listView<
	TName extends string,
	TComponent extends MaybeLazyComponent,
>(
	name: TName,
	config: { component: TComponent },
): ListViewBuilder<{
	name: TName;
	kind: "list";
	"~config": ExtractViewConfigFromLazy<TComponent>;
	component: TComponent;
}> {
	return new ListViewBuilder({
		name,
		kind: "list",
		"~config": {} as ExtractViewConfigFromLazy<TComponent>,
		component: config.component,
	});
}

/**
 * Create an edit view with automatic config type extraction.
 *
 * @example
 * ```ts
 * const formView = editView("form", { component: FormView });
 * // ^? EditViewBuilder<{ ~config: FormViewRegistryConfig }>
 * ```
 */
export function editView<
	TName extends string,
	TComponent extends MaybeLazyComponent,
>(
	name: TName,
	config: { component: TComponent },
): EditViewBuilder<{
	name: TName;
	kind: "edit";
	"~config": ExtractViewConfigFromLazy<TComponent>;
	component: TComponent;
}> {
	return new EditViewBuilder({
		name,
		kind: "edit",
		"~config": {} as ExtractViewConfigFromLazy<TComponent>,
		component: config.component,
	});
}
