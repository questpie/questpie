/**
 * Proxy Factory Functions for Admin Extensions
 *
 * Runtime proxy factories used by admin internals to create typed
 * context objects for admin config callbacks (list, form, actions,
 * sidebar, dashboard).
 *
 * Extracted from patch.ts to enable deleting the legacy monkey-patching module.
 *
 * @internal
 */

import type {
	ActionsConfigContext,
	BuiltinActionType,
	DashboardActionFactory,
	DashboardActionProxy,
	DashboardCallbackContext,
	DashboardContribution,
	DashboardItemDef,
	DashboardProxy,
	DashboardSectionDef,
	ServerActionDefinition,
	ServerDashboardAction,
	SidebarCallbackContext,
	SidebarContribution,
	SidebarItemDef,
	SidebarProxy,
	SidebarSectionDef,
} from "./augmentation.js";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Resolve registry source state.
 *
 * Collection/Global builders: registry lives on `state["~questpieApp"].state`.
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

// ============================================================================
// Callback Context Proxy Factories (used by codegen-generated factories.ts)
// ============================================================================

/**
 * Convert a view callback property name to a canonical view id.
 *
 * Examples:
 * - `collectionTable` -> `collection-table`
 * - `globalForm` -> `global-form`
 * - `kanban` -> `kanban`
 */
function toViewId(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Create a simple view proxy for builder callback contexts.
 * Accessing any property returns a function that creates a view config object.
 *
 * Used as the `v` callback param:
 * `v.collectionTable({ columns: [...] })` -> `{ view: "collection-table", columns: [...] }`.
 */
export function createViewCallbackProxy(): Record<
	string,
	(config?: Record<string, unknown>) => Record<string, unknown>
> {
	return new Proxy(
		{},
		{
			get: (_: unknown, prop: string | symbol) => {
				return (config: Record<string, unknown> = {}) => ({
					view: toViewId(String(prop)),
					...config,
				});
			},
		},
	) as Record<
		string,
		(config?: Record<string, unknown>) => Record<string, unknown>
	>;
}

/**
 * Create a simple component proxy for builder callback contexts.
 * Accessing any property returns a function that creates a component reference.
 *
 * Used as the `c` callback param: `c.icon("ph:article")` → `{ type: "icon", props: { name: "ph:article" } }`.
 */
export function createComponentCallbackProxy(): Record<
	string,
	(...args: unknown[]) => Record<string, unknown>
> {
	return new Proxy(
		{},
		{
			get: (_: unknown, prop: string | symbol) => {
				return (...args: unknown[]) => ({
					type: String(prop),
					props:
						typeof args[0] === "string" ? { name: args[0] } : (args[0] ?? {}),
				});
			},
		},
	) as Record<string, (...args: unknown[]) => Record<string, unknown>>;
}

function createBuiltinActionReference(name: string): unknown {
	const ref = (() => name) as (() => string) & {
		type: string;
		toJSON: () => string;
		valueOf: () => string;
		[Symbol.toPrimitive]: () => string;
	};

	Object.defineProperties(ref, {
		type: { value: name },
		toJSON: { value: () => name },
		valueOf: { value: () => name },
		[Symbol.toPrimitive]: { value: () => name },
	});

	return ref;
}

/**
 * Create an action proxy for builder callback contexts.
 *
 * The same `a` proxy is used by `.list()` (`a.delete`) and `.actions()`
 * (`a.delete()`, `a.headerAction(...)`), so built-ins are callable values that
 * also serialize back to their action name.
 */
export function createActionCallbackProxy(): Record<string, unknown> {
	return new Proxy(
		{
			custom: (name: string, config?: Record<string, unknown>) => ({
				type: name,
				...(config ? { config } : {}),
			}),
			action: (def: Record<string, unknown>) => ({
				scope: "single",
				...def,
			}),
			bulkAction: (def: Record<string, unknown>) => ({
				...def,
				scope: "bulk",
			}),
			headerAction: (def: Record<string, unknown>) => ({
				...def,
				scope: "header",
			}),
		} as Record<string, unknown>,
		{
			get: (target: Record<string, unknown>, prop: string | symbol) => {
				if (prop === "then") return undefined;

				return (
					(target as Record<string | symbol, unknown>)[prop] ??
					createBuiltinActionReference(String(prop))
				);
			},
		},
	);
}

// ============================================================================
// Proxy Factories
// ============================================================================

/**
 * Create a component proxy for registered component references.
 * Used in admin config functions (`.admin()`, `.actions()`, `.dashboard()`, `.sidebar()`).
 */
export function createComponentProxy(builderState: Record<string, unknown>) {
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

			if (
				registeredComponentSet.size > 0 &&
				!registeredComponentSet.has(prop)
			) {
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
 */
export function createFieldProxy<TFields extends Record<string, any>>(
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
 */
export function createViewProxy(
	kind: "list" | "form",
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

				if (hasRegistry && !registeredViewSet.has(prop)) {
					const registerMethod = kind === "list" ? "listViews" : "formViews";
					const available = [...registeredViewSet].sort().join(", ");
					throw new Error(
						`Unknown ${kind} view "${prop}". Register it via .${registerMethod}(). ` +
							`Available ${kind} views: ${available || "(none)"}`,
					);
				}

				return (config: Record<string, unknown> = {}) => ({
					view: toViewId(prop),
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
						view: toViewId(prop),
						...config,
					}),
				};
			},
		},
	);
}

/**
 * Create an action proxy for referencing built-in and custom actions.
 */
export function createActionProxy() {
	return {
		create: "create",
		save: "save",
		delete: "delete",
		deleteMany: "deleteMany",
		restore: "restore",
		restoreMany: "restoreMany",
		duplicate: "duplicate",
		export: "export",
		custom: (name: string, config?: unknown) => ({ type: name, config }),
	};
}

// ============================================================================
// Contribution Proxy Factories (sidebar/dashboard)
// ============================================================================

/**
 * Create a sidebar proxy for contribution callbacks.
 */
export function createSidebarContributionProxy(): SidebarProxy {
	return {
		section: (def: SidebarSectionDef): SidebarSectionDef => def,
		item: (def: SidebarItemDef): SidebarItemDef => def,
	};
}

/**
 * Create a dashboard proxy for contribution callbacks.
 */
export function createDashboardContributionProxy(): DashboardProxy {
	return {
		section: (def: DashboardSectionDef): DashboardSectionDef => def,
		stats: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "stats",
		}),
		value: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "value",
		}),
		progress: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "progress",
		}),
		chart: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "chart",
		}),
		recentItems: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "recentItems",
		}),
		timeline: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "timeline",
		}),
		table: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "table",
		}),
		custom: (def: DashboardItemDef): DashboardItemDef => ({
			...def,
			type: "custom",
		}),
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
 * Create a sidebar callback context for resolving sidebar contributions.
 */
export function createSidebarCallbackContext(): SidebarCallbackContext {
	return {
		s: createSidebarContributionProxy(),
		c: createComponentProxy({} as any) as any,
	};
}

/**
 * Create a dashboard callback context for resolving dashboard contributions.
 */
export function createDashboardCallbackContext(): DashboardCallbackContext {
	return {
		d: createDashboardContributionProxy(),
		c: createComponentProxy({} as any) as any,
		a: createDashboardActionProxy() as DashboardActionProxy,
	};
}

/**
 * Resolve a sidebar callback or static value into a `SidebarContribution`.
 */
export function resolveSidebarCallback(
	value: unknown,
): SidebarContribution | undefined {
	if (value == null) return undefined;
	if (typeof value === "function") {
		return value(createSidebarCallbackContext()) as SidebarContribution;
	}
	return value as SidebarContribution;
}

/**
 * Resolve a dashboard callback or static value into a `DashboardContribution`.
 */
export function resolveDashboardCallback(
	value: unknown,
): DashboardContribution | undefined {
	if (value == null) return undefined;
	if (typeof value === "function") {
		return value(createDashboardCallbackContext()) as DashboardContribution;
	}
	return value as DashboardContribution;
}
