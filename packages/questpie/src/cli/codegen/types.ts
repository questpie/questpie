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
		};

// ============================================================================
// Codegen Plugin
// ============================================================================

/**
 * A codegen plugin can register additional file patterns to discover
 * and transform the codegen context before code is emitted.
 *
 * Plugins are registered in `questpie.config.ts` via the `plugins` array
 * in `runtimeConfig()`.
 *
 * @example
 * ```ts
 * export function adminPlugin(): CodegenPlugin {
 *   return {
 *     name: "questpie-admin",
 *     discover: {
 *       blocks: "blocks/*.ts",
 *       sidebar: { pattern: "sidebar.ts", mergeStrategy: "spread" },
 *       dashboard: { pattern: "dashboard.ts", mergeStrategy: "spread" },
 *       branding: "branding.ts",
 *       adminLocale: "admin-locale.ts",
 *     },
 *   };
 * }
 * ```
 *
 * @see RFC-MODULE-ARCHITECTURE §4.6 (Plugin Discover API)
 */
export interface CodegenPlugin {
	/** Unique plugin name. */
	name: string;

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
	 * Each entry describes an extension method that should appear on
	 * collection(), global(), or block() factories.
	 *
	 * Codegen reads these registries and generates typed wrapper methods
	 * that call `builder.set(stateKey, value)` under the hood. No monkey-patching.
	 *
	 * @see RFC-CONTEXT-FIRST §6.4 (Third-Party Plugin Extensions)
	 *
	 * @example
	 * ```ts
	 * registries: {
	 *   collectionExtensions: {
	 *     admin: {
	 *       stateKey: "admin",
	 *       imports: [{ name: "AdminCollectionConfig", from: "@questpie/admin/server" }],
	 *     },
	 *     list: {
	 *       stateKey: "adminList",
	 *       imports: [{ name: "ListViewConfig", from: "@questpie/admin/server" }],
	 *     },
	 *   },
	 * }
	 * ```
	 */
	registries?: {
		/** Extension methods for collection() factory. */
		collectionExtensions?: Record<string, RegistryExtension>;
		/** Extension methods for global() factory. */
		globalExtensions?: Record<string, RegistryExtension>;
		/** Singleton factory functions (branding, sidebar, locale, etc.). */
		singletonFactories?: Record<string, SingletonFactory>;
		/** Module-level type registries that modules can contribute to (e.g., listViews, editViews, components). */
		moduleRegistries?: Record<string, ModuleRegistryConfig>;
	};
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
/**
 * Module registry — describes a typed record that modules can contribute to.
 * Codegen extracts keys from all modules and makes them available as type names.
 *
 * @example
 * ```ts
 * // Admin plugin declares:
 * moduleRegistries: {
 *   listViews: {
 *     placeholder: "$LIST_VIEW_NAMES",
 *     registryKey: "listViews",
 *   },
 * }
 * // → factory-template generates: type _ListViewNames = _ExtractKeys<"listViews"> | (string & {});
 * // → Registry gets: interface Registry { listViews: Record<_ListViewNames, unknown>; }
 * ```
 */
export interface ModuleRegistryConfig {
	/** Placeholder token used in configType strings (e.g., "$LIST_VIEW_NAMES") */
	placeholder?: string;
	/** If set, add extracted names to this Registry key for autocomplete */
	registryKey?: string;
}

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
// Codegen Context
// ============================================================================

/**
 * Context passed to codegen plugins.
 * Provides access to all discovered files and methods to modify generated output.
 */
export interface CodegenContext {
	/** Discovered collections. */
	collections: Map<string, DiscoveredFile>;
	/** Discovered globals. */
	globals: Map<string, DiscoveredFile>;
	/** Discovered jobs. */
	jobs: Map<string, DiscoveredFile>;
	/** Discovered functions. */
	functions: Map<string, DiscoveredFile>;
	/** Discovered routes. */
	routes: Map<string, DiscoveredFile>;
	/** Discovered message locales. */
	messages: Map<string, DiscoveredFile>;
	/** Discovered services from services/*.ts. */
	services: Map<string, DiscoveredFile>;
	/** Discovered auth file (at most one). */
	auth: DiscoveredFile | null;

	/** Plugin-discovered items keyed by stateKey from discover. */
	custom: Map<string, Map<string, DiscoveredFile>>;
	/** Plugin-discovered single-file items keyed by stateKey. */
	singles: Map<string, DiscoveredFile>;
	/**
	 * Plugin-discovered spread items keyed by stateKey.
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
	};
}

/**
 * Result of running codegen.
 */
export interface CodegenResult {
	/** Generated file content. */
	code: string;
	/** Absolute path of the generated file. */
	outputPath: string;
	/** All discovered files keyed by category. */
	discovered: {
		collections: Map<string, DiscoveredFile>;
		globals: Map<string, DiscoveredFile>;
		jobs: Map<string, DiscoveredFile>;
		functions: Map<string, DiscoveredFile>;
		routes: Map<string, DiscoveredFile>;
		messages: Map<string, DiscoveredFile>;
		services: Map<string, DiscoveredFile>;
		emails: Map<string, DiscoveredFile>;
		migrations: Map<string, DiscoveredFile>;
		seeds: Map<string, DiscoveredFile>;
		auth: DiscoveredFile | null;
		custom: Map<string, Map<string, DiscoveredFile>>;
		singles: Map<string, DiscoveredFile>;
		spreads: Map<string, DiscoveredFile[]>;
	};
}
