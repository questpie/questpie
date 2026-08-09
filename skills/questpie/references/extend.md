---
name: questpie-core/extend
description:
  QUESTPIE extensibility, codegen plugins CodegenPlugin CategoryDeclaration CallbackParamDefinition ScaffoldConfig scaffolds, building modules, custom field types field()/fieldType()/from() factory columnFactory schemaFactory operatorSet metadataFactory, custom adapters createFetchHandler Elysia Hono Next.js TanStack Start, type registries FieldTypeRegistry ComponentTypeRegistry ViewKindRegistry declare module augmentation, package distribution tsdown npm publishing changesets
  - questpie-core
---

## Overview

This skill covers extending QUESTPIE: building codegen plugins, reusable modules, custom field types, framework adapters, type registries, and package distribution.

## Contents

- [Building a Codegen Plugin](#building-a-codegen-plugin)
- [Building a Module](#building-a-module)
- [Custom Field Types](#custom-field-types)
- [Custom Adapters](#custom-adapters)
- [Type Registries](#type-registries)
- [Package Distribution](#package-distribution)
- [Common Mistakes](#common-mistakes)
- [References](#references)

## Building a Codegen Plugin

A plugin tells codegen what to discover and what types to generate. Plugins contribute to one or more codegen **targets** (e.g., `"server"`, `"admin-client"`).

### Plugin Structure

```ts
import type { CodegenPlugin } from "questpie/codegen";

export function myPlugin(): CodegenPlugin {
	return {
		name: "my-plugin",

		targets: {
			// Contribute to the server target
			server: {
				root: ".",
				outputFile: "index.ts",

				// Directory-pattern categories to discover
				categories: {
					widgets: {
						dirs: ["widgets"],
						prefix: "widget",
						emit: "record",
						registryKey: "widgets",
						includeInAppState: true,
					},
				},

				// Single-file / glob discover patterns
				discover: {
					widgetConfig: { pattern: "widget-config.ts", cardinality: "single" },
				},

				// Extension methods for collection()/global() factories
				registries: {
					collectionExtensions: {
						widget: {
							stateKey: "~widget",
							configType: "WidgetConfig",
							imports: [{ name: "WidgetConfig", from: "my-plugin-package" }],
						},
					},
					singletonFactories: {
						widgetConfig: {
							configType: "WidgetConfig",
							imports: [{ name: "WidgetConfig", from: "my-plugin-package" }],
						},
					},
				},

				// Callback param definitions for extension methods
				callbackParams: {
					w: {
						factory: "createWidgetNameProxy",
						from: "my-plugin-package",
					},
				},

				// Scaffold templates for `questpie add <type> <name>`
				scaffolds: {
					widget: {
						dir: "widgets",
						extension: ".ts",
						description: "A dashboard widget",
						template: ({ kebab, pascal }) =>
							`import { widget } from "#questpie/factories";\n\nexport default widget("${kebab}"); // ${pascal}\n`,
					},
				},
			},
		},
	};
}
```

`scaffolds` is a `Record<string, ScaffoldConfig>` keyed by scaffold-type name. `questpie add widget my-thing` runs the matching `template(ctx)` (ctx: `kebab`/`camel`/`pascal`/`title`/`targetId`) and writes the file under `dir` in every target that declares that scaffold name.

### Register in Config

```ts title="questpie.config.ts"
import { runtimeConfig } from "questpie/app";
import { myPlugin } from "my-plugin-package";

export default runtimeConfig({
	plugins: [myPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
});
```

Use direct `runtimeConfig({ plugins })` registration only for standalone codegen plugins or custom setups that do not ship a module. Reusable packages should usually attach the plugin to a static module and let codegen extract it from `modules.ts`.

A published module package that ships its own convention dirs declares package-level config with `packageConfig()` (from `questpie/cli`) instead of `runtimeConfig()`; codegen reads it when scanning the package.

### Configurable Codegen-Aware Modules

When a package ships a module and a `CodegenPlugin`, keep module identity static and put runtime options in a plugin-discovered config file. Codegen imports `modules.ts` before runtime app creation, so it must be able to see the same module/plugin tree regardless of environment or runtime options.

#### DO THIS

```ts title="modules.ts"
import { observabilityModule } from "@questpie/observability/server";

export default [observabilityModule] as const;
```

```ts title="config/observability.ts"
import { observabilityConfig } from "@questpie/observability/server";

export default observabilityConfig({
	serviceName: "barbershop",
	enabled: process.env.NODE_ENV === "production",
	otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

```ts title="@questpie/observability/server.ts"
export const observabilityModule = module({
	name: "questpie-observability",
	plugin: observabilityPlugin(),
	services: {
		observability: service({
			namespace: null,
			lifecycle: "singleton",
			create: ({ app, logger }) =>
				createObservabilityService(app.state.config?.observability, logger),
		}),
	},
});
```

The plugin contributes `config/observability.ts` as a discover pattern and a typed singleton factory such as `observabilityConfig()`. The service reads the resolved config at runtime from `app.state.config.observability`.

#### DON'T DO THIS

Do not make runtime options the main API for modules that contribute codegen plugins:

```ts title="modules.ts"
export default [
	observabilityModule({
		serviceName: "barbershop",
		enabled: process.env.NODE_ENV === "production",
	}),
] as const;
```

Do not conditionally include codegen-aware modules or plugins:

```ts title="modules.ts"
export default [
	process.env.OTEL_ENABLED ? observabilityModule : undefined,
].filter(Boolean);
```

Factory modules are acceptable only for simple runtime-only modules whose plugin identity and generated contributions do not change. If the package contributes discover patterns, generated factories, module categories, views, components, fields, or collection/global extensions, use **static module + `config/*.ts` singleton factory**.

### Plugin Lifecycle

1. **Discovery** -- codegen scans for files matching category patterns and discover patterns
2. **Import** -- files are imported and exports are read
3. **Transform** -- `transform(ctx)` callbacks can modify the codegen context
4. **Generation** -- types and runtime code are emitted
5. **Validation** -- cross-target validators check projection consistency

### Real-World Example: Admin Plugin

The admin module contributes a codegen plugin to both `"server"` and `"admin-client"` targets -- declaring categories (`blocks`, `views`, `components`, field types), discovering `config/admin.ts`, adding collection/global/field extensions, and defining callback context params such as `v`, `f`, `c`, and `a`.

## Building a Module

A module is a reusable package that contributes entities to any QUESTPIE project.

A reusable module imports `collection`/`global` from `questpie/builders`, **not** `#questpie/factories`: `#questpie/factories` resolves to the consumer's generated codegen, which does not exist inside your package, `questpie/builders` is the codegen-independent factory that ships with the framework.

```ts
import { module } from "questpie/app";
import { collection } from "questpie/builders";
import { job } from "questpie/services";
import { z } from "zod";

const notificationsCollection = collection("notifications")
	.fields(({ f }) => ({
		title: f.text().required(),
		body: f.textarea(),
		read: f.boolean().default(false),
		userId: f.relation("user").required(),
	}))
	.admin(({ c }) => ({
		label: { en: "Notifications" },
		icon: c.icon("ph:bell"),
	}));

const sendPushNotification = job({
	name: "sendPushNotification",
	schema: z.object({
		userId: z.string(),
		title: z.string(),
		body: z.string(),
	}),
	handler: async ({ payload }) => {
		// Send push notification logic
	},
});

export const notificationsModule = module({
	name: "notifications",
	collections: { notifications: notificationsCollection },
	jobs: { sendPushNotification },
	sidebar: {
		items: [
			{
				sectionId: "operations",
				type: "collection",
				collection: "notifications",
			},
		],
	},
	messages: {
		en: {
			"notifications.title": "Notifications",
			"notifications.markRead": "Mark as read",
		},
	},
});
```

### Module Options

| Property      | Type          | Description              |
| ------------- | ------------- | ------------------------ |
| `name`        | `string`      | Module identifier        |
| `modules`     | `Module[]`    | Module dependencies      |
| `collections` | `Record`      | Collection contributions |
| `globals`     | `Record`      | Global contributions     |
| `jobs`        | `Record`      | Job contributions        |
| `functions`   | `Record`      | Function contributions   |
| `services`    | `Record`      | Service contributions    |
| `routes`      | `Record`      | Route contributions      |
| `fields`      | `Record`      | Custom field types       |
| `sidebar`     | `object`      | Sidebar items            |
| `dashboard`   | `object`      | Dashboard widgets        |
| `migrations`  | `Migration[]` | Database migrations      |
| `seeds`       | `Seed[]`      | Seed data                |
| `messages`    | `Record`      | i18n translations        |

### How Module Contributions Merge

When several modules (and the app) contribute the same key, `createApp()` merges them deterministically, later modules win per entry:

| Key                                                              | Strategy                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `collections`, `globals`, `jobs`, `routes`, `fields`, `services` | record spread-merge, same key: later wins                                               |
| `messages`                                                       | deep-merge by locale, same message key: later wins                                      |
| `migrations`, `seeds`                                            | array concatenation                                                                     |
| `config.*` (app, auth, admin, plugin config keys)                | per-key strategies; `auth`/`admin` deep-merge; unknown keys: incoming replaces existing |
| anything else                                                    | auto-detect: object+object → spread, array+array → concat, otherwise incoming wins      |

The merge helpers behind these strategies are exported from `questpie/app` for module authors combining config fragments of their own:

```ts
import {
	lastWins,
	mergeConcat,
	mergeDeepConcat,
	mergeRecord,
	type MergeFn,
} from "questpie/app";

mergeRecord(a, b); // { ...a, ...b }
mergeConcat(a, b); // [...a, ...b]
mergeDeepConcat(a, b); // spread objects, concat array-valued props
lastWins(a, b); // b
```

Use them (instead of hand-rolled spreads) when a module exposes its own "combine these contributions" surface, the semantics then match what the framework does for built-in keys.

### Using a Module

```ts title="modules.ts"
import { adminModule } from "@questpie/admin/modules/admin";
import { notificationsModule } from "my-notifications-package";

export default [adminModule, notificationsModule] as const;
```

## Custom Field Types

Custom fields are registered through modules and become available on the `f` builder after codegen.

### Field Definition

A custom field type is a **factory function** that returns a `Field`. Each module `fields` entry becomes a method on the `f` builder proxy after codegen. The easiest way to author one is the `from()` escape hatch, which wraps the internal `field()` factory and supplies the column, Zod schema, and default `eq`/`ne` operators:

```ts
// color.ts, a custom "color" field stored as a hex string
import { from } from "questpie/builders";
import { varchar } from "questpie/drizzle-pg-core";
import { z } from "zod";

export const color = (defaultValue = "#000000") =>
	from(
		varchar("", { length: 7 }), // column builder (name is filled in by codegen)
		z.string().regex(/^#[0-9a-fA-F]{6}$/), // validation schema
	).default(defaultValue);
```

For full control over storage, validation, operators, and introspection metadata, `field()` accepts a `FieldRuntimeState` directly (`{ type, columnFactory, schemaFactory, operatorSet, metadataFactory, ... }`) and `fieldType(name, { create, methods })` adds type-specific chain methods, this is exactly how the built-in `text`/`select` factories are defined in `questpie`'s own source.

### Registration

Register the factory on a module under `fields`:

```ts
import { module } from "questpie/app";
import { color } from "./color.js";

const myModule = module({
	name: "custom-fields",
	fields: { color },
});
```

Once registered and codegen runs, the field is available on `f`:

```ts
.fields(({ f }) => ({
  brandColor: f.color().required(),
}))
```

### Admin Renderer

The admin renderer is a declarative `field()` definition (not a bare component): default-export `field("<typeName>", { component, cell? })` from `src/questpie/admin/fields/<name>.tsx`, where the name matches the server field type. Codegen discovers it; never edit `.generated/`.

```tsx title="src/questpie/admin/fields/color.tsx"
import { field, type FieldComponentProps } from "@questpie/admin/client";

function ColorField({ value, onChange }: FieldComponentProps<string>) {
	return (
		<input
			type="color"
			value={value ?? "#000000"}
			onChange={(e) => onChange?.(e.target.value)}
		/>
	);
}

export default field("color", { component: ColorField });
```

Full prop contract, cells, and custom views/widgets/pages: the `questpie-admin` skill's `references/custom-ui.md` and `references/recipes.md`.

## Custom Adapters

QUESTPIE ships with adapters for Hono, Elysia, and Next.js. For other frameworks, use `createFetchHandler` directly.

### Generic Fetch Handler

```ts
import { createFetchHandler } from "questpie/http";
import { app } from "#questpie";

const handler = createFetchHandler(app, { basePath: "/api" });
// Use with any framework supporting standard Request/Response
const response = await handler(request);
```

### Framework Adapters

**Elysia:**

```ts
import { Elysia } from "elysia";
import { questpieElysia } from "@questpie/elysia/server";
import { app } from "#questpie";

const server = new Elysia()
	.use(questpieElysia(app, { basePath: "/api" }))
	.listen(3000);
```

**Hono:**

```ts
import { Hono } from "hono";
import { questpieHono } from "@questpie/hono/server";
import { app } from "#questpie";

const server = new Hono().route("/", questpieHono(app, { basePath: "/api" }));
export default server;
```

`questpieMiddleware(app)` remains a QUESTPIE 3.x compatibility helper for
existing native Hono routes that consume `appContext`. New integrations should
mount `questpieHono` directly; the compatibility helper is scheduled for
removal in QUESTPIE 4.0.

**Next.js (App Router):**

```ts title="app/api/[...slug]/route.ts"
import { questpieNextRouteHandlers } from "@questpie/next";
import { app } from "#questpie";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } =
	questpieNextRouteHandlers(app, {
		basePath: "/api",
	});
```

**TanStack Start (no adapter needed):**

```ts title="src/routes/api/$.ts"
import { createFileRoute } from "@tanstack/react-router";
import { createFetchHandler } from "questpie/http";
import { app } from "#questpie";

const handler = createFetchHandler(app, { basePath: "/api" });

// createFetchHandler returns Response | null, fall back to 404.
const handleCmsRequest = async (request: Request) => {
	const response = await handler(request);
	return response ?? new Response("Not found", { status: 404 });
};

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: ({ request }) => handleCmsRequest(request),
			POST: ({ request }) => handleCmsRequest(request),
			PUT: ({ request }) => handleCmsRequest(request),
			DELETE: ({ request }) => handleCmsRequest(request),
			PATCH: ({ request }) => handleCmsRequest(request),
		},
	},
});
```

## Type Registries

Three augmentation interfaces allow plugins to extend discriminant types:

| Interface               | Package                  | Purpose                                          | Fallback      |
| ----------------------- | ------------------------ | ------------------------------------------------ | ------------- |
| `FieldTypeRegistry`     | `questpie`               | Field type names (`"text"`, `"number"`, etc.)    | `string`      |
| `ComponentTypeRegistry` | `@questpie/admin/server` | Component type names (`"icon"`, `"badge"`, etc.) | `string`      |
| `ViewKindRegistry`      | `@questpie/admin/server` | View kind names (`"list"`, `"edit"`)             | literal union |

### How Registries Work

```text
Server: f.text().required()
  -> Generated: { type: "text", options: {...} }
  -> Admin Client: fieldRegistry.get("text")
  -> React: <TextFieldRenderer value={...} onChange={...} />
```

### Extending Registries

Place files in admin directory -- codegen discovers them automatically:

```text
questpie/admin/
  fields/
    color.tsx        # Custom color field renderer
    currency.tsx     # Custom currency field renderer
  views/
    kanban.tsx       # Custom kanban list view
```

### Module Augmentation Pattern

Codegen generates `declare module` augmentations:

```ts
declare global {
	namespace Questpie {
		interface FieldTypeRegistry {
			color: {};
			currency: {};
		}
	}
}
```

The companion type alias uses the `[keyof Registry] extends [never] ? string : keyof Registry` pattern to fall back to `string` when the registry is empty.

## Package Distribution

### Package Structure

```text
packages/my-package/
  src/
    exports/           # Public API entry points
      index.ts         # Main entry (.)
      client.ts        # Client entry (./client)
      server.ts        # Server entry (./server)
  dist/                # Build output (gitignored)
  tsdown.config.ts
  package.json
```

### Dual Exports Strategy

```json title="package.json"
{
	"type": "module",
	"exports": {
		".": {
			"types": "./dist/index.d.mts",
			"default": "./src/exports/index.ts"
		}
	},
	"publishConfig": {
		"exports": {
			".": {
				"types": "./dist/index.d.mts",
				"default": "./dist/index.mjs"
			}
		}
	},
	"files": ["dist"]
}
```

During development: `exports.default` points to `.ts` source (no build step needed). When published: `publishConfig.exports` overrides with compiled `.mjs` + `.d.mts`.

### Build with tsdown

```ts title="tsdown.config.ts"
import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/exports/*.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: { sourcemap: false },
	unbundle: true,
});
```

### Publishing a Module

```json title="package.json"
{
	"name": "questpie-notifications",
	"main": "dist/index.js",
	"types": "dist/index.d.ts",
	"peerDependencies": {
		"questpie": "^3.0.0"
	}
}
```

### Versioning with Changesets

Core packages use lock-step versioning. Run `bun changeset` to create, `bun run version` to apply, `bun run release` to publish.

## Common Mistakes

### HIGH: Adding `& Record<string, unknown>` to Registry augmentation

This erases named keys via index signature intersection. The resulting type becomes `string` instead of a union of literal keys.

```ts
// WRONG -- erases literal types
declare global {
	namespace Questpie {
		interface FieldTypeRegistry extends Record<string, unknown> {
			color: {};
		}
	}
}

// CORRECT -- only named keys
declare global {
	namespace Questpie {
		interface FieldTypeRegistry {
			color: {};
		}
	}
}
```

### HIGH: Stale `.js`/`.d.ts` artifacts in src/

tsdown prefers `.js` over `.ts` when both exist. Delete stale artifacts before building:

```bash
# Remove tsc incremental artifacts that may shadow .ts files
find src -name '*.d.ts' -o -name '*.js' | xargs rm -f
```

### MEDIUM: Not including `"skills"` in package.json files array

Skills must ship with the npm package. Add the directory to `files`:

```json
{
	"files": ["dist", "skills"]
}
```

### MEDIUM: Complex conditional mapped types collapsing to `{}` in tsdown `.d.ts` emit

Ensure source types have literal generic parameters. If a type like `FilterViewsByKind<TKind>` collapses to `{}` in declaration output, provide explicit `as ViewDefinition<"name", "kind", Config>` casts.

### MEDIUM: Missing `extractFromModules` for new categories

If a plugin declares a new category but does not set `extractFromModules: true`, module-contributed entities of that category will not appear in the generated `App*` type.

## References

| Need to...                       | Read                               |
| -------------------------------- | ---------------------------------- |
| See full CodegenPlugin API       | `references/codegen-plugin-api.md` |
| Define collections and fields    | `questpie-core/data-modeling`      |
| Set up access, hooks, validation | `questpie-core/rules`              |
| Add functions, jobs, routes      | `questpie-core/business-logic`     |
