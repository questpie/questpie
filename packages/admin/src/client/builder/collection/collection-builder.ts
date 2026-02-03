/**
 * Collection Builder
 *
 * For configuring UI for a backend collection.
 * Single generic TState pattern with ~adminApp for type safety.
 */

import type { Questpie } from "questpie";
import type { SetProperty } from "questpie/shared";
import type { I18nText } from "../../i18n/types.js";
import type { AdminBuilder } from "../admin-builder";
import type {
	ExtractBackendApp,
	ExtractBlocks,
	ExtractEditViews,
	ExtractFields,
	ExtractListViews,
} from "../admin-types";
import type { FieldDefinition } from "../field/field";
import type { CollectionFieldKeys } from "../index";
import {
	createFieldProxy,
	createFieldRegistryProxy,
	createViewRegistryProxy,
	type FieldProxy,
	type FieldRegistryProxy,
	type ViewRegistryProxy,
} from "../proxies";
import type { IconComponent } from "../types/common";
import {
	type ActionRegistryProxy,
	createActionRegistryProxy,
	getDefaultActionsConfig,
} from "./action-registry";
import type {
	AutoSaveConfig,
	CollectionBuilderState,
	ColumnConfig,
	PreviewConfig,
} from "./types";

/**
 * Get valid field keys for a collection based on backend schema
 * Falls back to string when app type is not available
 */
type ValidFieldKeys<TState extends CollectionBuilderState> =
	ExtractBackendApp<TState["~adminApp"]> extends Questpie<any>
		? CollectionFieldKeys<
				ExtractBackendApp<TState["~adminApp"]>,
				TState["name"]
			>
		: string;

/**
 * Helper to get fields from AdminApp - simplifies conditional type chains
 */
type AdminAppFields<TAdminApp> =
	ExtractFields<TAdminApp> extends Record<string, any>
		? ExtractFields<TAdminApp>
		: {};

/**
 * Helper to get list views from AdminApp
 */
type AdminAppListViews<TAdminApp> =
	ExtractListViews<TAdminApp> extends Record<string, any>
		? ExtractListViews<TAdminApp>
		: {};

/**
 * Helper to get edit views from AdminApp
 */
type AdminAppEditViews<TAdminApp> =
	ExtractEditViews<TAdminApp> extends Record<string, any>
		? ExtractEditViews<TAdminApp>
		: {};

/**
 * Helper to get blocks from AdminApp
 */
type AdminAppBlocks<TAdminApp> =
	ExtractBlocks<TAdminApp> extends Record<string, any>
		? ExtractBlocks<TAdminApp>
		: {};

/**
 * Extract field names from collection fields for type-safe form config
 */
type CollectionFieldNames<TState extends CollectionBuilderState> =
	TState["fields"] extends Record<string, any>
		? keyof TState["fields"] & string
		: string;

/**
 * Type-safe ListViewConfig that constrains field names to defined fields
 */
type TypedListViewConfig<TFieldNames extends string> = {
	columns?: ColumnConfig<TFieldNames>[];
	with?: string[];
	defaultSort?: {
		field: TFieldNames;
		direction: "asc" | "desc";
	};
	searchable?: boolean;
	searchFields?: TFieldNames[];
	selectable?: boolean;
	paginated?: boolean;
	pageSize?: number;
	pageSizeOptions?: number[];
};

/**
 * Type-safe FormViewConfig that constrains field names to defined fields
 */
type TypedFormViewConfig<TFieldNames extends string> = {
	sidebar?: {
		position?: "left" | "right";
		width?: string;
		fields?: TFieldNames[];
		sections?: TypedSectionConfig<TFieldNames>[];
		tabs?: TypedTabConfig<TFieldNames>[];
	};
	tabs?: TypedTabConfig<TFieldNames>[];
	sections?: TypedSectionConfig<TFieldNames>[];
	fields?: TFieldNames[];
	showVersionHistory?: boolean;
};

type TypedSectionConfig<TFieldNames extends string> = {
	id?: string;
	title?: I18nText;
	description?: I18nText;
	fields?: (TFieldNames | { field: TFieldNames; className?: string })[];
	tabs?: TypedTabConfig<TFieldNames>[];
	sections?: TypedSectionConfig<TFieldNames>[];
	columns?: number;
	gap?: number;
	className?: string;
	collapsible?: boolean;
	defaultOpen?: boolean;
	hidden?: boolean | ((values: Record<string, any>) => boolean);
};

type TypedTabConfig<TFieldNames extends string> = {
	id: string;
	label: I18nText;
	icon?: IconComponent;
	fields?: (TFieldNames | { field: TFieldNames; className?: string })[];
	sections?: TypedSectionConfig<TFieldNames>[];
	tabs?: TypedTabConfig<TFieldNames>[];
	hidden?: boolean | ((values: Record<string, any>) => boolean);
};

export class CollectionBuilder<TState extends CollectionBuilderState> {
	constructor(public readonly state: TState) {}

	/**
	 * Merge admin module into state for type-safe field/view access
	 */
	use<TAdminApp extends AdminBuilder<any>>(
		adminApp: TAdminApp,
	): CollectionBuilder<SetProperty<TState, "~adminApp", TAdminApp>> {
		return new CollectionBuilder({
			...this.state,
			"~adminApp": adminApp,
		} as any);
	}

	/**
	 * Set collection metadata
	 */
	meta(meta: {
		label?: I18nText;
		icon?: IconComponent;
		description?: I18nText;
	}): CollectionBuilder<TState> {
		return new CollectionBuilder({
			...this.state,
			...meta,
		} as any);
	}

	/**
	 * Configure fields with callback: ({ r }) => ({ ... })
	 * r = field registry proxy with access to TState["~adminApp"] fields and blocks
	 *
	 * Field keys MUST match backend collection schema!
	 *
	 * @deprecated Admin UI is schema-driven. Prefer server-side schema fields.
	 */
	fields<TNewFields extends Record<string, FieldDefinition<any, any>>>(
		callback: (ctx: {
			r: FieldRegistryProxy<
				AdminAppFields<TState["~adminApp"]>,
				AdminAppBlocks<TState["~adminApp"]>
			>;
		}) => TNewFields,
	): CollectionBuilder<SetProperty<TState, "fields", TNewFields>> {
		// Extract field registry from admin app
		const adminApp = this.state["~adminApp"];
		const adminFields =
			adminApp && "state" in adminApp
				? (adminApp as any).state?.fields || {}
				: {};

		const r = createFieldRegistryProxy(adminFields);
		const newFields = callback({ r } as any);

		// Note: FieldDefinition.name contains the field TYPE (e.g., "text", "textarea", "relation"),
		// NOT the field key. The field key is the object key in the fields record.
		// We must NOT overwrite .name as that would break field type detection.

		return new CollectionBuilder({
			...this.state,
			fields: newFields,
		} as any);
	}

	/**
	 * Configure list view layout
	 *
	 * @param callback - Receives `{ v, f, a, r }` with type-safe proxies
	 * @returns View config with columns, sorting, search options, and actions
	 *
	 * @deprecated Admin UI is schema-driven. Prefer server-side schema config.
	 *
	 * @example
	 * ```ts
	 * .list(({ v, f, a }) => v.table({
	 *   columns: [f.name, f.email, { field: f.status, width: '100px' }],
	 *   defaultSort: { field: f.createdAt, direction: 'desc' },
	 *   searchFields: [f.name, f.email],
	 *   actions: {
	 *     header: {
	 *       primary: [a.create()],
	 *       secondary: [a.action({ id: 'export', label: 'Export' })],
	 *     },
	 *     bulk: [a.deleteMany()],
	 *   },
	 * }))
	 * ```
	 */
	list<TViewResult>(
		callback: (ctx: {
			v: ViewRegistryProxy<AdminAppListViews<TState["~adminApp"]>>;
			f: TState["fields"] extends Record<string, any>
				? FieldProxy<TState["fields"]>
				: Record<string, never>;
			a: ActionRegistryProxy<any>;
			r: FieldRegistryProxy<
				AdminAppFields<TState["~adminApp"]>,
				AdminAppBlocks<TState["~adminApp"]>
			>;
		}) => TViewResult,
	): CollectionBuilder<SetProperty<TState, "list", TViewResult>> {
		const adminApp = this.state["~adminApp"];
		const adminFields =
			adminApp && "state" in adminApp
				? (adminApp as any).state?.fields || {}
				: {};
		const listViews =
			adminApp && "state" in adminApp
				? (adminApp as any).state?.listViews || {}
				: {};

		const v = createViewRegistryProxy(listViews);
		const f = this.state.fields
			? createFieldProxy(this.state.fields)
			: ({} as any);
		const a = createActionRegistryProxy<any>();
		const r = createFieldRegistryProxy(adminFields);

		const viewConfig = callback({ v, f, a, r } as any);

		// Apply default actions if not specified
		if (
			viewConfig &&
			typeof viewConfig === "object" &&
			"~config" in viewConfig &&
			!(viewConfig["~config"] as any)?.actions
		) {
			(viewConfig["~config"] as any).actions = getDefaultActionsConfig();
		}

		return new CollectionBuilder({
			...this.state,
			list: viewConfig,
		} as any);
	}

	/**
	 * Configure form view layout
	 *
	 * @param callback - Receives `{ v, f, a, r }` with type-safe proxies
	 * @returns View config with sidebar, tabs, sections, and actions
	 *
	 * @deprecated Admin UI is schema-driven. Prefer server-side schema config.
	 *
	 * @example
	 * ```ts
	 * .form(({ v, f, a }) => v.form({
	 *   sidebar: {
	 *     position: "right",
	 *     fields: [f.status, f.createdAt],
	 *   },
	 *   tabs: [
	 *     {
	 *       id: "details",
	 *       label: "Details",
	 *       sections: [
	 *         {
	 *           title: "Basic Info",
	 *           columns: 2,
	 *           fields: [f.name, f.email],
	 *         },
	 *       ],
	 *     },
	 *   ],
	 *   actions: {
	 *     primary: [a.action({ id: 'publish', label: 'Publish' })],
	 *     secondary: [a.duplicate(), a.action({ id: 'delete', label: 'Delete', variant: 'destructive' })],
	 *   },
	 * }))
	 * ```
	 */
	form<TViewResult>(
		callback: (ctx: {
			v: ViewRegistryProxy<AdminAppEditViews<TState["~adminApp"]>>;
			f: TState["fields"] extends Record<string, any>
				? FieldProxy<TState["fields"]>
				: Record<string, never>;
			a: ActionRegistryProxy<any>;
			r: FieldRegistryProxy<
				AdminAppFields<TState["~adminApp"]>,
				AdminAppBlocks<TState["~adminApp"]>
			>;
		}) => TViewResult,
	): CollectionBuilder<SetProperty<TState, "form", TViewResult>> {
		const adminApp = this.state["~adminApp"];
		const adminFields =
			adminApp && "state" in adminApp
				? (adminApp as any).state?.fields || {}
				: {};
		const editViews =
			adminApp && "state" in adminApp
				? (adminApp as any).state?.editViews || {}
				: {};

		const v = createViewRegistryProxy(editViews);
		const f = this.state.fields
			? createFieldProxy(this.state.fields)
			: ({} as any);
		const a = createActionRegistryProxy<any>();
		const r = createFieldRegistryProxy(adminFields);

		const viewConfig = callback({ v, f, a, r } as any);

		return new CollectionBuilder({
			...this.state,
			form: viewConfig,
		} as any);
	}

	/**
	 * Configure live preview for this collection
	 *
	 * @param config - Preview configuration with URL builder and options
	 * @returns CollectionBuilder with preview config
	 *
	 * @example
	 * ```ts
	 * .preview({
	 *   url: (values, locale) => `/${locale}/pages/${values.slug}?preview=true`,
	 *   enabled: true,
	 *   position: "right",
	 *   defaultWidth: 50,
	 * })
	 * ```
	 */
	preview(
		config: PreviewConfig,
	): CollectionBuilder<SetProperty<TState, "preview", PreviewConfig>> {
		return new CollectionBuilder({
			...this.state,
			preview: config,
		} as any);
	}

	/**
	 * Configure autosave behavior for this collection
	 *
	 * Enables automatic saving of form changes after a debounce delay.
	 *
	 * @param config - Autosave configuration with debounce, indicator, and navigation prevention options
	 * @returns CollectionBuilder with autosave config
	 *
	 * @example
	 * ```ts
	 * .autoSave({
	 *   enabled: true,
	 *   debounce: 500,          // 0.5s delay before save
	 *   indicator: true,        // Show "Saving..." badge
	 *   preventNavigation: true // Warn before navigating away
	 * })
	 * ```
	 */
	autoSave(
		config: AutoSaveConfig,
	): CollectionBuilder<SetProperty<TState, "autoSave", AutoSaveConfig>> {
		return new CollectionBuilder({
			...this.state,
			autoSave: config,
		} as any);
	}
}
