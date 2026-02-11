/**
 * Admin Builder
 *
 * Main builder class - same pattern as QuestpieBuilder.
 * Single generic TState pattern.
 */

import {
	DEFAULT_LOCALE_CONFIG,
	type Prettify,
	type SetProperty,
	type TypeMerge,
	type UnsetProperty,
} from "questpie/shared";
import type {
	AdminBuilderState,
	FilterEditViews,
	FilterListViews,
} from "./admin-types";
import { type PageBuilder, page } from "./page/page";
import type { MaybeLazyComponent } from "./types/common";
import type { DefaultViewsConfig } from "./types/views";
import { type WidgetBuilder, widget } from "./widget/widget";

export class AdminBuilder<TState extends AdminBuilderState> {
	constructor(public readonly state: TState) {}

	static empty<TApp = any>(): AdminBuilder<{
		"~app": TApp;
		fields: {};
		components: {};
		listViews: {};
		editViews: {};
		pages: {};
		widgets: {};
		blocks: {};
		translations: {};
		locale: { default: string; supported: string[] };
		defaultViews: {};
	}> {
		return new AdminBuilder({
			"~app": undefined as TApp,
			fields: {},
			components: {},
			listViews: {},
			editViews: {},
			pages: {},
			widgets: {},
			blocks: {},
			translations: {},
			locale: DEFAULT_LOCALE_CONFIG,
			defaultViews: {},
		});
	}

	/**
	 * Register field definitions
	 */
	fields<TNewFields extends Record<string, any>>(
		fields: TNewFields,
	): AdminBuilder<
		SetProperty<
			TState,
			"fields",
			Prettify<TypeMerge<TState["fields"], TNewFields>>
		>
	> {
		return new AdminBuilder({
			...this.state,
			fields: {
				...this.state.fields,
				...fields,
			},
		} as any);
	}

	/**
	 * Register component implementations
	 */
	components<TNewComponents extends Record<string, any>>(
		components: TNewComponents,
	): AdminBuilder<
		SetProperty<
			TState,
			"components",
			Prettify<TypeMerge<TState["components"], TNewComponents>>
		>
	> {
		return new AdminBuilder({
			...this.state,
			components: {
				...this.state.components,
				...components,
			},
		} as any);
	}

	/**
	 * Register view definitions (auto-sorted by kind)
	 */
	views<TNewViews extends Record<string, any>>(
		views: TNewViews,
	): AdminBuilder<
		Prettify<
			TypeMerge<
				UnsetProperty<TState, "listViews" | "editViews">,
				{
					listViews: Prettify<
						TypeMerge<TState["listViews"], FilterListViews<TNewViews>>
					>;
					editViews: Prettify<
						TypeMerge<TState["editViews"], FilterEditViews<TNewViews>>
					>;
				}
			>
		>
	> {
		const listViews: Record<string, any> = {};
		const editViews: Record<string, any> = {};

		for (const [name, def] of Object.entries(views)) {
			// ViewBuilders now implement Definition interface, so kind is directly accessible
			const kind = (def as any).kind;
			if (kind === "list") {
				listViews[name] = def;
			} else if (kind === "edit") {
				editViews[name] = def;
			}
		}

		return new AdminBuilder({
			...this.state,
			listViews: { ...this.state.listViews, ...listViews },
			editViews: { ...this.state.editViews, ...editViews },
		} as any);
	}

	/**
	 * Register widget definitions
	 */
	widgets<TNewWidgets extends Record<string, any>>(
		widgets: TNewWidgets,
	): AdminBuilder<
		SetProperty<
			TState,
			"widgets",
			Prettify<TypeMerge<TState["widgets"], TNewWidgets>>
		>
	> {
		return new AdminBuilder({
			...this.state,
			widgets: {
				...this.state.widgets,
				...widgets,
			},
		} as any);
	}

	/**
	 * Register page definitions
	 */
	pages<TNewPages extends Record<string, any>>(
		pages: TNewPages,
	): AdminBuilder<
		SetProperty<
			TState,
			"pages",
			Prettify<TypeMerge<TState["pages"], TNewPages>>
		>
	> {
		return new AdminBuilder({
			...this.state,
			pages: {
				...this.state.pages,
				...pages,
			},
		} as any);
	}

	/**
	 * Compose another builder (merge modules)
	 */
	use<TOther extends AdminBuilder<any>>(
		other: TOther,
	): AdminBuilder<
		Prettify<
			TypeMerge<
				UnsetProperty<
					TState,
					| "fields"
					| "listViews"
					| "editViews"
					| "widgets"
					| "pages"
					| "components"
				>,
				{
					fields: Prettify<
						TypeMerge<TState["fields"], TOther["state"]["fields"]>
					>;
					listViews: Prettify<
						TypeMerge<TState["listViews"], TOther["state"]["listViews"]>
					>;
					editViews: Prettify<
						TypeMerge<TState["editViews"], TOther["state"]["editViews"]>
					>;
					widgets: Prettify<
						TypeMerge<TState["widgets"], TOther["state"]["widgets"]>
					>;
					pages: Prettify<TypeMerge<TState["pages"], TOther["state"]["pages"]>>;
					components: Prettify<
						TypeMerge<TState["components"], TOther["state"]["components"]>
					>;
				}
			>
		>
	> {
		const otherState = (other as any).state;

		return new AdminBuilder({
			...this.state,
			fields: { ...this.state.fields, ...otherState.fields },
			listViews: { ...this.state.listViews, ...otherState.listViews },
			editViews: { ...this.state.editViews, ...otherState.editViews },
			widgets: { ...this.state.widgets, ...otherState.widgets },
			pages: { ...this.state.pages, ...otherState.pages },
			components: { ...this.state.components, ...otherState.components },
		} as any);
	}

	/**
	 * Set default views config
	 */
	defaultViews<TDefaultViews extends DefaultViewsConfig>(
		config: TDefaultViews,
	): AdminBuilder<
		SetProperty<
			TState,
			"defaultViews",
			Prettify<TypeMerge<TState["defaultViews"], TDefaultViews>>
		>
	> {
		return new AdminBuilder({
			...this.state,
			defaultViews: {
				...(this.state.defaultViews || {}),
				...config,
			},
		} as any);
	}

	/**
	 * Create a page definition
	 *
	 * Creates a custom admin page outside of collections/globals.
	 *
	 * @example
	 * ```ts
	 * const builder = qa<AppCMS>().use(adminModule);
	 *
	 * const analyticsPage = builder.page("analytics", {
	 *   component: AnalyticsPage,
	 * })
	 * ```
	 */
	page<TName extends string, TComponent extends MaybeLazyComponent>(
		name: TName,
		config: { component: TComponent },
	): PageBuilder<{
		name: TName;
		component: TComponent;
		path: undefined;
	}> {
		return page(name, config);
	}

	/**
	 * Create a widget definition
	 *
	 * Creates a dashboard widget.
	 *
	 * @example
	 * ```ts
	 * const builder = qa<AppCMS>().use(adminModule);
	 *
	 * const statsWidget = builder.widget("stats", {
	 *   component: StatsWidget,
	 * })
	 * ```
	 */
	widget<TName extends string, TComponent extends MaybeLazyComponent>(
		name: TName,
		config: { component: TComponent },
	): WidgetBuilder<{
		name: TName;
		"~config": any;
		component: TComponent;
	}> {
		return widget(name, config);
	}
}
