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

import {
	CollectionBuilder,
	createFieldBuilder,
	createFieldDefinition,
	GlobalBuilder,
	QuestpieBuilder,
} from "questpie";
import type {
	ActionsConfigContext,
	AdminCollectionConfig,
	AdminGlobalConfig,
	AdminLocaleConfig,
	BuiltinActionType,
	ComponentDefinition,
	DashboardActionFactory,
	DashboardConfigContext,
	EditViewDefinition,
	FormViewConfig,
	ListViewConfig,
	ListViewDefinition,
	PreviewConfig,
	ServerActionDefinition,
	ServerActionsConfig,
	ServerDashboardAction,
	ServerDashboardConfig,
	ServerSidebarConfig,
	SidebarConfigContext,
} from "./augmentation.js";
import {
	type AnyBlockBuilder,
	type AnyBlockDefinition,
	BlockBuilder,
	type BlockPrefetchContext,
	type BlockPrefetchFn,
} from "./block/block-builder.js";

/**
 * Input shape for `.blocks()` registration.
 * Supports two shapes:
 * - `AnyBlockBuilder` - Server block builder (defines fields, metadata, optional prefetch)
 * - `{ block: AnyBlockDefinition, prefetch?: BlockPrefetchFn }` - With manual server prefetch override
 */
type BlockInput =
	| AnyBlockBuilder
	| { block: AnyBlockDefinition; prefetch?: BlockPrefetchFn };

// Track if patches have been applied to avoid double-patching
let patchesApplied = false;

// ============================================================================
// Proxy Factories
// ============================================================================

/**
 * Resolve registry source state.
 *
 * - Collection/Global builders: registry lives on `state["~questpieApp"].state`
 * - QuestpieBuilder: registry lives on `state`
 */
function getRegistrySourceState(
	builderState: Record<string, unknown>,
): Record<string, unknown> {
	const questpieApp = builderState["~questpieApp"] as
		| { state?: Record<string, unknown> }
		| undefined;

	if (questpieApp?.state && typeof questpieApp.state === "object") {
		return questpieApp.state;
	}

	return builderState;
}

/**
 * Resolve registered component names from builder state.
 */
function getRegisteredComponentNames(
	builderState: Record<string, unknown>,
): string[] {
	const sourceState = getRegistrySourceState(builderState);
	const components = sourceState.components;

	if (!components || typeof components !== "object") {
		return [];
	}

	return Object.keys(components as Record<string, unknown>);
}

/**
 * Normalize component props into a serializable object.
 *
 * Backward compatibility:
 * - `c.icon("ph:users")` => `{ name: "ph:users" }`
 */
function normalizeComponentProps(
	componentType: string,
	props: unknown,
): Record<string, unknown> {
	if (componentType === "icon" && typeof props === "string") {
		return { name: props };
	}

	if (props === null || props === undefined) {
		return {};
	}

	if (typeof props === "object") {
		return props as Record<string, unknown>;
	}

	return { value: props };
}

/**
 * Create a component proxy for registered component references.
 * Used in admin config functions (`.admin()`, `.actions()`, `.dashboard()`, `.sidebar()`).
 *
 * @example
 * ```ts
 * .admin(({ c }) => ({
 *   icon: c.icon("ph:users"),
 *   badge: c.badge({ text: "New", color: "green" }),
 * }))
 * ```
 */
function createComponentProxy(builderState: Record<string, unknown>) {
	const componentNames = getRegisteredComponentNames(builderState);
	const registeredComponentSet = new Set(componentNames);

	return new Proxy({} as Record<string, (props?: unknown) => unknown>, {
		get: (_target, prop: string | symbol) => {
			if (typeof prop !== "string") {
				return undefined;
			}

			if (prop === "then") {
				return undefined;
			}

			if (registeredComponentSet.size === 0) {
				throw new Error(
					`No components registered. Register components via .components() ` +
						`or use q.use(adminModule) defaults.`,
				);
			}

			if (!registeredComponentSet.has(prop)) {
				throw new Error(
					`Unknown component "${prop}". Register it via .components(). ` +
						`Available components: ${[...registeredComponentSet].sort().join(", ")}`,
				);
			}

			return (props?: unknown) => ({
				type: prop,
				props: normalizeComponentProps(prop, props),
			});
		},
		has: (_target, prop: string | symbol) => {
			if (typeof prop !== "string") {
				return false;
			}
			return registeredComponentSet.has(prop);
		},
		ownKeys: () => [...registeredComponentSet],
		getOwnPropertyDescriptor: (_target, prop: string | symbol) => {
			if (typeof prop !== "string") {
				return undefined;
			}

			if (!registeredComponentSet.has(prop)) {
				return undefined;
			}

			return {
				configurable: true,
				enumerable: true,
				writable: false,
				value: (props?: unknown) => ({
					type: prop,
					props: normalizeComponentProps(prop, props),
				}),
			};
		},
	});
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
 * If the builder is bound to a Questpie app with registered views
 * (`.listViews()` / `.editViews()`), the proxy only allows those names.
 * If no registry is available (standalone builders), any view name is allowed.
 *
 * @example
 * ```ts
 * .list(({ v }) => v.table({
 *   columns: [...],
 *   defaultSort: { field: "createdAt", direction: "desc" },
 * }))
 * ```
 */
function createViewProxy(
	kind: "list" | "edit",
	registeredViews: string[] = [],
) {
	const registeredViewSet = new Set(registeredViews);
	const hasRegistry = registeredViewSet.size > 0;

	return new Proxy(
		{} as Record<string, (config: Record<string, unknown>) => unknown>,
		{
			get: (_target, prop: string | symbol) => {
				if (typeof prop !== "string") {
					return undefined;
				}

				if (prop === "then") {
					return undefined;
				}

				const registerMethod = kind === "list" ? "listViews" : "editViews";

				if (!hasRegistry) {
					throw new Error(
						`No ${kind} views registered. Register them via .${registerMethod}() ` +
							`or use q.use(adminModule) defaults.`,
					);
				}

				if (!registeredViewSet.has(prop)) {
					const available = [...registeredViewSet].sort().join(", ");
					throw new Error(
						`Unknown ${kind} view "${prop}". Register it via .${registerMethod}(). ` +
							`Available ${kind} views: ${available || "(none)"}`,
					);
				}

				return (config: Record<string, unknown> = {}) => ({
					view: prop,
					...config,
				});
			},
			has: (_target, prop: string | symbol) => {
				if (typeof prop !== "string") {
					return false;
				}
				return hasRegistry && registeredViewSet.has(prop);
			},
			ownKeys: () => (hasRegistry ? [...registeredViewSet] : []),
			getOwnPropertyDescriptor: (_target, prop: string | symbol) => {
				if (typeof prop !== "string") {
					return undefined;
				}

				if (hasRegistry && !registeredViewSet.has(prop)) {
					return undefined;
				}

				return {
					configurable: true,
					enumerable: hasRegistry,
					writable: false,
					value: (config: Record<string, unknown> = {}) => ({
						view: prop,
						...config,
					}),
				};
			},
		},
	);
}

/**
 * Resolve registered view names from a builder's parent Questpie app state.
 */
function getRegisteredViewNames(
	builderState: Record<string, unknown>,
	kind: "list" | "edit",
): string[] {
	const sourceState = getRegistrySourceState(builderState);
	const key = kind === "list" ? "listViews" : "editViews";
	const views = sourceState[key];

	if (!views || typeof views !== "object") {
		return [];
	}

	return Object.keys(views as Record<string, unknown>);
}

/**
 * Validate a selected view name against registered view names.
 */
function ensureRegisteredView(
	kind: "list" | "edit",
	viewName: unknown,
	registeredViews: string[],
): void {
	if (registeredViews.length === 0 || typeof viewName !== "string") {
		return;
	}

	if (registeredViews.includes(viewName)) {
		return;
	}

	const registerMethod = kind === "list" ? "listViews" : "editViews";
	throw new Error(
		`Unknown ${kind} view "${viewName}". Register it via .${registerMethod}(). ` +
			`Available ${kind} views: ${registeredViews.sort().join(", ")}`,
	);
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
 * Create action helpers for dashboard header actions.
 */
function createDashboardActionProxy() {
	const toCollectionCreatePath = (collection: string) =>
		`/admin/collections/${collection}/create`;
	const toGlobalPath = (global: string) => `/admin/globals/${global}`;

	return {
		action: (config: ServerDashboardAction) => config,
		link: (config: ServerDashboardAction) => config,
		create: ({
			collection,
			...config
		}: Omit<ServerDashboardAction, "href"> & { collection: string }) => ({
			...config,
			href: toCollectionCreatePath(collection),
		}),
		global: ({
			global,
			...config
		}: Omit<ServerDashboardAction, "href"> & { global: string }) => ({
			...config,
			href: toGlobalPath(global),
		}),
	} satisfies DashboardActionFactory;
}

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
	builderState: Record<string, unknown>,
	fieldRegistry: Record<string, (config?: any) => any>,
): ActionsConfigContext<TFields> {
	// Create field proxy that uses the field registry
	const fieldProxy = new Proxy(
		{} as Record<string, (config?: Record<string, unknown>) => any>,
		{
			get: (_target, prop: string) => {
				const factory = fieldRegistry[prop];
				if (!factory) {
					const available = Object.keys(fieldRegistry).sort();
					if (available.length === 0) {
						throw new Error(
							`No field types registered for action form fields. ` +
								`Register fields on the Questpie builder before using .actions().`,
						);
					}

					throw new Error(
						`Unknown field type: "${prop}". ` +
							`Available types: ${available.join(", ")}`,
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
		c: createComponentProxy(builderState) as any,
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
	 * Accepts three input shapes per block:
	 * - **Server BlockBuilder** (legacy): `block("hero").fields(...).prefetch(...)`
	 * - **Client BlockDefinition**: `heroBlock` (auto-expansion handles relations)
	 * - **With manual prefetch**: `{ block: heroBlock, prefetch: async ({ values, ctx }) => ({...}) }`
	 *
	 * Relation and upload fields are auto-expanded in the afterRead hook.
	 * Use the `{ block, prefetch }` shape for custom data that can't be auto-expanded.
	 *
	 * @example
	 * ```ts
	 * import { heroBlock, textBlock } from "./blocks";
	 *
	 * const cms = q({ name: "my-app" })
	 *   .use(adminModule)
	 *   .blocks({
	 *     // Simple block - relations auto-expanded
	 *     hero: heroBlock,
	 *     text: textBlock,
	 *     // Block with manual prefetch for custom data
	 *     featuredPosts: {
	 *       block: featuredPostsBlock,
	 *       prefetch: async ({ values, ctx }) => {
	 *         const posts = await ctx.app.api.collections.posts.find({ limit: values.count });
	 *         return { posts: posts.docs };
	 *       },
	 *     },
	 *   })
	 *   .build({ ... });
	 * ```
	 */
	proto.blocks = function (
		blocks: Record<string, BlockInput>,
	): QuestpieBuilder<any> {
		// Build each block and store the definitions
		const builtBlocks: Record<string, AnyBlockDefinition> = {};

		for (const [name, blockInput] of Object.entries(blocks)) {
			// Shape 1: Server BlockBuilder (legacy - has .build() method on a class instance)
			if (
				typeof (blockInput as any).build === "function" &&
				typeof (blockInput as any).state?.name === "string"
			) {
				const blockBuilder = blockInput as AnyBlockBuilder;
				// Resolve fields using the builder's field registry
				const state = blockBuilder.state as any;
				if (state._fieldsFactory && this.state.fields) {
					// Create field builder proxy from registered field types
					const fieldProxy = createFieldBuilder(this.state.fields);

					// Execute the fields factory to get field definitions
					const fields = state._fieldsFactory(fieldProxy);
					state.fields = fields;
					delete state._fieldsFactory;
				}

				builtBlocks[name] = blockBuilder.build();
				continue;
			}

			// Shape 2: { block: AnyBlockDefinition, prefetch?: BlockPrefetchFn } wrapper
			// Allows overriding prefetch for a block
			let blockDef: AnyBlockDefinition;
			let prefetchFn: BlockPrefetchFn | undefined;

			if (
				"block" in (blockInput as any) &&
				typeof (blockInput as any).block === "object" &&
				(blockInput as any).block !== null &&
				"name" in (blockInput as any).block
			) {
				// Shape 2: { block: AnyBlockDefinition, prefetch?: BlockPrefetchFn }
				const wrapper = blockInput as {
					block: AnyBlockDefinition;
					prefetch?: BlockPrefetchFn;
				};
				blockDef = wrapper.block;
				prefetchFn = wrapper.prefetch;
			} else {
				// Direct block definition (shouldn't happen with current types, but handle gracefully)
				blockDef = blockInput as unknown as AnyBlockDefinition;
			}

			const blockName = blockDef.name || name;
			builtBlocks[name] = {
				name: blockName,
				state: {
					...blockDef.state,
					prefetch: prefetchFn || blockDef.state.prefetch,
				},
				getFieldMetadata: blockDef.getFieldMetadata.bind(blockDef),
				executePrefetch: async (
					values: Record<string, unknown>,
					ctx: BlockPrefetchContext,
				) => {
					if (prefetchFn) {
						return prefetchFn({ values, ctx });
					}
					return blockDef.executePrefetch(values, ctx);
				},
			};
		}

		return new QuestpieBuilder({
			...this.state,
			blocks: { ...(this.state.blocks || {}), ...builtBlocks },
		});
	};

	/**
	 * Create a block builder bound to this Questpie builder.
	 * The block has access to all registered field types from `.fields()`.
	 *
	 * @example
	 * ```ts
	 * const qb = q.use(adminModule);
	 *
	 * const heroBlock = qb.block("hero")
	 *   .label({ en: "Hero Section" })
	 *   .icon("ph:image")
	 *   .fields((f) => ({
	 *     title: f.text({ required: true }),  // ✅ typed from builder's field registry
	 *     subtitle: f.text(),
	 *   }));
	 *
	 * const cms = qb
	 *   .blocks({ hero: heroBlock })
	 *   .build({ ... });
	 * ```
	 */
	proto.block = function (name: string) {
		const registeredComponents = getRegisteredComponentNames(
			this.state as Record<string, unknown>,
		);

		return new BlockBuilder({
			name,
			"~components": registeredComponents,
		} as any);
	};

	/**
	 * Configure the admin dashboard.
	 * Widgets that need data (stats, chart, recentItems) are executed on server.
	 *
	 * @example
	 * ```ts
	 * .dashboard(({ d, c, a }) => d.dashboard({
	 *   title: { en: "Dashboard" },
	 *   actions: [
	 *     a.create({
	 *       id: "new-user",
	 *       collection: "users",
	 *       label: { en: "New User" },
	 *       icon: c.icon("ph:user-plus"),
	 *     }),
	 *   ],
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
			a: createDashboardActionProxy(),
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
			c: createComponentProxy(this.state as Record<string, unknown>) as any,
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
			c: createComponentProxy(this.state as Record<string, unknown>) as any,
		};

		const sidebar = configFn(ctx);

		return new QuestpieBuilder({
			...this.state,
			sidebar,
		});
	};

	proto.branding = function (config: {
		name?: unknown;
		logo?: unknown;
	}): QuestpieBuilder<any> {
		return new QuestpieBuilder({
			...this.state,
			branding: config,
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

	/**
	 * Patch .use() to propagate admin extension properties.
	 *
	 * The core .use() only merges hardcoded properties (collections, globals,
	 * jobs, emailTemplates, fields, auth, locale, migrations, translations).
	 * Admin extensions (sidebar, dashboard, branding, listViews, editViews,
	 * components, blocks, adminLocale) would be lost without this patch.
	 */
	const originalUse = proto.use;
	proto.use = function (other: { readonly state: any }): QuestpieBuilder<any> {
		const result = originalUse.call(this, other);
		const otherState = other.state;

		// Core keys already handled by the original .use()
		const coreKeys = new Set([
			"name",
			"collections",
			"globals",
			"jobs",
			"emailTemplates",
			"fields",
			"auth",
			"locale",
			"migrations",
			"translations",
			"~messageKeys",
		]);

		const extensionState: Record<string, any> = {};

		// Carry over extension properties from this (base)
		for (const key of Object.keys(this.state)) {
			if (!coreKeys.has(key) && this.state[key] !== undefined) {
				extensionState[key] = this.state[key];
			}
		}

		// Carry over extension properties from other (overrides base for conflicts)
		for (const key of Object.keys(otherState)) {
			if (!coreKeys.has(key) && otherState[key] !== undefined) {
				extensionState[key] = otherState[key];
			}
		}

		// If there are extension properties, create a new builder with them
		if (Object.keys(extensionState).length > 0) {
			return new QuestpieBuilder({
				...result.state,
				...extensionState,
			});
		}

		return result;
	};

	/**
	 * Patch .build() to inject block definitions into blocks-type field configs
	 * before the real build, and to store admin extension state on the built
	 * Questpie instance so getAdminConfig can read sidebar/dashboard/etc.
	 */
	const originalBuild = proto.build;
	proto.build = function (...args: any[]): any {
		// Inject _blockDefinitions into all blocks-type field configs
		const blockDefs = this.state.blocks;
		if (blockDefs && Object.keys(blockDefs).length > 0) {
			injectBlockDefinitions(this.state, blockDefs);
			// Validate allowedBlocks references
			validateAllowedBlocks(this.state, blockDefs);
		}
		const instance = originalBuild.apply(this, args);

		// Store admin extension state on the built instance
		// so getAdminConfig can access sidebar, dashboard, branding, etc.
		const extensionKeys = [
			"sidebar",
			"dashboard",
			"branding",
			"blocks",
			"listViews",
			"editViews",
			"components",
			"adminLocale",
		];
		const adminState: Record<string, any> = {};
		for (const key of extensionKeys) {
			if (this.state[key] !== undefined) {
				adminState[key] = this.state[key];
			}
		}
		(instance as any).state = adminState;

		return instance;
	};
}

/**
 * Inject block definitions into all blocks-type field configs
 * in collections and globals. Enables per-block field validation.
 * @internal
 */
function injectBlockDefinitions(
	state: any,
	blockDefs: Record<string, AnyBlockDefinition>,
): void {
	// Process collection field configs
	if (state.collections) {
		for (const collection of Object.values(state.collections) as any[]) {
			const fields = collection?.state?.fields;
			if (!fields) continue;
			for (const fieldDef of Object.values(fields) as any[]) {
				if (fieldDef?.state?.config?.type === "blocks") {
					fieldDef.state.config._blockDefinitions = blockDefs;
				}
			}
		}
	}

	// Process global field configs
	if (state.globals) {
		for (const global of Object.values(state.globals) as any[]) {
			const fields = global?.state?.fields;
			if (!fields) continue;
			for (const fieldDef of Object.values(fields) as any[]) {
				if (fieldDef?.state?.config?.type === "blocks") {
					fieldDef.state.config._blockDefinitions = blockDefs;
				}
			}
		}
	}
}

/**
 * Validate that all `allowedBlocks` entries reference registered block types.
 * Logs warnings in development for unknown block types.
 * @internal
 */
function validateAllowedBlocks(
	state: any,
	blockDefs: Record<string, AnyBlockDefinition>,
): void {
	const registeredNames = new Set(Object.keys(blockDefs));

	const checkFields = (fields: any, context: string) => {
		if (!fields) return;
		for (const [fieldName, fieldDef] of Object.entries(fields) as any[]) {
			const config = fieldDef?.state?.config;
			if (config?.type === "blocks" && Array.isArray(config.allowedBlocks)) {
				for (const blockType of config.allowedBlocks) {
					if (!registeredNames.has(blockType)) {
						console.warn(
							`[admin] Unknown block type "${blockType}" in allowedBlocks ` +
								`for field "${fieldName}" in ${context}. ` +
								`Registered block types: ${[...registeredNames].join(", ")}`,
						);
					}
				}
			}
		}
	};

	// Check collection field configs
	if (state.collections) {
		for (const [name, collection] of Object.entries(
			state.collections,
		) as any[]) {
			checkFields(collection?.state?.fields, `collection "${name}"`);
		}
	}

	// Check global field configs
	if (state.globals) {
		for (const [name, global] of Object.entries(state.globals) as any[]) {
			checkFields(global?.state?.fields, `global "${name}"`);
		}
	}
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
				? configOrFn({ c: createComponentProxy(this.state as any) })
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
		const registeredListViews = getRegisteredViewNames(
			this.state as any,
			"list",
		);

		const config = configFn({
			v: createViewProxy("list", registeredListViews),
			f: createFieldProxy(fieldNames),
			a: createActionProxy(),
		});
		ensureRegisteredView("list", config.view, registeredListViews);

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
		const registeredEditViews = getRegisteredViewNames(
			this.state as any,
			"edit",
		);

		const config = configFn({
			v: createViewProxy("edit", registeredEditViews),
			f: createFieldProxy(fieldNames),
		});
		ensureRegisteredView("edit", config.view, registeredEditViews);

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
		// Use the builder's registered field types for action form fields if available
		const questpieApp = (this.state as any)["~questpieApp"];
		const builderFields = questpieApp?.state?.fields;
		const fieldRegistry: Record<string, (config?: any) => any> = {};

		if (builderFields && Object.keys(builderFields).length > 0) {
			// Convert raw field defs into factory functions for the actions context
			for (const [name, fieldDef] of Object.entries(builderFields)) {
				fieldRegistry[name] = (config?: any) =>
					createFieldDefinition(fieldDef as any, config);
			}
		}

		const ctx = createActionsConfigContext(this.state as any, fieldRegistry);
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

	/**
	 * Patch .merge() to propagate admin extension properties.
	 *
	 * The core .merge() only merges hardcoded collection properties (fields,
	 * indexes, hooks, access, etc.). Admin extensions (admin, adminList,
	 * adminForm, adminPreview, adminActions) would be lost without this patch.
	 */
	const originalMerge = proto.merge;
	proto.merge = function (
		other: CollectionBuilder<any>,
	): CollectionBuilder<any> {
		const result = originalMerge.call(this, other);

		// Admin extension keys for collections (last-wins: other overrides this)
		const adminKeys = [
			"admin",
			"adminList",
			"adminForm",
			"adminPreview",
			"adminActions",
		];

		for (const key of adminKeys) {
			const thisVal = (this.state as any)[key];
			const otherVal = (other.state as any)[key];

			if (otherVal !== undefined) {
				(result.state as any)[key] = otherVal;
			} else if (thisVal !== undefined) {
				(result.state as any)[key] = thisVal;
			}
		}

		return result;
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
				? configOrFn({ c: createComponentProxy(this.state as any) })
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
		const registeredEditViews = getRegisteredViewNames(
			this.state as any,
			"edit",
		);

		const config = configFn({
			v: createViewProxy("edit", registeredEditViews),
			f: createFieldProxy(fieldNames),
		});
		ensureRegisteredView("edit", config.view, registeredEditViews);

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

// Auto-apply patches on import (idempotent)
applyAdminPatches();
