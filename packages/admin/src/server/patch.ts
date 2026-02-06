/**
 * Runtime Monkey Patching for Admin Builder Methods
 *
 * This module patches QuestpieBuilder, CollectionBuilder, and GlobalBuilder
 * with admin-specific methods when adminModule is used.
 *
 * The patches add these methods:
 * - QuestpieBuilder: listView(), editView(), component(), listViews(), editViews(), components()
 * - CollectionBuilder: admin(), list(), form(), preview()
 * - GlobalBuilder: admin(), form()
 *
 * Type augmentation is handled by ./augmentation.ts which extends the builder types.
 *
 * @internal This module is automatically imported by adminModule.
 */

import { CollectionBuilder, GlobalBuilder, QuestpieBuilder } from "questpie";
import type {
	ActionsConfigContext,
	AdminCollectionConfig,
	AdminGlobalConfig,
	AdminLocaleConfig,
	BuiltinActionType,
	ComponentDefinition,
	DashboardConfigContext,
	EditViewDefinition,
	FormViewConfig,
	ListViewConfig,
	ListViewDefinition,
	PreviewConfig,
	ServerActionDefinition,
	ServerActionsConfig,
	ServerDashboardConfig,
	ServerSidebarConfig,
	SidebarConfigContext,
} from "./augmentation.js";
import type {
	AnyBlockBuilder,
	AnyBlockDefinition,
} from "./block/block-builder.js";

// Track if patches have been applied to avoid double-patching
let patchesApplied = false;

// ============================================================================
// Proxy Factories
// ============================================================================

/**
 * Create a component proxy for type-safe icon and UI element references.
 * Used in .admin() config functions.
 *
 * @example
 * ```ts
 * .admin(({ c }) => ({
 *   icon: c.icon("ph:users"),
 *   badge: c.badge({ text: "New", color: "green" }),
 * }))
 * ```
 */
function createComponentProxy() {
	return {
		/**
		 * Create an icon reference
		 * @param name Iconify icon name (e.g., "ph:users", "mdi:home")
		 */
		icon: (name: string) => ({ type: "icon", props: { name } }) as const,

		/**
		 * Create a badge reference
		 */
		badge: (props: { text: string; color?: string }) =>
			({ type: "badge", props }) as const,
	};
}

/**
 * Create a field proxy for referencing collection fields.
 * Returns field names as strings for config objects.
 *
 * @example
 * ```ts
 * .list(({ f }) => ({
 *   columns: [f.title, f.author, f.createdAt],
 * }))
 * ```
 */
function createFieldProxy<TFields extends Record<string, any>>(
	fieldNames: string[],
): TFields {
	return new Proxy({} as TFields, {
		get: (_target, prop: string) => prop,
		has: (_target, prop: string) => fieldNames.includes(prop),
		ownKeys: () => fieldNames,
		getOwnPropertyDescriptor: (_target, prop: string) => {
			if (fieldNames.includes(prop)) {
				return { configurable: true, enumerable: true, value: prop };
			}
			return undefined;
		},
	});
}

/**
 * Create a view proxy for defining view configurations.
 *
 * @example
 * ```ts
 * .list(({ v }) => v.table({
 *   columns: [...],
 *   defaultSort: { field: "createdAt", direction: "desc" },
 * }))
 * ```
 */
function createViewProxy() {
	return {
		/**
		 * Table view for list
		 */
		table: (config: Omit<ListViewConfig, "view">) =>
			({ view: "table", ...config }) as ListViewConfig,

		/**
		 * Cards view for list
		 */
		cards: (config: Omit<ListViewConfig, "view">) =>
			({ view: "cards", ...config }) as ListViewConfig,

		/**
		 * Form view for edit
		 */
		form: (config: Omit<FormViewConfig, "view">) =>
			({ view: "form", ...config }) as FormViewConfig,

		/**
		 * Wizard view for edit (multi-step form)
		 */
		wizard: (config: Omit<FormViewConfig, "view">) =>
			({ view: "wizard", ...config }) as FormViewConfig,
	};
}

/**
 * Create an action proxy for referencing built-in and custom actions.
 *
 * @example
 * ```ts
 * .list(({ a }) => ({
 *   actions: {
 *     header: { primary: [a.create] },
 *     bulk: [a.delete, a.export],
 *   },
 * }))
 * ```
 */
function createActionProxy() {
	return {
		// Built-in actions
		create: "create",
		save: "save",
		delete: "delete",
		deleteMany: "deleteMany",
		duplicate: "duplicate",
		export: "export",

		/**
		 * Reference a custom action by name
		 */
		custom: (name: string, config?: unknown) => ({ type: name, config }),
	};
}

/**
 * Create a simple field definition for action forms.
 * This is a lightweight version that only stores the config
 * for later extraction during introspection.
 */
function createSimpleFieldDef(type: string, config?: Record<string, unknown>) {
	return {
		_isActionField: true,
		type,
		...config,
		// For compatibility with field definition interface
		getMetadata() {
			return { type, ...config };
		},
	};
}

/**
 * Default field factories for action forms.
 * These create simple field configs that will be serialized for the client.
 */
const defaultActionFieldRegistry: Record<
	string,
	(config?: Record<string, unknown>) => any
> = {
	text: (config) => createSimpleFieldDef("text", config),
	email: (config) => createSimpleFieldDef("email", config),
	textarea: (config) => createSimpleFieldDef("textarea", config),
	number: (config) => createSimpleFieldDef("number", config),
	boolean: (config) => createSimpleFieldDef("boolean", config),
	date: (config) => createSimpleFieldDef("date", config),
	datetime: (config) => createSimpleFieldDef("datetime", config),
	time: (config) => createSimpleFieldDef("time", config),
	select: (config) => createSimpleFieldDef("select", config),
	json: (config) => createSimpleFieldDef("json", config),
	url: (config) => createSimpleFieldDef("url", config),
};

/**
 * Create an actions config context for the .actions() method.
 * Provides builders for both built-in and custom actions.
 *
 * @example
 * ```ts
 * .actions(({ a, c, f }) => ({
 *   builtin: [a.create(), a.delete(), a.deleteMany()],
 *   custom: [
 *     a.action({
 *       id: "send-email",
 *       label: { en: "Send Email" },
 *       icon: c.icon("ph:envelope"),
 *       form: {
 *         title: { en: "Send Email" },
 *         fields: {
 *           subject: f.text({ label: { en: "Subject" }, required: true }),
 *           message: f.textarea({ label: { en: "Message" } }),
 *         },
 *       },
 *       handler: async ({ data }) => {
 *         return { type: "success", toast: { message: "Email sent!" } };
 *       },
 *     }),
 *   ],
 * }))
 * ```
 */
function createActionsConfigContext<
	TFields extends Record<string, unknown> = Record<string, unknown>,
>(
	fieldRegistry?: Record<string, (config?: any) => any>,
): ActionsConfigContext<TFields> {
	// Use provided registry or fall back to default action field registry
	const registry = fieldRegistry || defaultActionFieldRegistry;

	// Create field proxy that uses the field registry
	const fieldProxy = new Proxy(
		{} as Record<string, (config?: Record<string, unknown>) => any>,
		{
			get: (_target, prop: string) => {
				// First check custom registry, then fallback to default
				const factory = registry[prop] || defaultActionFieldRegistry[prop];
				if (!factory) {
					throw new Error(
						`Unknown field type: "${prop}". ` +
							`Available types: ${Object.keys({ ...defaultActionFieldRegistry, ...registry }).join(", ")}`,
					);
				}
				return (config?: Record<string, unknown>) => factory(config);
			},
		},
	);

	return {
		a: {
			create: () => "create" as BuiltinActionType,
			save: () => "save" as BuiltinActionType,
			delete: () => "delete" as BuiltinActionType,
			deleteMany: () => "deleteMany" as BuiltinActionType,
			duplicate: () => "duplicate" as BuiltinActionType,
			action: <TData = Record<string, unknown>>(
				def: Omit<ServerActionDefinition<TData>, "scope"> & {
					scope?: "single" | "row";
				},
			) =>
				({
					...def,
					scope: def.scope ?? "single",
				}) as ServerActionDefinition<TData>,
			bulkAction: <TData = Record<string, unknown>>(
				def: Omit<ServerActionDefinition<TData>, "scope">,
			) =>
				({
					...def,
					scope: "bulk",
				}) as ServerActionDefinition<TData>,
			headerAction: <TData = Record<string, unknown>>(
				def: Omit<ServerActionDefinition<TData>, "scope">,
			) =>
				({
					...def,
					scope: "header",
				}) as ServerActionDefinition<TData>,
		},
		c: {
			icon: (name: string) => ({ type: "icon" as const, props: { name } }),
		},
		f: fieldProxy,
	};
}

// ============================================================================
// QuestpieBuilder Patches
// ============================================================================

/**
 * Patch QuestpieBuilder with admin methods
 */
function patchQuestpieBuilder() {
	const proto = QuestpieBuilder.prototype as any;

	/**
	 * Create a list view definition.
	 * Returns a definition object for use in .listViews()
	 */
	proto.listView = <TName extends string>(
		name: TName,
		config: Record<string, unknown> = {},
	): ListViewDefinition<TName> => ({ type: "listView", name, ...config });

	/**
	 * Create an edit view definition.
	 * Returns a definition object for use in .editViews()
	 */
	proto.editView = <TName extends string>(
		name: TName,
		config: Record<string, unknown> = {},
	): EditViewDefinition<TName> => ({ type: "editView", name, ...config });

	/**
	 * Create a component definition.
	 * Returns a definition object for use in .components()
	 */
	proto.component = <TName extends string>(
		name: TName,
		config: Record<string, unknown> = {},
	): ComponentDefinition<TName> => ({ type: "component", name, ...config });

	/**
	 * Register list views on the builder.
	 * Merges with existing list views.
	 */
	proto.listViews = function (
		views: Record<string, ListViewDefinition>,
	): QuestpieBuilder<any> {
		return new QuestpieBuilder({
			...this.state,
			listViews: { ...(this.state.listViews || {}), ...views },
		});
	};

	/**
	 * Register edit views on the builder.
	 * Merges with existing edit views.
	 */
	proto.editViews = function (
		views: Record<string, EditViewDefinition>,
	): QuestpieBuilder<any> {
		return new QuestpieBuilder({
			...this.state,
			editViews: { ...(this.state.editViews || {}), ...views },
		});
	};

	/**
	 * Register components on the builder.
	 * Merges with existing components.
	 */
	proto.components = function (
		components: Record<string, ComponentDefinition>,
	): QuestpieBuilder<any> {
		return new QuestpieBuilder({
			...this.state,
			components: { ...(this.state.components || {}), ...components },
		});
	};

	/**
	 * Register block types for the visual block editor.
	 * Blocks are built and stored on the state for use by blocks fields.
	 *
	 * @example
	 * ```ts
	 * import { block } from "@questpie/admin/server";
	 *
	 * const heroBlock = block("hero")
	 *   .label({ en: "Hero Section" })
	 *   .fields((f) => ({
	 *     title: f.text({ required: true }),
	 *   }));
	 *
	 * const cms = q({ name: "my-app" })
	 *   .use(adminModule)
	 *   .blocks({ hero: heroBlock })
	 *   .collections({ ... })
	 *   .build({ ... });
	 * ```
	 */
	proto.blocks = function (
		blocks: Record<string, AnyBlockBuilder>,
	): QuestpieBuilder<any> {
		// Build each block and store the definitions
		const builtBlocks: Record<string, AnyBlockDefinition> = {};

		for (const [name, blockBuilder] of Object.entries(blocks)) {
			// Resolve fields using the builder's field registry
			const state = blockBuilder.state as any;
			if (state._fieldsFactory && this.state.fields) {
				// Create field proxy from registered fields
				const fieldProxy = new Proxy(
					{},
					{
						get: (_target, prop: string) => {
							const factory = this.state.fields[prop];
							if (!factory) {
								throw new Error(
									`Unknown field type: "${prop}". ` +
										`Available types: ${Object.keys(this.state.fields).join(", ")}`,
								);
							}
							return factory;
						},
					},
				);

				// Execute the fields factory to get field definitions
				const fields = state._fieldsFactory(fieldProxy);
				state.fields = fields;
				delete state._fieldsFactory;
			}

			builtBlocks[name] = blockBuilder.build();
		}

		return new QuestpieBuilder({
			...this.state,
			blocks: { ...(this.state.blocks || {}), ...builtBlocks },
		});
	};

	/**
	 * Configure the admin dashboard.
	 * Widgets that need data (stats, chart, recentItems) are executed on server.
	 *
	 * @example
	 * ```ts
	 * .dashboard(({ d, c }) => d.dashboard({
	 *   title: { en: "Dashboard" },
	 *   items: [
	 *     d.section({
	 *       label: { en: "Overview" },
	 *       items: [
	 *         d.stats({ collection: "users", label: { en: "Total Users" } }),
	 *       ],
	 *     }),
	 *   ],
	 * }))
	 * ```
	 */
	proto.dashboard = function (
		configFn: (ctx: DashboardConfigContext) => ServerDashboardConfig,
	): QuestpieBuilder<any> {
		const ctx: DashboardConfigContext = {
			d: {
				dashboard: (config) => config,
				section: (config) => ({ type: "section" as const, ...config }),
				tabs: (config) => ({ type: "tabs" as const, ...config }),
				stats: (config) => ({ type: "stats" as const, ...config }),
				chart: (config) => ({ type: "chart" as const, ...config }),
				recentItems: (config) => ({ type: "recentItems" as const, ...config }),
				quickActions: (config) => ({
					type: "quickActions" as const,
					...config,
				}),
				custom: (config) => ({ type: "custom" as const, ...config }),
				value: (config) => ({ type: "value" as const, ...config }),
				table: (config) => ({ type: "table" as const, ...config }),
				timeline: (config) => ({ type: "timeline" as const, ...config }),
				progress: (config) => ({ type: "progress" as const, ...config }),
			},
			c: {
				icon: (name: string) => ({ type: "icon" as const, props: { name } }),
			},
		};

		const dashboard = configFn(ctx);

		return new QuestpieBuilder({
			...this.state,
			dashboard,
		});
	};

	/**
	 * Configure the admin sidebar.
	 * Sections can contain collections, globals, pages, links, and dividers.
	 *
	 * @example
	 * ```ts
	 * .sidebar(({ s, c }) => s.sidebar({
	 *   sections: [
	 *     s.section({
	 *       id: "content",
	 *       title: { en: "Content" },
	 *       icon: c.icon("ph:files"),
	 *       items: [
	 *         { type: "collection", collection: "posts" },
	 *         { type: "collection", collection: "pages" },
	 *       ],
	 *     }),
	 *   ],
	 * }))
	 * ```
	 */
	proto.sidebar = function (
		configFn: (ctx: SidebarConfigContext) => ServerSidebarConfig,
	): QuestpieBuilder<any> {
		const ctx: SidebarConfigContext = {
			s: {
				sidebar: (config) => config,
				section: (config) => ({ items: [], ...config }),
			},
			c: {
				icon: (name: string) => ({ type: "icon" as const, props: { name } }),
			},
		};

		const sidebar = configFn(ctx);

		return new QuestpieBuilder({
			...this.state,
			sidebar,
		});
	};

	/**
	 * Configure admin UI locales (separate from content locales).
	 *
	 * UI locales control the admin interface language.
	 * Content locales (set via .locale()) control which languages content can be edited in.
	 * These don't need to match - you can have 10 content languages but only 2 UI languages.
	 *
	 * @example
	 * ```ts
	 * const cms = q({ name: "my-app" })
	 *   .use(adminModule)
	 *   // Content can be in many languages
	 *   .locale({
	 *     locales: [{ code: "en" }, { code: "sk" }, { code: "de" }, ...],
	 *     defaultLocale: "en",
	 *   })
	 *   // But admin UI only in 2 languages
	 *   .adminLocale({
	 *     locales: ["en", "sk"],
	 *     defaultLocale: "en",
	 *   })
	 *   .build({ ... });
	 * ```
	 */
	proto.adminLocale = function (
		config: AdminLocaleConfig,
	): QuestpieBuilder<any> {
		return new QuestpieBuilder({
			...this.state,
			adminLocale: config,
		});
	};
}

// ============================================================================
// CollectionBuilder Patches
// ============================================================================

/**
 * Patch CollectionBuilder with admin methods
 */
function patchCollectionBuilder() {
	const proto = CollectionBuilder.prototype as any;

	/**
	 * Set admin metadata for the collection.
	 * Defines how the collection appears in the admin sidebar and UI.
	 *
	 * @example
	 * ```ts
	 * .admin(({ c }) => ({
	 *   label: { en: "Posts", sk: "Príspevky" },
	 *   icon: c.icon("ph:article"),
	 *   description: { en: "Blog posts and articles" },
	 * }))
	 * ```
	 */
	proto.admin = function (
		configOrFn:
			| AdminCollectionConfig
			| ((ctx: {
					c: ReturnType<typeof createComponentProxy>;
			  }) => AdminCollectionConfig),
	): CollectionBuilder<any> {
		const config =
			typeof configOrFn === "function"
				? configOrFn({ c: createComponentProxy() })
				: configOrFn;

		const newState = {
			...this.state,
			admin: config,
		};

		const newBuilder = new CollectionBuilder(newState);
		// Copy callback functions
		if (this._indexesFn) {
			(newBuilder as any)._indexesFn = this._indexesFn;
		}
		return newBuilder;
	};

	/**
	 * Configure list view for the collection.
	 * Defines columns, sorting, filtering, and actions for the list page.
	 *
	 * @example
	 * ```ts
	 * .list(({ v, f, a }) => v.table({
	 *   columns: [f.title, f.author, f.status, f.createdAt],
	 *   defaultSort: { field: "createdAt", direction: "desc" },
	 *   searchable: ["title", "content"],
	 *   filterable: ["status", "author"],
	 *   actions: {
	 *     header: { primary: [a.create] },
	 *     row: [a.duplicate, a.delete],
	 *     bulk: [a.delete],
	 *   },
	 * }))
	 * ```
	 */
	proto.list = function (
		configFn: (ctx: {
			v: ReturnType<typeof createViewProxy>;
			f: Record<string, string>;
			a: ReturnType<typeof createActionProxy>;
		}) => ListViewConfig,
	): CollectionBuilder<any> {
		// Get field names from state
		const fieldNames = Object.keys(this.state.fields || {});

		const config = configFn({
			v: createViewProxy(),
			f: createFieldProxy(fieldNames),
			a: createActionProxy(),
		});

		const newState = {
			...this.state,
			adminList: config,
		};

		const newBuilder = new CollectionBuilder(newState);
		if (this._indexesFn) {
			(newBuilder as any)._indexesFn = this._indexesFn;
		}
		return newBuilder;
	};

	/**
	 * Configure form view for the collection.
	 * Defines field layout, sections, and tabs for create/edit pages.
	 *
	 * @example
	 * ```ts
	 * .form(({ v, f }) => v.form({
	 *   sections: [
	 *     {
	 *       label: { en: "Basic Info" },
	 *       fields: [f.title, f.slug, f.content],
	 *     },
	 *     {
	 *       label: { en: "Publishing" },
	 *       fields: [f.status, f.publishedAt, f.author],
	 *       collapsible: true,
	 *     },
	 *   ],
	 * }))
	 * ```
	 */
	proto.form = function (
		configFn: (ctx: {
			v: ReturnType<typeof createViewProxy>;
			f: Record<string, string>;
		}) => FormViewConfig,
	): CollectionBuilder<any> {
		const fieldNames = Object.keys(this.state.fields || {});

		const config = configFn({
			v: createViewProxy(),
			f: createFieldProxy(fieldNames),
		});

		const newState = {
			...this.state,
			adminForm: config,
		};

		const newBuilder = new CollectionBuilder(newState);
		if (this._indexesFn) {
			(newBuilder as any)._indexesFn = this._indexesFn;
		}
		return newBuilder;
	};

	/**
	 * Configure preview for the collection.
	 * Enables live preview panel in the edit page.
	 *
	 * @example
	 * ```ts
	 * .preview({
	 *   enabled: true,
	 *   url: ({ record, locale }) => `/preview/posts/${record.slug}?locale=${locale}`,
	 *   position: "right",
	 *   defaultWidth: 50,
	 * })
	 * ```
	 */
	proto.preview = function (config: PreviewConfig): CollectionBuilder<any> {
		const newState = {
			...this.state,
			adminPreview: config,
		};

		const newBuilder = new CollectionBuilder(newState);
		if (this._indexesFn) {
			(newBuilder as any)._indexesFn = this._indexesFn;
		}
		return newBuilder;
	};

	/**
	 * Configure actions for the collection.
	 * Enables built-in actions (create, delete, etc.) and custom actions with forms.
	 *
	 * Form fields use the same field registry as collections. The field proxy `f`
	 * is resolved at build time when the full field registry is available.
	 *
	 * @example
	 * ```ts
	 * .actions(({ a, c, f }) => ({
	 *   builtin: [a.create(), a.delete(), a.deleteMany(), a.duplicate()],
	 *   custom: [
	 *     a.action({
	 *       id: "publish",
	 *       label: { en: "Publish" },
	 *       icon: c.icon("ph:check-circle"),
	 *       confirmation: {
	 *         title: { en: "Publish this item?" },
	 *         description: { en: "This will make the item visible to the public." },
	 *       },
	 *       handler: async ({ itemId, app, db }) => {
	 *         // publish logic
	 *         return { type: "success", toast: { message: "Published!" } };
	 *       },
	 *     }),
	 *     a.action({
	 *       id: "send-email",
	 *       label: { en: "Send Email" },
	 *       icon: c.icon("ph:envelope"),
	 *       form: {
	 *         title: { en: "Send Email" },
	 *         fields: {
	 *           subject: f.text({ label: { en: "Subject" }, required: true }),
	 *           message: f.textarea({ label: { en: "Message" } }),
	 *         },
	 *       },
	 *       handler: async ({ data }) => {
	 *         // send email logic - data.subject, data.message are typed
	 *         return { type: "success", toast: { message: "Email sent!" } };
	 *       },
	 *     }),
	 *     a.bulkAction({
	 *       id: "bulk-publish",
	 *       label: { en: "Publish Selected" },
	 *       handler: async ({ itemIds }) => {
	 *         // bulk publish logic
	 *         return { type: "success", toast: { message: `${itemIds?.length} items published!` } };
	 *       },
	 *     }),
	 *   ],
	 * }))
	 * ```
	 */
	proto.actions = function (
		configFn: (
			ctx: ActionsConfigContext<Record<string, unknown>>,
		) => ServerActionsConfig,
	): CollectionBuilder<any> {
		// Execute with default field registry
		// Custom field types can be added via the field registry
		const ctx = createActionsConfigContext();
		const config = configFn(ctx);

		const newState = {
			...this.state,
			adminActions: config,
		};

		const newBuilder = new CollectionBuilder(newState);
		if (this._indexesFn) {
			(newBuilder as any)._indexesFn = this._indexesFn;
		}
		return newBuilder;
	};
}

// ============================================================================
// GlobalBuilder Patches
// ============================================================================

/**
 * Patch GlobalBuilder with admin methods
 */
function patchGlobalBuilder() {
	const proto = GlobalBuilder.prototype as any;

	/**
	 * Set admin metadata for the global.
	 * Defines how the global appears in the admin sidebar and UI.
	 *
	 * @example
	 * ```ts
	 * .admin(({ c }) => ({
	 *   label: { en: "Site Settings", sk: "Nastavenia stránky" },
	 *   icon: c.icon("ph:gear"),
	 * }))
	 * ```
	 */
	proto.admin = function (
		configOrFn:
			| AdminGlobalConfig
			| ((ctx: {
					c: ReturnType<typeof createComponentProxy>;
			  }) => AdminGlobalConfig),
	): GlobalBuilder<any> {
		const config =
			typeof configOrFn === "function"
				? configOrFn({ c: createComponentProxy() })
				: configOrFn;

		const newState = {
			...this.state,
			admin: config,
		};

		return new GlobalBuilder(newState);
	};

	/**
	 * Configure form view for the global.
	 * Defines field layout, sections, and tabs for the settings page.
	 *
	 * @example
	 * ```ts
	 * .form(({ v, f }) => v.form({
	 *   tabs: [
	 *     {
	 *       label: { en: "General" },
	 *       icon: c.icon("ph:gear"),
	 *       sections: [
	 *         { fields: [f.siteName, f.siteDescription, f.logo] },
	 *       ],
	 *     },
	 *     {
	 *       label: { en: "Social Media" },
	 *       icon: c.icon("ph:share-network"),
	 *       sections: [
	 *         { fields: [f.socialLinks] },
	 *       ],
	 *     },
	 *   ],
	 * }))
	 * ```
	 */
	proto.form = function (
		configFn: (ctx: {
			v: ReturnType<typeof createViewProxy>;
			f: Record<string, string>;
		}) => FormViewConfig,
	): GlobalBuilder<any> {
		const fieldNames = Object.keys(this.state.fields || {});

		const config = configFn({
			v: createViewProxy(),
			f: createFieldProxy(fieldNames),
		});

		const newState = {
			...this.state,
			adminForm: config,
		};

		return new GlobalBuilder(newState);
	};
}

// ============================================================================
// Apply All Patches
// ============================================================================

/**
 * Apply all admin patches to builder prototypes.
 * This function is idempotent - calling it multiple times has no effect.
 *
 * Called automatically when adminModule is used via .use()
 */
export function applyAdminPatches(): void {
	if (patchesApplied) {
		return;
	}

	patchQuestpieBuilder();
	patchCollectionBuilder();
	patchGlobalBuilder();

	patchesApplied = true;
}

/**
 * Check if admin patches have been applied.
 * Useful for debugging and testing.
 */
export function arePatchesApplied(): boolean {
	return patchesApplied;
}

// Re-export proxy factories for external use if needed
export {
	createActionProxy,
	createComponentProxy,
	createFieldProxy,
	createViewProxy,
};
