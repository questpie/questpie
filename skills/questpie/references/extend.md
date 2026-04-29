---
name: questpie-core/extend
description: QUESTPIE extensibility — codegen plugins CodegenPlugin CategoryDeclaration CallbackParamDefinition, building modules, custom field types field() factory toColumn toZodSchema getOperators getMetadata, custom adapters createFetchHandler Elysia Hono Next.js TanStack Start, type registries FieldTypeRegistry ComponentTypeRegistry ViewKindRegistry declare module augmentation, package distribution tsdown npm publishing changesets
  - questpie-core
---

## Overview

This skill covers extending QUESTPIE: building codegen plugins, reusable modules, custom field types, framework adapters, type registries, and package distribution.

## Building a Codegen Plugin

A plugin tells codegen what to discover and what types to generate. Plugins contribute to one or more codegen **targets** (e.g., `"server"`, `"admin-client"`).

### Plugin Structure

```ts
import type { CodegenPlugin } from "questpie";

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
			},
		},
	};
}
```

### Register in Config

```ts title="questpie.config.ts"
import { runtimeConfig } from "questpie";
import { myPlugin } from "my-plugin-package";

export default runtimeConfig({
	plugins: [myPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
});
```

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

```ts
import { module, collection, job } from "questpie";
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

### Using a Module

```ts title="modules.ts"
import { adminModule } from "@questpie/admin/server";
import { notificationsModule } from "my-notifications-package";

export default [adminModule, notificationsModule] as const;
```

## Custom Field Types

Custom fields are registered through modules and become available on the `f` builder after codegen.

### Registration

```ts
const myModule = module({
	name: "custom-fields",
	fields: {
		color: colorField,
		currency: currencyField,
	},
});
```

Once registered and codegen runs:

```ts
.fields(({ f }) => ({
  brandColor: f.color().default("#000000"),
  price: f.currency({ currency: "USD" }),
}))
```

### Field Definition

A custom field defines:

- **Storage type** -- how the value is stored in the database (via `toColumn`)
- **Validation** -- Zod schema for the value (via `toZodSchema`)
- **Operators** -- query operators (via `getOperators`)
- **Metadata** -- introspection metadata (via `getMetadata`)

The `Field` class is an immutable builder:

```ts
import { Field } from "questpie";

// Each method returns a new Field with updated type state
f.text(255).required().label({ en: "Name" }).admin({ placeholder: "..." });
```

### Admin Renderer

Register a React component to render the field in the admin panel:

```tsx
function ColorFieldRenderer({ value, onChange }) {
	return (
		<input
			type="color"
			value={value || "#000000"}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}
```

Place it in `questpie/admin/fields/color.tsx` -- codegen discovers it automatically.

## Custom Adapters

QUESTPIE ships with adapters for Hono, Elysia, and Next.js. For other frameworks, use `createFetchHandler` directly.

### Generic Fetch Handler

```ts
import { createFetchHandler } from "questpie";
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

const server = new Hono().route("/api", questpieHono(app));
export default server;
```

**Next.js (App Router):**

```ts title="app/api/[...slug]/route.ts"
import { questpieNextRouteHandlers } from "@questpie/next";
import { app } from "#questpie";

export const { GET, POST, PATCH, DELETE } = questpieNextRouteHandlers(app, {
	basePath: "/api",
});
```

**TanStack Start (no adapter needed):**

```ts title="src/routes/api/$.ts"
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { createFetchHandler } from "questpie";
import { app } from "#questpie";

const handler = createFetchHandler(app, { basePath: "/api" });
export const Route = createAPIFileRoute("/api/$")({
	GET: ({ request }) => handler(request),
	POST: ({ request }) => handler(request),
	PATCH: ({ request }) => handler(request),
	DELETE: ({ request }) => handler(request),
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
		"questpie": "^2.0.0"
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
