/**
 * Admin Module Factories
 *
 * Proxy-wrapped `collection()` and `global()` for use within the admin module.
 * Resolves `.admin()`, `.list()`, `.form()`, `.actions()`, `.preview()` callbacks
 * the same way the user-level generated factories.ts does.
 *
 * Without this, admin module collections that use `.set("admin", callback)` store
 * raw functions instead of resolved config objects, breaking meta extraction.
 *
 * @internal — only for admin module collections, not exported from package
 */

import { CollectionBuilder, GlobalBuilder } from "questpie";

import type {
	ActionsConfigContext,
	AdminCollectionConfig,
	AdminConfigContext,
	AdminGlobalConfig,
	FormViewConfig,
	FormViewConfigContext,
	ListViewConfig,
	ListViewConfigContext,
	PreviewConfig,
	ServerActionsConfig,
} from "../../augmentation.js";
import { createActionCallbackProxy } from "../../proxy-factories.js";

// ── Type augmentation — gives CollectionBuilder/GlobalBuilder typed extension methods ──

declare module "questpie" {
	interface CollectionBuilder<TState> {
		admin(
			config:
				| AdminCollectionConfig
				| ((ctx: AdminConfigContext) => AdminCollectionConfig),
		): CollectionBuilder<TState>;
		list(
			config: ListViewConfig | ((ctx: ListViewConfigContext) => ListViewConfig),
		): CollectionBuilder<TState>;
		form(
			config: FormViewConfig | ((ctx: FormViewConfigContext) => FormViewConfig),
		): CollectionBuilder<TState>;
		preview(config: PreviewConfig): CollectionBuilder<TState>;
		actions(
			config:
				| ServerActionsConfig
				| ((ctx: ActionsConfigContext) => ServerActionsConfig),
		): CollectionBuilder<TState>;
	}

	interface GlobalBuilder<TState> {
		admin(
			config:
				| AdminGlobalConfig
				| ((ctx: AdminConfigContext) => AdminGlobalConfig),
		): GlobalBuilder<TState>;
		form(
			config: FormViewConfig | ((ctx: FormViewConfigContext) => FormViewConfig),
		): GlobalBuilder<TState>;
	}
}

// ── Proxy helpers (same as generated factories) ─────────────────

/** Create a view proxy with declarative aliases baked in. */
function _viewProxyWithAliases(aliases: Record<string, string>) {
	return new Proxy(
		{},
		{
			get: (_, prop) => (config: any) => ({
				view: aliases[String(prop)] ?? String(prop),
				...config,
			}),
		},
	);
}

const _componentProxy = new Proxy(
	{},
	{
		get:
			(_, prop) =>
			(...args: any[]) => ({
				type: String(prop),
				props:
					typeof args[0] === "string" ? { name: args[0] } : (args[0] ?? {}),
			}),
	},
);

const _fieldRefProxy = new Proxy({}, { get: (_, prop) => String(prop) });

/**
 * Field builder proxy for actions context.
 * Supports `f.text().required().label({...})` chaining.
 * Each method call returns a new proxy with accumulated properties.
 */
function _createFieldBuilderProxy(): any {
	return new Proxy(
		{},
		{
			get: (_, prop) => {
				if (typeof prop !== "string") return undefined;
				// f.text(...) → creates a field def with chainable methods
				return (...args: any[]) => {
					const def: Record<string, any> = { type: prop };
					if (Array.isArray(args[0])) def.options = args[0];
					else if (args[0] && typeof args[0] === "object")
						Object.assign(def, args[0]);
					else if (args[0] !== undefined) def.value = args[0];
					return _chainable(def);
				};
			},
		},
	);
}

function _chainable(def: Record<string, any>): any {
	return new Proxy(def, {
		get: (target, prop) => {
			if (typeof prop !== "string") return Reflect.get(target, prop);
			if (prop in target) return target[prop];
			if (prop === "set") {
				return (key: string, value: unknown) =>
					_chainable({
						...target,
						[key]: value,
					});
			}
			// Chain method: .required() → { ...def, required: true }
			// Chain method: .label({...}) → { ...def, label: {...} }
			return (...args: any[]) =>
				_chainable({
					...target,
					[prop]: args.length === 0 ? true : args[0],
				});
		},
	});
}

const _actionBuilderProxy = createActionCallbackProxy();
const _simpleActionProxy = createActionCallbackProxy();

// ── Extension registries ────────────────────────────────────────

const _collExt: Record<string, { stateKey: string; resolve: (v: any) => any }> =
	{
		admin: {
			stateKey: "admin",
			resolve(configOrFn: any) {
				if (typeof configOrFn === "function")
					return configOrFn({ c: _componentProxy });
				return configOrFn;
			},
		},
		list: {
			stateKey: "adminList",
			resolve(configOrFn: any) {
				const resolved =
					typeof configOrFn === "function"
						? configOrFn({
								v: _viewProxyWithAliases({
									table: "collection-table",
									collectionTable: "collection-table",
								}),
								f: _fieldRefProxy,
								a: _simpleActionProxy,
							})
						: configOrFn;
				return {
					view: "collection-table",
					showSearch: true,
					showFilters: true,
					showToolbar: true,
					...resolved,
				};
			},
		},
		form: {
			stateKey: "adminForm",
			resolve(configOrFn: any) {
				const resolved =
					typeof configOrFn === "function"
						? configOrFn({
								v: _viewProxyWithAliases({
									form: "collection-form",
									collectionForm: "collection-form",
								}),
								f: _fieldRefProxy,
							})
						: configOrFn;
				return { view: "collection-form", showMeta: true, ...resolved };
			},
		},
		preview: { stateKey: "adminPreview", resolve: (v: any) => v },
		actions: {
			stateKey: "adminActions",
			resolve(configOrFn: any) {
				if (typeof configOrFn === "function")
					return configOrFn({
						a: _actionBuilderProxy,
						c: _componentProxy,
						f: _createFieldBuilderProxy(),
					});
				return configOrFn;
			},
		},
	};

const _globExt: Record<string, { stateKey: string; resolve: (v: any) => any }> =
	{
		admin: {
			stateKey: "admin",
			resolve(configOrFn: any) {
				if (typeof configOrFn === "function")
					return configOrFn({ c: _componentProxy });
				return configOrFn;
			},
		},
		form: {
			stateKey: "adminForm",
			resolve(configOrFn: any) {
				const resolved =
					typeof configOrFn === "function"
						? configOrFn({
								v: _viewProxyWithAliases({
									form: "global-form",
									globalForm: "global-form",
								}),
								f: _fieldRefProxy,
							})
						: configOrFn;
				return { view: "global-form", showMeta: true, ...resolved };
			},
		},
	};

// ── Proxy wrappers ──────────────────────────────────────────────

function _wrapColl(builder: any): any {
	return new Proxy(builder, {
		get(target, prop, receiver) {
			if (typeof prop === "string" && prop in _collExt) {
				const ext = _collExt[prop];
				return (configOrFn: any) =>
					_wrapColl(target.set(ext.stateKey, ext.resolve(configOrFn)));
			}
			const val = Reflect.get(target, prop, receiver);
			if (typeof val === "function") {
				return function (this: any, ...args: any[]) {
					const result = val.apply(target, args);
					return result instanceof CollectionBuilder
						? _wrapColl(result)
						: result;
				};
			}
			return val;
		},
	});
}

function _wrapGlob(builder: any): any {
	return new Proxy(builder, {
		get(target, prop, receiver) {
			if (typeof prop === "string" && prop in _globExt) {
				const ext = _globExt[prop];
				return (configOrFn: any) =>
					_wrapGlob(target.set(ext.stateKey, ext.resolve(configOrFn)));
			}
			const val = Reflect.get(target, prop, receiver);
			if (typeof val === "function") {
				return function (this: any, ...args: any[]) {
					const result = val.apply(target, args);
					return result instanceof GlobalBuilder ? _wrapGlob(result) : result;
				};
			}
			return val;
		},
	});
}

// ── Factory functions ───────────────────────────────────────────

/**
 * Create a collection builder with admin extension methods.
 * Use this instead of importing `collection` from "questpie" in admin module collections.
 */
export function collection<TName extends string>(
	name: TName,
): CollectionBuilder<{
	name: TName;
	fields: Record<string, never>;
	localized: [];
	virtuals: undefined;
	relations: Record<string, never>;
	indexes: Record<string, never>;
	title: undefined;
	options: Record<string, never>;
	hooks: Record<string, never>;
	access: Record<string, never>;
	searchable: undefined;
	validation: undefined;
	output: undefined;
	upload: undefined;
	fieldDefinitions: Record<string, never>;
	"~questpieApp": undefined;
}> {
	return _wrapColl(
		new CollectionBuilder({
			name: name as string,
			fields: {},
			localized: [],
			virtuals: undefined,
			relations: {},
			indexes: {},
			title: undefined,
			options: {},
			hooks: {},
			access: {},
			searchable: undefined,
			validation: undefined,
			output: undefined,
			upload: undefined,
			fieldDefinitions: {},
			"~questpieApp": undefined,
		}),
	);
}

/**
 * Create a global builder with admin extension methods.
 * Use this instead of importing `global` from "questpie" in admin module globals.
 */
export function global<TName extends string>(
	name: TName,
): GlobalBuilder<{
	name: TName;
	fields: Record<string, never>;
	localized: [];
	virtuals: Record<string, never>;
	relations: Record<string, never>;
	options: Record<string, never>;
	hooks: Record<string, never>;
	access: Record<string, never>;
	fieldDefinitions: Record<string, never>;
	"~questpieApp": undefined;
}> {
	return _wrapGlob(
		new GlobalBuilder({
			name: name as string,
			fields: {},
			localized: [],
			virtuals: {},
			relations: {},
			options: {},
			hooks: {},
			access: {},
			fieldDefinitions: {},
			"~questpieApp": undefined,
		}),
	);
}
