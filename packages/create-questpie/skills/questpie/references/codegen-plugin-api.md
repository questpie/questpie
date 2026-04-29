# Codegen Plugin API Reference

Source: `packages/questpie/src/cli/codegen/types.ts`

## CodegenPlugin

Top-level plugin interface. Registered in `questpie.config.ts` via the `plugins` array.

```ts
interface CodegenPlugin {
	/** Unique plugin name. */
	name: string;

	/**
	 * Target contributions keyed by target ID.
	 * Well-known target IDs: "server", "admin-client".
	 */
	targets: Record<string, CodegenTargetContribution>;

	/**
	 * Cross-target validators run after all targets have been generated.
	 * Returns projection errors for keys missing between targets.
	 */
	validators?: CrossTargetValidator[];
}
```

## CodegenTargetContribution

A single plugin's contribution to a codegen target.

```ts
interface CodegenTargetContribution {
	/** Root directory for discovery, relative to resolved server root. */
	root: string;

	/** Output directory within root for generated files. @default ".generated" */
	outDir?: string;

	/** Primary output filename (e.g. "index.ts", "client.ts"). */
	outputFile: string;

	/** Subdirectory within module directories for discovery. */
	moduleRoot?: string;

	/** Directory-pattern categories for file discovery. */
	categories?: Record<string, CategoryDeclaration>;

	/** File patterns to discover (string shorthand or full DiscoverPattern). */
	discover?: Record<string, DiscoverPattern>;

	/** Post-discovery transform — modify context before code generation. */
	transform?: (ctx: CodegenContext) => void;

	/** Registry declarations for generated typed factories. */
	registries?: {
		collectionExtensions?: Record<string, RegistryExtension>;
		globalExtensions?: Record<string, RegistryExtension>;
		singletonFactories?: Record<string, SingletonFactory>;
	};

	/** Callback parameter definitions for extension methods. */
	callbackParams?: Record<string, CallbackParamDefinition>;

	/** Custom generator (replaces default template generation). */
	generate?: (
		ctx: CodegenTargetGenerateContext,
	) => Promise<CodegenTargetOutput> | CodegenTargetOutput;

	/** Scaffold templates for `questpie add`. */
	scaffolds?: Record<string, ScaffoldConfig>;
}
```

## CategoryDeclaration

Declares a directory-pattern category for file discovery and code generation.

```ts
interface CategoryDeclaration {
	/** Directories to scan relative to QUESTPIE root. */
	dirs: string[];

	/** Whether to scan directories recursively. */
	recursive?: boolean;

	/** Variable name prefix for generated imports (e.g., "coll", "fn"). */
	prefix: string;

	/**
	 * How to emit in createApp() call.
	 * - "record" (default): { key: varName, ... }
	 * - "nested": nested object from dot-separated keys
	 * - "array": flat array [var1, var2, ...]
	 */
	emit?: "record" | "nested" | "array";

	/** Key separator for recursive categories: "." or "/". */
	keySeparator?: "." | "/";

	/** Override the key used in createApp() call. */
	createAppKey?: string;

	/** Extra type import statements when this category has files. */
	extraTypeImports?: string[];

	/**
	 * How to generate the App* type.
	 * - "standard" (default): AppX = _ModuleX & { key: typeof varName; ... }
	 * - "services": values are ServiceInstanceOf<typeof varName>
	 * - "emails": standalone record, no module merge
	 * - "messages": union type of keys
	 * - "functions": nested type object from dot-separated keys
	 * - "none": no type emitted
	 */
	typeEmit?:
		| "standard"
		| "services"
		| "emails"
		| "messages"
		| "functions"
		| "none";

	/** Whether to extract types from modules. @default true */
	extractFromModules?: boolean;

	/** Include in Registry augmentation. String = custom key, true = category name. */
	registryKey?: string | boolean;

	/** Include in App state type. @default true */
	includeInAppState?: boolean;

	/** Custom AppContext property emission. */
	appContextEmit?: "services";

	/**
	 * Use a runtime property as the object key instead of file key.
	 * e.g., views: { keyFromProperty: "name" } -> [_view_kanban.name]: _view_kanban
	 */
	keyFromProperty?: string;

	/** Placeholder token for string union of keys in configType strings. */
	placeholder?: string;

	/** Placeholder token for full record type in configType strings. */
	recordPlaceholder?: string;

	/** Type registry interface to augment with strict name keys. */
	typeRegistry?: {
		module: string;
		interface: string;
	};
}
```

## DiscoverPattern

Pattern definition for plugin file discovery. Can be a string shorthand or full object.

```ts
type DiscoverPattern =
	| string // "blocks/*.ts" or "config/admin.ts"
	| {
			/** Glob pattern relative to QUESTPIE root. */
			pattern: string;

			/**
			 * How to resolve exports.
			 * - "auto" (default): detect from file content
			 * - "default": always use default import
			 * - "named": always use named imports
			 * - "all": collect all exports
			 */
			resolve?: "default" | "named" | "all" | "auto";

			/** How to derive the key: "filename" or "exportName". */
			keyFrom?: "filename" | "exportName";

			/** "map" (directory patterns) or "single" (single-file). */
			cardinality?: "single" | "map";

			/**
			 * How to merge for cardinality: "single".
			 * "spread": collect ALL matching files and spread as array.
			 */
			mergeStrategy?: "spread";

			/** Augment interface Registry with typeof this under given key. */
			registryKey?: string;

			/**
			 * Destructure a composite config file into multiple createApp keys.
			 * Keys = property names on the exported object.
			 * Values = createApp argument keys (state keys).
			 *
			 * @example
			 * appConfig: {
			 *   pattern: "config/app.ts",
			 *   destructure: { locale: "locale", access: "defaultAccess" },
			 * }
			 */
			destructure?: Record<string, string>;
	  };
```

## RegistryExtension

Extension method declaration for codegen-generated factories.

```ts
interface RegistryExtension {
	/** State key stored on the builder via .set(). */
	stateKey: string;

	/** Import declarations needed for this extension's types. */
	imports?: Array<{ name: string; from: string }>;

	/** TypeScript type signature for the config parameter. */
	configType?: string;

	/** Whether the config is a callback receiving context. */
	isCallback?: boolean;

	/** Context parameter names for callback-style extensions. */
	callbackContextParams?: string[];

	/** Placeholder -> category mapping for type extraction. */
	configTypePlaceholders?: Record<string, string>;

	/** Default values merged into resolved extension config. */
	defaults?: Record<string, unknown>;
}
```

## CallbackParamDefinition

Defines how to emit a callback context parameter at codegen time.

```ts
interface CallbackParamDefinition {
	/**
	 * Name of the factory function to call (must be a named export from `from`).
	 *
	 * Example: { factory: "createFieldNameProxy", from: "questpie" }
	 */
	factory: string;

	/** Module specifier to import the factory from. */
	from: string;
}
```

## SingletonFactory

Declaration for a singleton factory function generated in factories.ts.

```ts
interface SingletonFactory {
	/** TypeScript type for the config parameter. */
	configType: string;

	/** Import declarations needed for the config type. */
	imports: Array<{ name: string; from: string }>;

	/** Whether the config can also be a callback function. */
	isCallback?: boolean;
}
```

## CodegenContext

Context passed to `transform()` callbacks.

```ts
interface CodegenContext {
	/** All discovered categories. Key = category name, value = map of files. */
	categories: Map<string, Map<string, DiscoveredFile>>;

	/** Discovered single-file items keyed by stateKey. */
	singles: Map<string, DiscoveredFile>;

	/** Discovered spread items keyed by stateKey. */
	spreads: Map<string, DiscoveredFile[]>;

	/** Add an import statement to generated file. */
	addImport(name: string, path: string): void;

	/** Add a type declaration to generated file. */
	addTypeDeclaration(code: string): void;

	/** Add runtime code to generated file. */
	addRuntimeCode(code: string): void;

	/** Set a key on entities passed to createApp(). */
	set(key: string, value: string): void;
}
```

## DiscoveredFile

A file discovered during codegen scanning.

```ts
interface DiscoveredFile {
	absolutePath: string;
	key: string;
	importPath: string;
	varName: string;
	source: string;
	exportType: "default" | "named" | "unknown";
	namedExportName?: string;
	allNamedExports?: string[];
	isBundle?: boolean;
}
```

## ScaffoldConfig

Configuration for `questpie add` scaffold templates.

```ts
interface ScaffoldConfig {
	/** Directory relative to target root where file is created. */
	dir: string;

	/** File extension including dot. @default ".ts" */
	extension?: string;

	/** Human-readable description for CLI help. */
	description?: string;

	/** Template function generating file content. */
	template: (ctx: ScaffoldContext) => string;
}

interface ScaffoldContext {
	kebab: string; // "my-block"
	camel: string; // "myBlock"
	pascal: string; // "MyBlock"
	title: string; // "My Block"
	targetId: string;
}
```

## CrossTargetValidator

Validates consistency between targets after generation.

```ts
type CrossTargetValidator = (
	targets: Map<string, CodegenResult>,
) => ProjectionError[];

interface ProjectionError {
	severity: "error" | "warning";
	category: string;
	key: string;
	sourceTarget: string;
	consumerTarget: string;
	message: string;
}
```

## CodegenOptions

Options for running codegen.

```ts
interface CodegenOptions {
	rootDir: string;
	configPath: string;
	outDir: string;
	plugins?: CodegenPlugin[];
	dryRun?: boolean;
	targetId?: string;
	module?: {
		name: string;
		outputFile?: string;
		importRewriteMap?: Record<string, string>;
	};
}
```
