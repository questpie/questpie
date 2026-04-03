/**
 * Codegen Types
 *
 * Types for the file convention codegen system.
 * @see RFC-MODULE-ARCHITECTURE §4 (Plugin Resolution Patterns)
 */

// ============================================================================
// Discovered File
// ============================================================================

/**
 * A file discovered during codegen scanning.
 */
export interface DiscoveredFile {
	/** Absolute file path. */
	absolutePath: string;
	/** Derived key (e.g. "sendNewsletter", "siteSettings"). */
	key: string;
	/** Import path relative to the .generated directory (e.g. "../collections/posts"). */
	importPath: string;
	/** Safe variable name for the generated import statement. */
	varName: string;
	/** Source glob pattern that matched (e.g. "collections/*.ts"). */
	source: string;
	/**
	 * Export type detected in the file.
	 * - "default" — `export default ...`
	 * - "named" — only named exports found (e.g. `export const X = ...`)
	 * - "unknown" — could not determine (file read failed)
	 */
	exportType: "default" | "named" | "unknown";
	/** Name of the first named export found (when exportType is "named"). */
	namedExportName?: string;
	/**
	 * All named exports found in the file.
	 * Populated when resolve is "named" or "all".
	 */
	allNamedExports?: string[];
	/**
	 * When true, the file exports an object bundle (e.g. `export const fns = { fn1, fn2 }`).
	 *
	 * In module mode, categories with `emit: "nested"` spread bundle files
	 * into the parent object (`...varName`) instead of assigning them as leaves.
	 *
	 * Detection: `export const X = {` (object literal value, not a function call).
	 * This allows route files to contain multiple `route()` definitions plus
	 * a bundle export that aggregates them.
	 */
	isBundle?: boolean;
	/**
	 * When set, this single file should be destructured into multiple createApp keys.
	 * Keys = property names on the exported object.
	 * Values = createApp argument keys (state keys).
	 *
	 * @see DiscoverPattern.destructure
	 * @deprecated Use `configKey` instead — maps the whole file to one key in the `config` bucket.
	 */
	destructure?: Record<string, string>;

	/**
	 * When set, the file is emitted as a whole-object entry under `config.<configKey>`
	 * instead of being destructured into flat keys.
	 */
	configKey?: string;
}

// ============================================================================
// Discover Pattern
// ============================================================================

/**
 * Pattern definition for plugin file discovery.
 *
 * When a string:
 * - If it contains `*` or is a directory pattern (`"blocks/*.ts"`): treated as
 *   directory pattern with `resolve: "auto"`, `keyFrom: "filename"`, `cardinality: "map"`
 * - If it's a single file (`"sidebar.ts"`): treated as single-file pattern with
 *   `resolve: "auto"`, `keyFrom: "filename"`, `cardinality: "single"`
 *
 * @see RFC-MODULE-ARCHITECTURE §4.6 (Plugin Discover API)
 */
export type DiscoverPattern =
	| string
	| {
			/** Glob pattern relative to questpie root. */
			pattern: string;
			/**
			 * How to resolve exports from discovered files.
			 * - "auto" (default): detect from file content — use default import if file
			 *   has default export, named imports otherwise
			 * - "default": always use default import
			 * - "named": always use named imports (all exports)
			 * - "all": collect all exports (both default and named)
			 */
			resolve?: "default" | "named" | "all" | "auto";
			/**
			 * How to derive the key for each discovered entity.
			 * - "filename" (default for directory patterns): derive key from file name (camelCase)
			 * - "exportName" (default for named exports): derive key from the export identifier
			 */
			keyFrom?: "filename" | "exportName";
			/**
			 * Whether this pattern produces a single value or a map of values.
			 * - "map" (default for directory patterns): creates a Record<string, Entity>
			 * - "single" (default for single-file patterns): creates a single value
			 */
			cardinality?: "single" | "map";
			/**
			 * How to merge multiple matching files for `cardinality: "single"` patterns.
			 *
			 * - "replace" (default): only the root-level file wins.
			 * - "spread": collect ALL matching files (root + `features/*\/pattern`)
			 *   and spread them as an array in the generated `createApp()` call.
			 *
			 * Use "spread" for array-shaped singletons (sidebar entries, dashboard widgets)
			 * so every feature module can contribute without a central file importing all.
			 *
			 * @example
			 * ```ts
			 * // admin plugin — collects sidebar.ts from root + every feature:
			 * discover: { sidebar: { pattern: "sidebar.ts", mergeStrategy: "spread" } }
			 * // Generated:
			 * // sidebar: [..._sidebar_root, ..._sidebar_admin, ..._sidebar_audit],
			 * ```
			 */
			mergeStrategy?: "spread";
			/**
			 * When set, augments `interface Registry` with `typeof` this single
			 * under the given key in module-template output.
			 *
			 * @example
			 * ```ts
			 * fields: { pattern: "fields.ts", registryKey: "~fieldTypes" }
			 * // → declare module "questpie" { interface Registry { "~fieldTypes": typeof _fields; } }
			 * ```
			 */
			registryKey?: string;
			/**
			 * Destructure a composite config file into multiple createApp keys.
			 *
			 * When a single file exports an object with multiple config properties
			 * (e.g. `config/app.ts` exports `{ locale, access, hooks, context }`),
			 * this maps each property to a createApp argument key.
			 *
			 * Keys = property names on the exported object.
			 * Values = createApp argument keys (state keys).
			 *
			 * @example
			 * ```ts
			 * appConfig: {
			 *   pattern: "config/app.ts",
			 *   destructure: {
			 *     locale: "locale",
			 *     access: "defaultAccess",
			 *     hooks: "hooks",
			 *   },
			 * }
			 * // Generated:
			 * // import _appConfig from "../config/app.js";
			 * // locale: _appConfig.locale,
			 * // defaultAccess: _appConfig.access,
			 * ```
			 * @deprecated Use `configKey` instead.
			 */
			destructure?: Record<string, string>;

			/**
			 * When set, the discovered file is emitted as `config.<configKey>` in the
			 * createApp definition. Each config file = one key in the config bucket.
			 * Modules can contribute the same config key — merged per sub-key strategy.
			 *
			 * @example
			 * ```ts
			 * appConfig: { pattern: "config/app.ts", configKey: "app" }
			 * // Generated: config: { app: _appConfig }
			 * ```
			 */
			configKey?: string;
	  };

// ============================================================================
// Category Declaration
// ============================================================================

/**
 * Declares a directory-pattern category for file discovery and code generation.
 *
 * Categories are the primary unit of the plugin system. Each category
 * (collections, globals, jobs, routes, blocks, views, etc.) is declared
 * by a plugin via `categories` on `CodegenPlugin`.
 *
 * The core plugin declares all built-in categories (collections, globals, etc.).
 * Other plugins (admin, audit) declare their own (blocks, views, components).
 *
 * Category metadata drives both discovery (what files to scan) and emission
 * (how to generate imports, types, and runtime code).
 *
 * @see RFC-PLUGIN-SYSTEM.md
 */
export interface CategoryDeclaration {
	/**
	 * Directories to scan relative to the questpie root.
	 * e.g., `["collections"]` scans `collections/` and `features/{name}/collections/`
	 */
	dirs: string[];

	/** Whether to scan directories recursively (e.g., routes). */
	recursive?: boolean;

	/** Variable name prefix for generated imports (e.g., "coll", "route", "bloc"). */
	prefix: string;

	// ── Emission metadata ─────────────────────────────────────

	/**
	 * How to emit this category in the `createApp()` call.
	 * - "record" (default): `{ key: varName, ... }` — standard record emission
	 * - "array": flat array `[var1, var2, ...]` (migrations, seeds)
	 *
	 * @default "record"
	 */
	emit?: "record" | "array";

	/**
	 * Key separator for recursive categories.
	 * - "." — dot-separated keys
	 * - "/" — slash-separated keys (routes: `webhooks/stripe`)
	 *
	 * Only meaningful when `recursive: true`.
	 */
	keySeparator?: "." | "/";

	/**
	 * Override the key used in `createApp()` call.
	 * By default, the category name (discover key) is used.
	 * e.g., `emails` discovers from `emails/` but emits as `emailTemplates` in createApp.
	 */
	createAppKey?: string;

	/**
	 * Extra type import statements to add when this category has files.
	 * Each string is a complete import statement.
	 *
	 * @example
	 * ```ts
	 * extraTypeImports: ['import type { ServiceInstanceOf } from "questpie";']
	 * ```
	 */
	extraTypeImports?: string[];

	/**
	 * How to generate the `App*` type for this category.
	 *
	 * - "standard" (default): `export type AppX = _ModuleX & { key: typeof varName; ... };`
	 * - "services": like standard but values are `ServiceInstanceOf<typeof varName>`
	 * - "emails": standalone record (no module merge), values are `typeof varName`
	 * - "messages": union type of keys from all files (`AppMessageKeys`)
	 * - "none": no type emitted (migrations, seeds)
	 *
	 * @default "standard"
	 */
	typeEmit?: "standard" | "services" | "emails" | "messages" | "none";

	/**
	 * Whether to extract types from modules for this category.
	 * When true, generates `type _ModuleX = _MP<"x">` and uses it
	 * as the base type for `AppX`.
	 *
	 * @default true
	 */
	extractFromModules?: boolean;

	/**
	 * Whether to include this category in the `Registry` augmentation.
	 * When a string, uses that as the registry key name.
	 * When `true`, uses the category name.
	 * When `false` or undefined, not included.
	 *
	 * @default true for standard categories
	 */
	registryKey?: string | boolean;

	/**
	 * Whether to include this category in the `App` state type.
	 * When `true`, adds `categoryName: AppCategoryName;` to the state.
	 * When `false`, omitted.
	 *
	 * @default true for standard categories
	 */
	includeInAppState?: boolean;

	/**
	 * Custom property emission for `AppContext` augmentation.
	 * When set, emits this line in the `AppContext` interface instead of nothing.
	 * Supports `$VAR` placeholder for the variable name.
	 *
	 * @example
	 * ```ts
	 * // services: emit each service as a flat property on AppContext
	 * appContextProperties: "services"
	 * ```
	 */
	appContextEmit?: "services";

	/**
	 * When set, use a runtime property as the object key instead of the file key.
	 *
	 * For example, view definitions have a `.name` property that should be the key
	 * in the generated object: `[_view_kanban.name]: _view_kanban`.
	 *
	 * Without this, the default is to use the file-derived key:
	 * `"kanban": _view_kanban`.
	 *
	 * @example
	 * ```ts
	 * views: { dirs: ["views"], prefix: "view", keyFromProperty: "name" }
	 * // → [_view_collectionTable.name]: _view_collectionTable
	 * ```
	 */
	keyFromProperty?: string;

	// ── Multi-export discovery ────────────────────────────────

	/**
	 * Factory function names that identify entities in this category.
	 * Enables multi-export discovery: each matching export becomes
	 * a separate `DiscoveredFile` entry.
	 *
	 * When set:
	 * - Files are scanned for exports calling these factory functions
	 * - Multiple entities can be discovered from a single file
	 * - Files without any matching factory calls are automatically skipped
	 *   (utility files, type-only files)
	 *
	 * When NOT set:
	 * - Current one-file-one-entity behavior is preserved (backward compatible)
	 *
	 * Uses a two-pass regex approach (no AST parsing):
	 * 1. Scan all `const/let/var X = factory(...)` assignments
	 * 2. Cross-reference with export statements (`export const`, `export { }`,
	 *    `export default`)
	 *
	 * Entity key is ALWAYS derived from the filename, never from the factory
	 * call's string argument. For single-factory files (1 export), the key
	 * equals `deriveFileKey(filename)`. For multi-export files, the export
	 * name is used as fallback.
	 *
	 * @example ["collection"] — for collections category
	 * @example ["block"] — for blocks category
	 * @example ["view", "listView"] — multiple factory names
	 */
	factoryFunctions?: string[];

	// ── Registry / factory type integration ─────────────────────

	/**
	 * Placeholder token for the string union of keys in configType strings.
	 * Used by factory-template.ts to resolve `$VIEW_NAMES` → `_ViewsNames`.
	 *
	 * @example
	 * ```ts
	 * views: { ..., placeholder: "$VIEW_NAMES" }
	 * // → type _ViewsNames = (keyof _RegistryProp<"views"> & string) | (string & {});
	 * ```
	 */
	placeholder?: string;

	/**
	 * Placeholder token for the full record type in configType strings.
	 * Used when the consumer needs actual definitions, not just keys.
	 *
	 * @example
	 * ```ts
	 * listViews: { ..., recordPlaceholder: "$LIST_VIEWS" }
	 * // → type _ListViewsRecord = _RegistryProp<"listViews">;
	 * ```
	 */
	recordPlaceholder?: string;

	/**
	 * Type registry interface to augment with strict name keys.
	 * Enables plugin-extensible discriminant types (e.g. `ComponentType`).
	 *
	 * @example
	 * ```ts
	 * components: {
	 *   ...,
	 *   typeRegistry: { module: "@questpie/admin/server", interface: "ComponentTypeRegistry" },
	 * }
	 * // → declare module "@questpie/admin/server" {
	 * //     interface ComponentTypeRegistry extends Record<_ComponentsNames_Strict, {}> {}
	 * // }
	 * ```
	 */
	typeRegistry?: {
		/** Module specifier for the `declare module` block. */
		module: string;
		/** Interface name to augment. */
		interface: string;
	};

	/**
	 * Runtime imports for the generated `factories.ts`.
	 *
	 * When a category contributes runtime values that need to be imported
	 * and spread-merged in factories.ts (e.g., field types from a plugin),
	 * declare them here. The factory template imports each named export
	 * and spreads it into the merged field defs.
	 *
	 * Replaces the deprecated `runtimeFieldImports` on `CodegenTargetContribution`.
	 *
	 * @example
	 * ```ts
	 * fieldTypes: {
	 *   dirs: ["fields"],
	 *   prefix: "ftype",
	 *   factoryImports: [
	 *     { name: "adminFields", from: "@questpie/admin/server" },
	 *   ],
	 * }
	 * // Generated in factories.ts:
	 * // import { adminFields } from "@questpie/admin/server";
	 * // const _rawFieldDefs = { ...builtinFields, ...adminFields };
	 * ```
	 */
	factoryImports?: Array<{
		/** Named export to import (e.g. "adminFields") */
		name: string;
		/** Package/path to import from (e.g. "@questpie/admin/server") */
		from: string;
	}>;
}

// ============================================================================
// Codegen Target Contribution
// ============================================================================

/**
 * A single plugin's contribution to a codegen target.
 *
 * Each plugin declares what it contributes to each target via
 * `targets: Record<string, CodegenTargetContribution>`. Multiple plugins
 * may contribute to the same target — their contributions are merged by
 * `resolveTargetGraph()`.
 *
 * @see PLAN-PLUGIN-CONSISTENCY.md §4 (New Plugin Contract)
 */
export interface CodegenTargetContribution {
	/**
	 * Root directory for discovery, relative to the resolved server root.
	 * e.g. `"."` for server-side files, `"../admin"` for client admin files.
	 */
	root: string;

	/**
	 * Output directory within root for generated files.
	 * @default ".generated"
	 */
	outDir?: string;

	/**
	 * Primary output filename for this target.
	 * e.g. `"index.ts"` for server, `"client.ts"` for admin client.
	 */
	outputFile: string;

	/**
	 * Subdirectory within module directories where this target discovers files.
	 *
	 * In package mode, when iterating module subdirectories, the discovery root
	 * for this target becomes `join(moduleDir, moduleRoot)` instead of `moduleDir`.
	 *
	 * @example
	 * ```ts
	 * // admin-client target discovers from "client/" subdir within each module:
	 * moduleRoot: "client"
	 * // → module "admin" at modules/admin/ discovers from modules/admin/client/
	 * ```
	 */
	moduleRoot?: string;

	/**
	 * Declare directory-pattern categories for file discovery.
	 * Key = category name (e.g. "collections", "blocks"), value = category metadata.
	 *
	 * Categories drive the full pipeline: file scanning, import generation,
	 * type emission, and runtime code in createApp().
	 */
	categories?: Record<string, CategoryDeclaration>;

	/**
	 * Register file patterns to discover.
	 * Key = state key (e.g. "blocks"), value = pattern definition.
	 *
	 * Supports both string shorthand and full DiscoverPattern objects.
	 */
	discover?: Record<string, DiscoverPattern>;

	/**
	 * Called after all files are discovered, before code is generated.
	 * Can modify the context (add imports, type declarations, runtime code).
	 */
	transform?: (ctx: CodegenContext) => void;

	/**
	 * Registry declarations for codegen-generated typed factories.
	 *
	 * @see RFC-CONTEXT-FIRST §6.4 (Third-Party Plugin Extensions)
	 */
	registries?: {
		/** Extension methods for collection() factory. */
		collectionExtensions?: Record<string, RegistryExtension>;
		/** Extension methods for global() factory. */
		globalExtensions?: Record<string, RegistryExtension>;
		/** Extension methods for Field instances (e.g. .admin(), .form()). */
		fieldExtensions?: Record<string, RegistryExtension>;
		/** Singleton factory functions (branding, sidebar, locale, etc.). */
		singletonFactories?: Record<string, SingletonFactory>;
		/** Builder factory functions that need wrapped field defs (e.g. block()). */
		builderFactories?: Record<string, BuilderFactory>;
	};

	/**
	 * Callback parameter definitions for extension methods.
	 *
	 * When an extension's `callbackContextParams` lists `["v", "f"]`, codegen
	 * looks up each key in the merged callback params and emits the
	 * corresponding `proxyCode` inline.
	 */
	callbackParams?: Record<string, CallbackParamDefinition>;

	/**
	 * Optional custom generator for this target.
	 * When provided, replaces the default template generation.
	 * Only one plugin may provide a generator per target.
	 *
	 * @see PLAN-PLUGIN-CONSISTENCY.md §4 (CodegenTargetContribution)
	 */
	generate?: (
		ctx: CodegenTargetGenerateContext,
	) => Promise<CodegenTargetOutput> | CodegenTargetOutput;

	/**
	 * Scaffold templates for `questpie add`.
	 *
	 * Key = scaffold type name (e.g. "collection", "block", "field").
	 * Multiple targets may declare the same scaffold name — `questpie add`
	 * creates files in ALL matching targets (they write to different roots).
	 */
	scaffolds?: Record<string, ScaffoldConfig>;

}

// ============================================================================
// Target Generate Context & Output
// ============================================================================

/**
 * Context passed to a custom target generator.
 * Provides access to all discovered files and the resolved target metadata.
 */
export interface CodegenTargetGenerateContext {
	/** The resolved target being generated. */
	target: ResolvedTarget;
	/** Discovery result for this target. */
	discovered: DiscoveryResult;
	/** Extra imports added by transforms. */
	extraImports: Array<{ name: string; path: string }>;
	/** Extra type declarations added by transforms. */
	extraTypeDeclarations: string[];
	/** Extra runtime code added by transforms. */
	extraRuntimeCode: string[];
	/** Extra entity key-value pairs added by transforms. */
	extraEntities: Map<string, string>;
}

/**
 * Output from a custom target generator.
 */
export interface CodegenTargetOutput {
	/** Generated file content. */
	code: string;
	/** Optional additional files to write (relative path → content). */
	additionalFiles?: Record<string, string>;
}

// ============================================================================
// Resolved Target
// ============================================================================

/**
 * A fully resolved target — the result of merging all plugin contributions
 * for a single target ID.
 *
 * Created by `resolveTargetGraph()`. Used internally by `runCodegen()`
 * to drive discovery, transforms, and generation for each target.
 */
export interface ResolvedTarget {
	/** Target identifier (e.g. "server", "admin-client"). */
	id: string;

	/** Root directory for discovery, relative to the server root. */
	root: string;

	/** Output directory for generated files. */
	outDir: string;

	/** Primary output filename. */
	outputFile: string;

	/** Subdirectory within module directories for this target's discovery. */
	moduleRoot?: string;

	/** Merged categories from all contributing plugins. */
	categories: Record<string, CategoryDeclaration>;

	/** Merged discover patterns from all contributing plugins. */
	discover: Record<string, DiscoverPattern>;

	/** Merged registries from all contributing plugins. */
	registries: {
		collectionExtensions: Record<string, RegistryExtension>;
		globalExtensions: Record<string, RegistryExtension>;
		fieldExtensions: Record<string, RegistryExtension>;
		singletonFactories: Record<string, SingletonFactory>;
		builderFactories: Record<string, BuilderFactory>;
	};

	/** Merged callback parameter definitions from all contributing plugins. */
	callbackParams: Record<string, CallbackParamDefinition>;

	/** All transform functions from contributing plugins, in plugin order. */
	transforms: Array<(ctx: CodegenContext) => void>;

	/** Custom generator (at most one per target). */
	generate?: (
		ctx: CodegenTargetGenerateContext,
	) => Promise<CodegenTargetOutput> | CodegenTargetOutput;

	/** Merged scaffold templates from all contributing plugins. */
	scaffolds: Record<string, ScaffoldConfig>;
}

// ============================================================================
// Codegen Plugin
// ============================================================================

/**
 * A codegen plugin declares contributions to one or more codegen targets.
 *
 * Plugins are registered in `questpie.config.ts` via the `plugins` array
 * in `runtimeConfig()`.
 *
 * Each plugin contributes categories, discover patterns, registries,
 * transforms, and callback params to specific targets. Contributions from
 * multiple plugins are merged per target by `resolveTargetGraph()`.
 *
 * @example
 * ```ts
 * export function adminPlugin(): CodegenPlugin {
 *   return {
 *     name: "questpie-admin",
 *     targets: {
 *       server: {
 *         root: ".",
 *         outputFile: "index.ts",
 *         discover: {
 *           views: "views/*.ts",
 *           blocks: "blocks/*.ts",
 *           branding: "branding.ts",
 *         },
 *         registries: { ... },
 *       },
 *     },
 *   };
 * }
 * ```
 *
 * @see PLAN-PLUGIN-CONSISTENCY.md §4 (New Plugin Contract)
 */
export interface CodegenPlugin {
	/** Unique plugin name. */
	name: string;

	/**
	 * Target contributions keyed by target ID.
	 *
	 * Well-known target IDs:
	 * - `"server"` — server-side generated output (index.ts + factories.ts)
	 * - `"admin-client"` — admin client generated output (client.ts)
	 *
	 * Plugins may define additional target IDs.
	 */
	targets: Record<string, CodegenTargetContribution>;

	/**
	 * Cross-target validators run after all targets have been generated.
	 *
	 * Each validator receives the full map of target results and returns
	 * an array of projection errors. Use this to enforce that server-side
	 * references (views, components, blocks) have matching client-side
	 * registrations.
	 *
	 * @see PLAN-PLUGIN-CONSISTENCY.md §9 (Projection Quality Gate)
	 */
	validators?: CrossTargetValidator[];
}

/**
 * Defines how to emit a callback context parameter at codegen time.
 * Used by `emitCallbackContext()` to generate runtime proxy objects.
 *
 * Instead of inline JavaScript strings, each param references a real
 * exported factory function that creates the proxy at runtime.
 */
export interface CallbackParamDefinition {
	/**
	 * Name of the factory function to call (must be a named export from `from`).
	 *
	 * @example
	 * ```ts
	 * // Field ref proxy: f.title → "title"
	 * { factory: "createFieldNameProxy", from: "questpie" }
	 * ```
	 */
	factory: string;

	/**
	 * Module specifier to import the factory from.
	 */
	from: string;
}

/**
 * Extension method declaration for codegen-generated factories.
 * Describes how to generate a typed wrapper method on collection()/global()/block().
 */
export interface RegistryExtension {
	/** State key stored on the builder via .set(). */
	stateKey: string;

	/**
	 * Import declarations needed for this extension's types.
	 * These will be added to the generated factories file.
	 */
	imports?: Array<{ name: string; from: string }>;

	/**
	 * TypeScript type signature for the config parameter.
	 * If not provided, the extension accepts `any`.
	 */
	configType?: string;

	/**
	 * Whether the config is a callback function receiving a context object.
	 * If true, codegen generates proxy helpers (field ref, view proxy, etc.).
	 */
	isCallback?: boolean;

	/**
	 * Context parameter names for callback-style extensions.
	 * e.g. ["v", "f", "a"] for list(), ["f"] for form().
	 */
	callbackContextParams?: string[];

	/**
	 * Placeholder → category mapping for module-driven type extraction.
	 * Codegen replaces placeholders in configType with type aliases
	 * extracted from the module tree.
	 *
	 * @example
	 * ```ts
	 * configType: "AdminCollectionConfig | ((ctx: AdminConfigContext<$COMPONENT_NAMES>) => ...)",
	 * configTypePlaceholders: { "$COMPONENT_NAMES": "components" },
	 * ```
	 */
	configTypePlaceholders?: Record<string, string>;

	/**
	 * Default values to merge into the resolved extension config.
	 *
	 * When set, the generated `resolve` function wraps user config with
	 * `{ ...defaults, ...userConfig }` so that omitted keys fall back
	 * to these defaults.
	 *
	 * @example
	 * ```ts
	 * defaults: { view: "collection-table" }
	 * // → user omits `view` → gets "collection-table" automatically
	 * ```
	 */
	defaults?: Record<string, unknown>;
}

// ============================================================================
// Singleton Factory
// ============================================================================

/**
 * Declaration for a singleton factory function generated in factories.ts.
 * Singleton factories provide typed identity wrappers for config files
 * like branding.ts, sidebar.ts, locale.ts, etc.
 *
 * @example
 * ```ts
 * // Generated: export function branding<T extends ServerBrandingConfig>(config: T): T { return config; }
 * // Usage:     export default branding({ name: "My App" });
 * ```
 */
export interface SingletonFactory {
	/** TypeScript type for the config parameter. */
	configType: string;
	/** Import declarations needed for the config type. */
	imports: Array<{ name: string; from: string }>;
	/**
	 * Whether the config can also be a callback function.
	 * If true, generates overloaded identity that accepts both
	 * plain config and callback form.
	 */
	isCallback?: boolean;
}

// ============================================================================
// Builder Factory
// ============================================================================

/**
 * Declaration for a builder factory function generated in factories.ts.
 * Builder factories create builder instances that need the wrapped field defs
 * (with extension methods like .admin(), .form()) passed at construction time.
 *
 * Unlike collection() and global() which are always generated, builder
 * factories are contributed by plugins (e.g. admin contributes block()).
 *
 * @example
 * ```ts
 * // Plugin declares:
 * builderFactories: {
 *   block: {
 *     builderClass: "BlockBuilder",
 *     import: { name: "BlockBuilder", from: "@questpie/admin/server" },
 *     createMethod: "create",
 *   },
 * }
 * // Codegen generates:
 * import { BlockBuilder } from "@questpie/admin/server";
 * export function block<TName extends string>(name: TName) {
 *   return BlockBuilder.create(name, _allFieldDefs);
 * }
 * ```
 */
export interface BuilderFactory {
	/** Name of the builder class (e.g. "BlockBuilder"). */
	builderClass: string;
	/** Import declaration for the builder class. */
	import: { name: string; from: string };
	/** Static method name on the builder class that accepts (name, fieldDefs). */
	createMethod: string;
	/** TypeScript generic signature for the factory function. Defaults to `<TName extends string>`. */
	genericSignature?: string;
	/** TypeScript return type expression. Use `$CLASS` as placeholder for the builder class name. */
	returnType?: string;
}

// ============================================================================
// Codegen Context
// ============================================================================

/**
 * Context passed to codegen plugins.
 * Provides access to all discovered files and methods to modify generated output.
 */
export interface CodegenContext {
	/**
	 * All discovered categories (collections, globals, blocks, etc.).
	 * Key = category name, value = map of discovered files.
	 */
	categories: Map<string, Map<string, DiscoveredFile>>;

	/** Discovered single-file items keyed by stateKey. */
	singles: Map<string, DiscoveredFile>;

	/**
	 * Discovered spread items keyed by stateKey.
	 * Each entry is an ordered list: root file first, then feature files.
	 */
	spreads: Map<string, DiscoveredFile[]>;

	/** Add an import statement to the generated file. */
	addImport(name: string, path: string): void;
	/** Add a type declaration to the generated file. */
	addTypeDeclaration(code: string): void;
	/** Add runtime code to the generated file. */
	addRuntimeCode(code: string): void;
	/** Set a key on the entities passed to createApp(). */
	set(key: string, value: string): void;
}

// ============================================================================
// Codegen Options
// ============================================================================

/**
 * Options for running codegen.
 */
export interface CodegenOptions {
	/** Absolute path to the questpie root (directory containing questpie.config.ts). */
	rootDir: string;
	/** Absolute path to the questpie.config.ts file (required for root app mode). */
	configPath: string;
	/** Absolute path to the output directory (e.g. rootDir/.generated). */
	outDir: string;
	/** Codegen plugins to run (from config modules). */
	plugins?: CodegenPlugin[];
	/** If true, don't write files — just return the generated code. */
	dryRun?: boolean;

	/**
	 * Target ID to generate. When omitted, defaults to "server".
	 * Use `runAllTargets()` to generate all targets at once.
	 */
	targetId?: string;

	/**
	 * Module codegen mode.
	 * When set, generates a `module.ts` file (static module definition)
	 * instead of an `index.ts` file (root app with createApp).
	 *
	 * @see RFC-MODULE-ARCHITECTURE §9.2 (Module — .generated/module.ts)
	 */
	module?: {
		/** Module name (e.g. "questpie-admin", "questpie-audit"). */
		name: string;
		/** Output filename. @default "module.ts" */
		outputFile?: string;
		/**
		 * Self-package import rewriting for module-within-package codegen.
		 *
		 * When a plugin's transform() adds imports referencing the same package
		 * (e.g. `@questpie/admin/server` inside the `@questpie/admin` package),
		 * TypeScript resolves the `"types"` export condition to stale `dist/` types.
		 *
		 * This map rewrites external package specifiers to internal aliases that
		 * resolve to source files via tsconfig paths.
		 *
		 * @example { "@questpie/admin": "#questpie/admin" }
		 * → `@questpie/admin/server` becomes `#questpie/admin/server/index.js`
		 */
		importRewriteMap?: Record<string, string>;
	};
}

/**
 * Result of running codegen for a single target.
 */
export interface CodegenResult {
	/** Target ID that was generated (e.g. "server", "admin-client"). */
	targetId: string;
	/** Generated file content. */
	code: string;
	/** Absolute path of the generated file. */
	outputPath: string;
	/** All discovered files. */
	discovered: DiscoveryResult;
}

/**
 * Aggregated result of running codegen for all targets.
 */
export interface MultiTargetCodegenResult {
	/** Per-target results, keyed by target ID. */
	targets: Map<string, CodegenResult>;
	/** Errors encountered during codegen (non-fatal per target). */
	errors: Array<{ targetId: string; error: Error }>;
	/** Validation errors from cross-target projection checks. */
	validationErrors: ProjectionError[];
}

// ============================================================================
// Cross-Target Validation
// ============================================================================

/**
 * A cross-target projection error.
 *
 * Emitted when a server-side reference (view, component, block) does not
 * have a corresponding registration in the admin-client target.
 *
 * @see PLAN-PLUGIN-CONSISTENCY.md §9 (Projection Quality Gate)
 */
export interface ProjectionError {
	/** Error severity — "error" causes codegen to fail, "warning" is informational. */
	severity: "error" | "warning";
	/** Which category of reference is mismatched (e.g. "blocks", "views", "components"). */
	category: string;
	/** The missing key in the consumer target. */
	key: string;
	/** The target that references this key (producer). */
	sourceTarget: string;
	/** The target that should register this key (consumer). */
	consumerTarget: string;
	/** Human-readable message with actionable fix suggestion. */
	message: string;
}

/**
 * Cross-target validator function.
 *
 * Called after all targets have been generated. Receives the full result map
 * and can return projection errors for keys that exist in one target but
 * are missing from another.
 *
 * Validators are registered on `CodegenPlugin.validators`.
 *
 * @see PLAN-PLUGIN-CONSISTENCY.md §9 (Projection Quality Gate)
 */
export type CrossTargetValidator = (
	targets: Map<string, CodegenResult>,
) => ProjectionError[];

// ============================================================================
// Discovery Result
// ============================================================================

/**
 * Unified result of file discovery.
 *
 * All directory-pattern categories (collections, globals, blocks, etc.) are
 * stored in the generic `categories` map. Singles and spreads come from
 * plugin `discover` patterns.
 *
 */
export interface DiscoveryResult {
	/**
	 * All directory-pattern categories.
	 * Key = category name (e.g., "collections", "blocks"), value = map of discovered files.
	 * Ordered: core categories first (in declaration order), then plugin categories.
	 */
	categories: Map<string, Map<string, DiscoveredFile>>;

	/** Single-file items keyed by stateKey (auth, locale, hooks, branding, etc.). */
	singles: Map<string, DiscoveredFile>;

	/**
	 * Spread items keyed by stateKey (sidebar, dashboard, etc.).
	 * Each entry is an ordered list: root file first, then feature files alphabetically.
	 */
	spreads: Map<string, DiscoveredFile[]>;
}

// ============================================================================
// Scaffold Types
// ============================================================================

/**
 * Configuration for a scaffold template in `questpie add`.
 *
 * Each plugin target can declare scaffolds that create files when the user
 * runs `questpie add <type> <name>`. Multiple targets may declare the same
 * scaffold type — files are created in ALL matching targets.
 */
export interface ScaffoldConfig {
	/** Directory relative to the target root where the file is created. */
	dir: string;
	/** File extension including the dot. @default ".ts" */
	extension?: string;
	/** Human-readable description for CLI help/error messages. */
	description?: string;
	/** Template function that generates file content. */
	template: (ctx: ScaffoldContext) => string;
}

/**
 * Context passed to scaffold template functions.
 */
export interface ScaffoldContext {
	/** Kebab-case name (e.g. "my-block"). */
	kebab: string;
	/** camelCase name (e.g. "myBlock"). */
	camel: string;
	/** PascalCase name (e.g. "MyBlock"). */
	pascal: string;
	/** Title Case name (e.g. "My Block"). */
	title: string;
	/** Target ID this scaffold is being created for (e.g. "server", "admin-client"). */
	targetId: string;
}
