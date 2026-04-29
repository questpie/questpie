# RFC: Plugin System Architecture

> Status: **Draft**
> Authors: @drepkovsky
> Date: 2026-02-28
> Extends: RFC-MODULE-ARCHITECTURE.md

---

## 1. Summary

This RFC defines the complete plugin system for questpie. A plugin is a
**codegen declaration** that tells the framework what exists in the ecosystem —
what entity types to discover, what builder methods to add, what types to
generate, and how to merge contributions from modules and user code.

The framework itself is lean. It provides only primitives: `field()`, `view()`,
`component()`, `collection()`, `fn()`, codegen engine, module system. All
actual functionality — including built-in field types, views, and components —
is contributed by plugins and modules.

### 1.1 Core Principles

1. **Framework = engine + primitives.** No built-in fields, no built-in views,
   no admin-specific keys. Everything comes from plugins and modules.
2. **One mechanism for everything.** Collections, fields, views, components,
   blocks — all follow the same pattern: plugin declares category → codegen
   discovers files → merges with module contributions → generates types.
3. **Plugins declare, modules contribute.** A plugin says "views exist and
   live in `views/*.ts`". A module says "here is my `table` view definition".
   User code says "here is my `kanban` view definition".
4. **Type safety end-to-end.** Plugin declarations drive codegen which
   generates `declare module` augmentations. User code gets autocomplete
   and type checking for everything plugins introduce.

---

## 2. Plugin vs Module vs Config

| Concept    | What it is             | What it does                                           | Example                         |
| ---------- | ---------------------- | ------------------------------------------------------ | ------------------------------- |
| **Plugin** | Codegen declaration    | Tells codegen what to discover, what types to generate | `adminPlugin()`, `corePlugin()` |
| **Module** | Static entity record   | Contributes values (collections, fields, views...)     | `starterModule`, `adminModule`  |
| **Config** | Runtime infrastructure | DB, adapters, secret, plugin registrations             | `questpie.config.ts`            |

**Plugin** = "what CAN exist" (schema).
**Module** = "what DOES exist" (values).
**Config** = "how it runs" (infrastructure).

---

## 3. The CodegenPlugin Interface

```ts
interface CodegenPlugin {
	name: string;

	/**
	 * File patterns to discover from the filesystem.
	 * Each key becomes a category (e.g., "collections", "views", "blocks").
	 * Discovered files are imported into generated code and merged with
	 * module contributions.
	 */
	categories?: Record<string, CategoryDeclaration>;

	/**
	 * Methods to add on CollectionBuilder and/or GlobalBuilder.
	 * Each extension generates a `declare module` augmentation and a
	 * Proxy-based runtime wrapper.
	 */
	extensions?: {
		collection?: Record<string, ExtensionDeclaration>;
		global?: Record<string, ExtensionDeclaration>;
	};

	/**
	 * Module-level registries. For each key, codegen extracts that property
	 * from all modules, aggregates the keys into a union type, and augments
	 * the Registry interface. Used for things like view names, component
	 * names, field types — anything where modules contribute to a shared
	 * registry that other code references.
	 */
	moduleRegistries?: Record<string, ModuleRegistryDeclaration>;

	/**
	 * Single-file factory functions exported from .generated/factories.ts.
	 * Each singleton is a function the user calls to define a single value
	 * (e.g., sidebar(), branding(), locale()).
	 */
	singletons?: Record<string, SingletonDeclaration>;

	/**
	 * Post-discovery hook. Runs after file discovery, before template
	 * generation. Can inject imports, type declarations, runtime code.
	 */
	transform?: (ctx: CodegenContext) => void;
}
```

---

## 4. Categories

A category is a type of entity that can be:

- **Discovered** from the user's filesystem via file convention
- **Contributed** by modules via a property on the module definition
- **Merged** together (module + user contributions)
- **Type-generated** into the `.generated/` output

### 4.1 CategoryDeclaration

```ts
interface CategoryDeclaration {
  /**
   * Glob pattern for file discovery.
   * Directory patterns (containing *): "collections/*.ts", "views/*.ts"
   * Single file patterns: "sidebar.ts"
   */
  pattern: string;

  /**
   * How discovered files map to the output record.
   * "map"    — Record<string, Entity> (default for directory patterns)
   * "single" — single value (default for single-file patterns)
   */
  cardinality?: "map" | "single";

  /**
   * Whether to scan recursively. Functions and routes use this
   * for nested directory structures (functions/billing/create.ts).
   */
  recursive?: boolean;

  /**
   * Whether to also scan features/*/ directories.
   * Enables the feature-based layout alongside the by-type layout.
   */
  featureLayout?: boolean;

  /**
   * How multiple contributions are merged.
   * "record"  — { ...moduleEntities, ...userEntities } (default)
   * "array"   — [...moduleEntities, ...userEntities]
   * "spread"  — collects root + features/*/ into ordered array
   */
  mergeStrategy?: "record" | "array" | "spread";

  /**
   * Property name on ModuleDefinition where modules contribute
   * values for this category. If set, codegen extracts this property
   * from all modules and merges with user-discovered files.
   *
   * Example: moduleContributionKey: "collections" means modules
   * can have { collections: { posts: ..., pages: ... } }
   */
  moduleContributionKey?: string;

  /**
   * Key in the generated createApp() definition object.
   * Usually same as the category key itself.
   */
  runtimeKey?: string;

  /**
   * If set, generates an aggregated type (e.g., AppCollections)
   * and adds it to the Registry interface augmentation.
   */
  registryKey?: string;

  /**
   * Prefix for the generated aggregated type name.
   * With prefix "App" and key "collections" → "AppCollections".
   */
  typePrefix?: string;
}
```

### 4.2 How Categories Flow Through Codegen

```
Plugin declares category
  │
  ▼
Discovery: scan filesystem for pattern
  │  e.g., views/*.ts → found kanban.ts, wizard.ts
  │
  ▼
Module extraction: extract moduleContributionKey from all modules
  │  e.g., adminModule.views → { table: viewDef("table") }
  │        auditModule.views → (none)
  │
  ▼
Template: generate .generated/index.ts
  │  1. Import discovered files:
  │     import _view_kanban from "../views/kanban";
  │
  │  2. Extract module types:
  │     type _ModuleViews = ExtractFromModuleArray<typeof _modules, "views">;
  │
  │  3. Merge into aggregated type:
  │     export interface AppViews extends _ModuleViews {
  │       kanban: typeof _view_kanban;
  │       wizard: typeof _view_wizard;
  │     }
  │
  │  4. Registry augmentation:
  │     declare module "questpie" {
  │       interface Registry { views: AppViews; }
  │     }
  │
  │  5. Runtime definition:
  │     export const app = createApp({
  │       views: { kanban: _view_kanban, wizard: _view_wizard },
  │       ...
  │     }, _runtime);
  │
  ▼
Result: type-safe, discoverable, mergeable
```

### 4.3 Core Plugin Categories

The core plugin declares fundamental questpie categories:

```ts
function corePlugin(): CodegenPlugin {
	return {
		name: "questpie-core",
		categories: {
			collections: {
				pattern: "collections/*.ts",
				featureLayout: true,
				mergeStrategy: "record",
				moduleContributionKey: "collections",
				runtimeKey: "collections",
				registryKey: "collections",
				typePrefix: "App",
			},
			globals: {
				pattern: "globals/*.ts",
				featureLayout: true,
				mergeStrategy: "record",
				moduleContributionKey: "globals",
				runtimeKey: "globals",
				registryKey: "globals",
				typePrefix: "App",
			},
			jobs: {
				pattern: "jobs/*.ts",
				mergeStrategy: "record",
				moduleContributionKey: "jobs",
				runtimeKey: "jobs",
				registryKey: "jobs",
				typePrefix: "App",
			},
			functions: {
				pattern: "functions/*.ts",
				recursive: true,
				featureLayout: true,
				mergeStrategy: "record",
				moduleContributionKey: "functions",
				runtimeKey: "functions",
				registryKey: "functions",
				typePrefix: "App",
			},
			routes: {
				pattern: "routes/*.ts",
				recursive: true,
				mergeStrategy: "record",
				moduleContributionKey: "routes",
				runtimeKey: "routes",
				registryKey: "routes",
				typePrefix: "App",
			},
			services: {
				pattern: "services/*.ts",
				mergeStrategy: "record",
				moduleContributionKey: "services",
				runtimeKey: "services",
				registryKey: "services",
				typePrefix: "App",
			},
			fields: {
				pattern: "fields/*.ts",
				featureLayout: true,
				mergeStrategy: "record",
				moduleContributionKey: "fields",
				runtimeKey: "fields",
				registryKey: "fields",
				typePrefix: "App",
			},
			messages: {
				pattern: "messages/*.ts",
				mergeStrategy: "record",
				moduleContributionKey: "messages",
				runtimeKey: "messages",
			},
			emails: {
				pattern: "emails/*.ts",
				mergeStrategy: "record",
				moduleContributionKey: "emails",
				runtimeKey: "emails",
				registryKey: "emails",
				typePrefix: "App",
			},
			migrations: {
				pattern: "migrations/*.ts",
				mergeStrategy: "array",
				moduleContributionKey: "migrations",
				runtimeKey: "migrations",
			},
			seeds: {
				pattern: "seeds/*.ts",
				mergeStrategy: "array",
				moduleContributionKey: "seeds",
				runtimeKey: "seeds",
			},
		},
		singletons: {
			locale: {
				configType: "LocaleConfig",
				imports: [{ from: "questpie", names: ["LocaleConfig"] }],
			},
			hooks: {
				configType: "GlobalHooks",
				imports: [{ from: "questpie", names: ["GlobalHooks"] }],
			},
			access: {
				configType: "DefaultAccess",
				imports: [{ from: "questpie", names: ["DefaultAccess"] }],
			},
			context: {
				configType: "ContextResolver",
				imports: [{ from: "questpie", names: ["ContextResolver"] }],
			},
		},
		moduleRegistries: {
			fields: { registryKey: "fields" },
		},
	};
}
```

### 4.4 Admin Plugin Categories

The admin plugin declares admin-specific categories:

```ts
function adminPlugin(): CodegenPlugin {
	return {
		name: "questpie-admin",
		categories: {
			views: {
				pattern: "views/*.ts",
				featureLayout: true,
				mergeStrategy: "record",
				moduleContributionKey: "views",
				runtimeKey: "views",
				registryKey: "views",
				typePrefix: "App",
			},
			components: {
				pattern: "components/*.ts",
				featureLayout: true,
				mergeStrategy: "record",
				moduleContributionKey: "components",
				runtimeKey: "components",
				registryKey: "components",
				typePrefix: "App",
			},
			blocks: {
				pattern: "blocks/*.ts",
				mergeStrategy: "record",
				moduleContributionKey: "blocks",
				runtimeKey: "blocks",
				registryKey: "blocks",
				typePrefix: "App",
			},
		},
		singletons: {
			sidebar: {
				configType: "SidebarContribution",
				isCallback: true,
				mergeStrategy: "spread",
			},
			dashboard: {
				configType: "DashboardContribution",
				isCallback: true,
				mergeStrategy: "spread",
			},
			branding: { configType: "BrandingConfig" },
			adminLocale: { configType: "AdminLocaleConfig" },
		},
		extensions: {
			collection: {
				admin: { stateKey: "admin", configType: "AdminConfig" },
				list: {
					stateKey: "adminList",
					configType: "...",
					isCallback: true,
					callbackContextParams: ["v", "f"],
				},
				form: {
					stateKey: "adminForm",
					configType: "...",
					isCallback: true,
					callbackContextParams: ["v", "f"],
				},
				preview: { stateKey: "preview", configType: "PreviewConfig" },
				actions: {
					stateKey: "actions",
					configType: "...",
					isCallback: true,
					callbackContextParams: ["a"],
				},
			},
			global: {
				admin: { stateKey: "admin", configType: "AdminConfig" },
				form: {
					stateKey: "adminForm",
					configType: "...",
					isCallback: true,
					callbackContextParams: ["v", "f"],
				},
			},
		},
		moduleRegistries: {
			listViews: { registryKey: "listViews" },
			editViews: { registryKey: "editViews" },
			components: { registryKey: "components" },
		},
	};
}
```

---

## 5. Builder Extensions

Extensions add methods to `CollectionBuilder` and `GlobalBuilder` via
`declare module` augmentation and Proxy-based runtime wrappers.

### 5.1 ExtensionDeclaration

```ts
interface ExtensionDeclaration {
	/** Key where the config is stored on builder state */
	stateKey: string;

	/** TypeScript type for the config parameter. May contain placeholders. */
	configType: string;

	/** Imports needed for the configType */
	imports?: Array<{ from: string; names: string[] }>;

	/** Whether the config is a callback receiving context */
	isCallback?: boolean;

	/**
	 * Context parameters passed to the callback.
	 * Each param creates a proxy:
	 *   "f" → field reference proxy (returns field name strings)
	 *   "v" → view proxy (returns { view: name, ...config })
	 *   "c" → component proxy (returns { type: name, props })
	 *   "a" → action proxy (returns action references)
	 *
	 * Plugins can define new context params — see §5.3.
	 */
	callbackContextParams?: string[];

	/**
	 * Placeholders in configType that should be replaced with
	 * generated type aliases from moduleRegistries.
	 *
	 * Example: { "$LIST_VIEW_NAMES": "listViews" }
	 * This replaces $LIST_VIEW_NAMES in the configType string
	 * with the aggregated union of listView names from all modules.
	 */
	configTypePlaceholders?: Record<string, string>;
}
```

### 5.2 Generated Output

For extension `list` on collection:

```ts
// .generated/factories.ts

declare module "questpie" {
	interface CollectionBuilder<TState> {
		list(
			config: (
				ctx: ListViewConfigContext<TState, _ListViewNames>,
			) => ListViewConfig,
		): this;
	}
}

// Runtime: Proxy intercepts .list() calls, resolves callback with
// context proxies, stores result via builder.set("adminList", resolved)
```

### 5.3 Custom Context Parameters

Plugins can contribute new callback context parameter types via the
`transform` hook:

```ts
// kanban plugin adds a "l" (lanes) context param
transform: (ctx) => {
	ctx.registerCallbackParam("l", {
		proxyFactory: "createLanesProxy",
		import: { from: "@questpie/kanban/server", name: "createLanesProxy" },
	});
};
```

---

## 6. Module Registries

Module registries aggregate type information from modules. For each
declared registry, codegen:

1. Extracts the property from all modules in the module tree
2. Collects all keys into a union type
3. Augments the `Registry` interface

### 6.1 ModuleRegistryDeclaration

```ts
interface ModuleRegistryDeclaration {
	/**
	 * Key in the Registry interface augmentation.
	 * If set, generates: Registry { [registryKey]: Record<_Names, unknown> }
	 */
	registryKey?: string;

	/**
	 * Placeholder token for use in extension configType strings.
	 * Example: "$LIST_VIEW_NAMES" — replaced with the generated union type.
	 */
	placeholder?: string;
}
```

### 6.2 How Module Registries Differ from Categories

| Aspect       | Category                                 | Module Registry                            |
| ------------ | ---------------------------------------- | ------------------------------------------ |
| **Source**   | Filesystem (discovery) + modules         | Modules only                               |
| **Purpose**  | Discover entities, merge, generate types | Extract type-level names for autocomplete  |
| **Output**   | Full aggregated type (AppCollections)    | Union type of keys ("table" \| "kanban")   |
| **Use case** | Collections, views, fields, blocks       | View names for `v` proxy, field type names |

Module registries complement categories. A category like `views` handles
the full discovery + merge + type generation. A module registry like
`listViews` extracts just the view **names** for use in extension
configType placeholders.

### 6.3 When Both Are Needed

For views, you need BOTH:

- **Category** `views`: discovers `views/*.ts`, merges with module
  `views`, generates `AppViews` type
- **Module registry** `listViews`: extracts list view names from modules
  for the `v` proxy type in `.list()` callback

The category handles the full entity lifecycle. The module registry
handles type-level autocomplete in builder extensions.

---

## 7. Singletons

Singletons are single-file factory functions for one-off configuration
values (sidebar, branding, locale).

### 7.1 SingletonDeclaration

```ts
interface SingletonDeclaration {
	/** TypeScript type for the config parameter */
	configType: string;

	/** Imports for the configType */
	imports?: Array<{ from: string; names: string[] }>;

	/** Whether the factory accepts a callback */
	isCallback?: boolean;

	/** Merge strategy for spread singletons (sidebar, dashboard) */
	mergeStrategy?: "spread";
}
```

### 7.2 Generated Output

```ts
// .generated/factories.ts
export function sidebar(
  config: (ctx: SidebarContext) => SidebarContribution
): SidebarContribution { ... }
```

---

## 8. Type Flow — End to End

### 8.1 View Example

```
SERVER DEFINITION              CODEGEN                      USER CODE
─────────────────              ───────                      ─────────

views/kanban.ts                .generated/index.ts          collections/tasks.ts
┌───────────────┐              ┌──────────────────┐         ┌──────────────────┐
│ view("kanban",│  discovery   │ import _kanban    │  types  │ .list(({ v }) => │
│   kind: "list"│ ──────────►  │                   │ ──────► │   v.kanban({     │
│   configSchema│              │ type AppViews =   │         │     groupBy:     │
│ )             │              │   _ModuleViews &  │         │       "status"   │
└───────────────┘              │   { kanban: ... } │         │   })             │
                               │                   │         │ )                │
adminModule                    │ Registry { views: │         └──────────────────┘
┌───────────────┐  module      │   AppViews }      │
│ views: {      │  extraction  │                   │
│   table: ...  │ ──────────►  │ _ListViewNames =  │
│   form: ...   │              │   "table"|"kanban" │
│ }             │              └──────────────────┘
└───────────────┘                      │
                                       ▼
                               .generated/factories.ts
                               ┌──────────────────────┐
                               │ v proxy typed with    │
                               │ "table" | "kanban"    │
                               │                       │
                               │ collection().list()   │
                               │ accepts v.kanban()    │
                               └──────────────────────┘
                                       │
                                       ▼
                               INTROSPECTION (runtime)
                               ┌──────────────────────┐
                               │ GET /api/admin-config │
                               │ → { tasks: {         │
                               │     list: {           │
                               │       view: "kanban", │
                               │       groupBy: ...    │
                               │ }}}                   │
                               └──────────────────────┘
                                       │
                                       ▼
                               CLIENT
                               ┌──────────────────────┐
                               │ qa.views({            │
                               │   kanban: view({      │
                               │     kind: "list",     │
                               │     component:        │
                               │       KanbanView,     │
                               │   })                  │
                               │ });                   │
                               │                       │
                               │ // props typed from   │
                               │ // server configSchema│
                               └──────────────────────┘
```

### 8.2 Field Example (after moving to starter module)

```
starterModule.fields           CODEGEN                      USER CODE
┌──────────────────┐           ┌──────────────────┐         ┌──────────────────┐
│ text: textField  │  module   │ type AppFields =  │  types  │ .fields(({ f })  │
│ number: numField │  extract  │   _ModuleFields & │ ──────► │   => ({          │
│ boolean: ...     │ ────────► │   { markdown: ... │         │   title: f.text()│
│ ...15 types      │           │   }               │         │   body:          │
└──────────────────┘           │                   │         │     f.markdown() │
                               │ Registry { fields:│         │ }))              │
adminModule.fields             │   AppFields }     │         └──────────────────┘
┌──────────────────┐  module   │                   │
│ richText: ...    │  extract  │ f proxy typed     │
│ blocks: ...      │ ────────► │ with AppFields    │
└──────────────────┘           └──────────────────┘

user fields/markdown.ts
┌──────────────────┐ discovery
│ field("markdown")│ ────────►
└──────────────────┘
```

### 8.3 Component Example

```
SERVER                         CODEGEN                      CLIENT
──────                         ───────                      ──────

components/rating.ts           .generated/index.ts
┌──────────────────┐           ┌──────────────────┐
│ component(       │ discovery │ type AppComponents│
│   "rating",      │ ────────► │   = _ModComps &   │
│   propsSchema:   │           │   { rating: ... } │
│     z.object({   │           │                   │
│       value:     │           │ c proxy typed     │
│         z.number │           │ with AppComponents│
│     })           │           └──────────────────┘
│ )                │                   │
└──────────────────┘                   ▼
                               SERVER USAGE
                               ┌──────────────────┐
                               │ c.rating({        │
                               │   value: 4,       │
                               │ })                │  ← type-safe
                               │ // → { type:      │
                               │ //   "rating",    │
                               │ //   props:       │
                               │ //   { value: 4 } │
                               │ // }              │
                               └──────────────────┘
                                       │
                                 introspection
                                       │
                                       ▼
                               CLIENT
                               ┌──────────────────────┐
                               │ qa.components({       │
                               │   rating: component({ │
                               │     component:        │
                               │       RatingComp,     │
                               │   })                  │
                               │ })                    │
                               │                       │
                               │ // RatingComp props:  │
                               │ // { value: number,   │
                               │ //   max: number }    │
                               │ // ↑ shared from      │
                               │ //   server schema    │
                               └──────────────────────┘
```

---

## 9. How to Write a Plugin — Step by Step

### Step 1: Identify what your plugin adds

Ask yourself:

- Does it introduce a new **entity type**? → Category
- Does it add **methods** to collection/global builders? → Extension
- Does it need **type-level name aggregation** from modules? → Module registry
- Does it introduce **single-file config values**? → Singleton

### Step 2: Define the plugin

```ts
// packages/my-plugin/src/server/plugin.ts
import type { CodegenPlugin } from "questpie";

export function myPlugin(): CodegenPlugin {
	return {
		name: "questpie-my-plugin",

		// New entity types
		categories: {
			workflows: {
				pattern: "workflows/*.ts",
				mergeStrategy: "record",
				moduleContributionKey: "workflows",
				runtimeKey: "workflows",
				registryKey: "workflows",
				typePrefix: "App",
			},
		},

		// New builder methods
		extensions: {
			collection: {
				workflow: {
					stateKey: "workflowConfig",
					configType: "WorkflowConfig",
					imports: [{ from: "@questpie/my-plugin", names: ["WorkflowConfig"] }],
				},
			},
		},

		// Module-level registries
		moduleRegistries: {
			workflows: { registryKey: "workflows" },
		},
	};
}
```

### Step 3: Create the server-side primitives

```ts
// packages/my-plugin/src/server/workflow.ts
import { z } from "zod";

export interface WorkflowDefinition<TName extends string = string> {
	type: "workflow";
	name: TName;
	states: readonly string[];
	transitions: Record<string, string[]>;
}

export function workflow<TName extends string>(
	name: TName,
	config: {
		states: readonly string[];
		transitions: Record<string, string[]>;
	},
): WorkflowDefinition<TName> {
	return { type: "workflow", name, ...config };
}
```

### Step 4: Create a module (optional)

If your plugin provides default values:

```ts
// packages/my-plugin/src/server/modules/workflow/.generated/module.ts
import { workflow } from "../../workflow";

const _module = {
	name: "questpie-workflow",
	workflows: {
		approval: workflow("approval", {
			states: ["draft", "review", "approved", "rejected"],
			transitions: { draft: ["review"], review: ["approved", "rejected"] },
		}),
	},
};

export type WorkflowModule = typeof _module;
export default _module;
```

### Step 5: User registers plugin + module

```ts
// questpie.config.ts
import { runtimeConfig } from "questpie";
import { adminPlugin } from "@questpie/admin/plugin";
import { myPlugin } from "@questpie/my-plugin";

export default runtimeConfig({
	plugins: [adminPlugin(), myPlugin()],
	db: { url: process.env.DATABASE_URL! },
});

// modules.ts
import { adminModule } from "@questpie/admin/server";
import { workflowModule } from "@questpie/my-plugin";

export default [adminModule, workflowModule] as const;
```

### Step 6: User creates entities via file convention

```ts
// workflows/content-review.ts
import { workflow } from "@questpie/my-plugin";

export default workflow("contentReview", {
	states: ["draft", "editing", "published"],
	transitions: { draft: ["editing"], editing: ["published", "draft"] },
});
```

### Step 7: Codegen produces types

```ts
// .generated/index.ts
import _wf_contentReview from "../workflows/content-review";

type _ModuleWorkflows = ExtractFromModuleArray<typeof _modules, "workflows">;

export interface AppWorkflows extends _ModuleWorkflows {
	contentReview: typeof _wf_contentReview;
}

declare module "questpie" {
	interface Registry {
		workflows: AppWorkflows;
	}
}
```

### Step 8: Create client-side module (if UI needed)

```ts
// packages/my-plugin/src/client/index.ts
export function workflowClientModule(qa: AdminBuilder) {
	return qa.views({
		workflow: listView("workflow", {
			kind: "list",
			component: WorkflowBoardView,
		}),
	});
}
```

---

## 10. Plugin Resolution Order

When multiple plugins are registered:

```ts
plugins: [adminPlugin(), kanbanPlugin(), analyticsPlugin()];
```

Resolution:

1. `corePlugin()` is **always prepended** automatically
2. Plugins are processed in declaration order
3. Categories from later plugins extend (never override) earlier ones
4. If two plugins declare the same category key, later one wins
   (this is an error in practice — category keys should be unique)
5. Extensions, singletons, and module registries are merged additively

---

## 11. View Definition — Unified `view()` Factory

Views use a single `view()` factory with a `kind` discriminant:

```ts
import { view } from "@questpie/admin/server";

// List view
export default view("kanban", {
	kind: "list",
	configSchema: z.object({
		groupBy: z.string(),
		columnField: z.string().optional(),
	}),
});

// Edit view
export default view("wizard", {
	kind: "edit",
	configSchema: z.object({
		steps: z.array(
			z.object({
				title: z.string(),
				fields: z.array(z.string()),
			}),
		),
	}),
});
```

### 11.1 `kind` Is Plugin-Extensible

The `kind` field is **not** a hardcoded union. It is declared by plugins
and extended via the standard `declare module` augmentation pattern:

```ts
// The admin plugin declares the base view kinds:
declare module "questpie" {
	interface ViewKindRegistry {
		list: { configContext: ListViewConfigContext };
		edit: { configContext: FormViewConfigContext };
	}
}

// A third-party plugin can extend with new kinds:
declare module "questpie" {
	interface ViewKindRegistry {
		dashboard: { configContext: DashboardViewConfigContext };
	}
}
```

The `ViewKindRegistry` interface is an **open augmentation point**.
Each key becomes a valid `kind` value. The associated config determines
what the `v` proxy returns for views of that kind.

The resolved `kind` union is:

```ts
type ViewKind = keyof ViewKindRegistry;
// → "list" | "edit"                       (with admin plugin only)
// → "list" | "edit" | "dashboard"         (with dashboard plugin)
```

Codegen uses `kind` to:

1. **Route views into the correct registry.** Views with `kind: "list"`
   go into `listViews`, views with `kind: "edit"` go into `editViews`.
   The mapping from kind → registry key is declared by the plugin that
   introduces that kind.
2. **Type the correct `v` proxy.** `.list()` callback gets a `v` proxy
   typed with only list-kind views. `.form()` gets only edit-kind views.

### 11.2 How Plugins Declare New Kinds

A plugin that introduces a new view kind declares:

```ts
// analytics plugin
export function analyticsPlugin(): CodegenPlugin {
	return {
		name: "questpie-analytics",
		// Register the new kind → which module registry it maps to
		viewKinds: {
			dashboard: { registryKey: "dashboardViews" },
		},
		// The module registry that collects dashboard view names
		moduleRegistries: {
			dashboardViews: { registryKey: "dashboardViews" },
		},
		// Builder extension that uses the new kind
		extensions: {
			collection: {
				dashboard: {
					stateKey: "dashboardConfig",
					configType:
						"(ctx: DashboardConfigContext<TState, $DASHBOARD_VIEW_NAMES>) => DashboardConfig",
					isCallback: true,
					callbackContextParams: ["v"],
				},
			},
		},
	};
}
```

User code then:

```ts
// views/revenue-chart.ts
import { view } from "@questpie/analytics/server";

export default view("revenueChart", {
	kind: "dashboard",
	configSchema: z.object({ period: z.enum(["day", "week", "month"]) }),
});

// collections/orders.ts
collection("orders").dashboard(({ v }) => v.revenueChart({ period: "week" }));
```

### 11.3 Principle: All Discriminant Types Are Plugin-Extensible

This pattern applies everywhere — not just view `kind`. Any time we
define a discriminant union (component types, field types, action types,
etc.), the valid values are declared by plugins via interface augmentation.
The framework provides the empty interface. Plugins populate it.

```ts
// Framework provides the shell:
interface ViewKindRegistry {}
interface FieldTypeRegistry {}
interface ComponentTypeRegistry {}

// Plugins fill it in:
// → admin plugin adds "list" and "edit" to ViewKindRegistry
// → core plugin adds "text", "number", etc. to FieldTypeRegistry
// → admin plugin adds "icon", "badge" to ComponentTypeRegistry
// → user/third-party extends any of these
```

---

## 12. Component Definition

Components define server-side references with typed props:

```ts
import { component } from "@questpie/admin/server";

export default component("rating", {
	propsSchema: z.object({
		value: z.number(),
		max: z.number().default(5),
		color: z.string().optional(),
	}),
});
```

Server code uses `c.rating({ value: 4 })` which produces a
`ComponentReference<"rating", { value: number; max?: number }>`.
The client resolves this reference to a React component, with
props typed from the same schema.

---

## 13. What the Framework Core Provides

After this RFC, the framework core (`packages/questpie`) provides:

| Primitive                  | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `field<TConfig, TValue>()` | Factory for defining custom field types       |
| `collection(name)`         | Collection builder                            |
| `global(name)`             | Global builder                                |
| `fn({ handler })`          | Function definition                           |
| `route({ handler })`       | Raw HTTP route definition                     |
| `job({ handler })`         | Background job definition                     |
| `runtimeConfig({})`        | Runtime config identity function              |
| `createApp(def, runtime)`  | Internal — creates Questpie instance          |
| `CodegenPlugin`            | Interface for plugin declarations             |
| `corePlugin()`             | Built-in plugin for core categories           |
| Codegen engine             | Discovery, template generation, type emission |

The framework does **NOT** provide:

- ~~`builtinFields`~~ → moved to starter module
- ~~`adminCodegenPlugin`~~ → moved to `@questpie/admin`
- ~~`CORE_CATEGORIES`~~ → replaced by `corePlugin().categories`
- ~~`EXTENSION_KEYS`~~ → removed, all categories are plugin-declared

---

## 14. Open Questions

1. **Component propsSchema serialization** — How exactly does the
   configSchema/propsSchema get serialized for the client? Zod v4
   `.toJSONSchema()` or custom introspection?

2. **Field configSchema** — Should field definitions also carry a
   configSchema for admin UI (field settings panel)?

3. **Plugin dependencies** — Should plugins be able to declare
   dependencies on other plugins? (e.g., kanbanPlugin requires
   adminPlugin)
