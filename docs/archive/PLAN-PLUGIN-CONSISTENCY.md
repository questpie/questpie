# Final Plan: Plugin-Defined Multi-Target Codegen

> Status: Final implementation plan
> Date: 2026-02-28
> Supersedes: previous draft content in this file
> Companion: RFC-PLUGIN-SYSTEM.md

---

## 1) Why We Are Doing This

QUESTPIE currently has an asymmetry:

- Server is file-convention + discovery + generated output.
- Admin client still relies on manual builder wiring (`qa().use(adminModule)`).

This creates three practical issues:

1. **Two mental models for one product**
   - Server: declarative file convention.
   - Admin client: imperative builder composition.
   - Teams need to learn and maintain both.

2. **No strong compile-time projection guarantees between server and admin client**
   - Server can emit references to views/components/blocks.
   - Client registration can drift.
   - Mismatches are often discovered too late.

3. **Unnecessary bootstrap complexity and JS footprint overhead**
   - Manual registry assembly is noisy.
   - Lazy loading opportunities are harder to enforce globally.

The target architecture is:

- `questpie/server` and `questpie/admin` both use file convention + discovery.
- Codegen produces both generated outputs.
- Plugins can declare additional targets (not only categories).
- Admin client consumes generated config directly.

---

## 2) Hard Decisions (Locked)

This plan intentionally includes a **mental shift** and **breaking changes**.

1. **This is an explicit breaking change initiative.**
   - Release is treated as breaking at API and setup level.
   - Legacy and dead code are removed, not preserved.

2. **No backward compatibility for the old admin client builder entry path.**
   - `qa()` is removed from public setup flow.
   - No compatibility adapter, no fallback shim, no dual-path bootstrap.

3. **Targets are plugin-defined.**
   - Any package can add a new codegen target via plugin declaration.
   - Core orchestrates targets, not hardcoded package-specific logic.

4. **Projection mismatch is a hard error.**
   - If server contracts reference client registries that do not exist, codegen fails.

5. **Canonical admin client location is `questpie/admin`.**
   - No fallback convention in v1 of this rewrite.

6. **Admin runtime structure stays conceptually the same.**
   - We do not redesign admin layout/router architecture.
   - The change is bootstrap/input level: generated admin client object replaces `qa()` builder wiring.

---

## 3) End State Overview

### 3.1 Directory model

- `questpie/server/*` defines data contracts and server behavior.
- `questpie/admin/*` defines rendering artifacts for admin UI.

### 3.2 Generated outputs

- `questpie/server/.generated/index.ts` (existing server artifact)
- `questpie/server/.generated/factories.ts` (existing typed factories)
- `questpie/admin/.generated/client.ts` (new admin client artifact)

### 3.3 Runtime usage

- Routes import generated admin config directly.
- `AdminProvider` accepts generated admin config object.
- No `qa().use(...)` bootstrap in application setup.

---

## 4) New Plugin Contract (Breaking)

`CodegenPlugin` moves to a target-first model.

```ts
export interface CodegenPlugin {
	name: string;
	targets: Record<string, CodegenTargetContribution>;
}

export interface CodegenTargetContribution {
	root: string; // relative to resolved server root, ex: "." or "../admin"
	outDir?: string; // default ".generated"
	outputFile: string; // ex: "index.ts", "client.ts"

	categories?: Record<string, CategoryDeclaration>;
	discover?: Record<string, DiscoverPattern>;

	registries?: {
		collectionExtensions?: Record<string, RegistryExtension>;
		globalExtensions?: Record<string, RegistryExtension>;
		singletonFactories?: Record<string, SingletonFactory>;
		moduleRegistries?: Record<string, ModuleRegistryConfig>;
	};

	transform?: (ctx: CodegenContext) => void;

	// Optional custom generator for target-specific templates
	generate?: (
		ctx: CodegenTargetGenerateContext,
	) => Promise<CodegenTargetOutput> | CodegenTargetOutput;
}
```

Target merge rules:

- Multiple plugins may contribute discovery/categories to the same target.
- Only one generator function per target is allowed.
- `root`, `outDir`, `outputFile` must be consistent per target id.
- Any conflict is a codegen error.

---

## 5) Codegen Orchestration Model

`runCodegen` becomes multi-target orchestration:

1. Resolve all plugins from runtime config.
2. Build merged target graph.
3. For each target:
   - run discovery in target root
   - run target transforms
   - run target generator (plugin custom or default)
   - write output
4. Run cross-target validators (projection compatibility checks).
5. Return aggregated result (`outputs[]`, `errors[]`, `targetSummaries[]`).

CLI `generate` and `dev` use the same target graph.

---

## 6) Admin Plugin Target Design

`adminPlugin()` declares two targets:

### 6.1 `server` target

- Root: `.` (server root)
- Output: existing server generated files
- Purpose: keep current admin server discover/registry extensions.

### 6.2 `admin-client` target

- Root: `../admin`
- Output: `.generated/client.ts`
- Discovers admin client registry files.

Expected categories/discover keys (initial):

- `views`
- `components`
- `fields`
- `pages`
- `widgets`
- `blocks`
- optional singles if needed for client-level metadata later

---

## 7) Admin Client Generated Artifact

`questpie/admin/.generated/client.ts` exports a plain admin config object.

Minimum shape (updated by Phase G — flat `views`, no `listViews`/`editViews`/`defaultViews`):

```ts
export type GeneratedAdminClient = {
	views: Record<string, ViewDefinition>;
	fields: Record<string, FieldRegistryEntry>;
	components: Record<string, ComponentDefinition>;
	pages: Record<string, PageDefinition>;
	widgets: Record<string, WidgetDefinition>;
	blocks: Record<string, BlockDefinition>;
	locale: { default: string; supported: string[] };
	translations: Record<string, unknown>;
};
```

Each `ViewDefinition` carries a `kind` discriminant (`"list" | "form"` from `ViewKindRegistry`)
that matches the server-side `ViewDefinition.kind`. Entity context (collection vs global) is
determined by view naming convention (`collection-*` / `global-*`). Default view names are
declared in extension definitions, not hardcoded in router.

Generation behavior:

- Start with built-in admin defaults (from `@questpie/admin/client/defaults`).
- Merge discovered user admin files.
- User definitions override defaults by key.
- Prefer lazy-capable loader forms for views/pages/widgets.
- Views are merged flat — no `filterViews()` splitting by kind.

---

## 8) Runtime and Public API Changes

### 8.1 Admin runtime normalization

`Admin.normalize` must accept plain generated client config directly.

Important constraint:

- Admin runtime architecture remains structurally the same.
- `AdminLayout` / `AdminRouter` behavior is preserved.
- Only admin input source changes from builder-composed config to generated client config object.

### 8.2 Public exports

- Remove `qa` from `@questpie/admin/client` public API.
- Keep runtime types/components/hooks required by the new setup.

### 8.3 App setup

New setup pattern:

```ts
import admin from "@/questpie/admin/.generated/client";

<AdminLayoutProvider admin={admin} ... />
```

Practical migration summary:

- Keep existing admin route/layout composition.
- Stop creating `qa().use(adminModule)` builders.
- Pass generated admin client object into provider/layout/router path.

---

## 9) Projection Quality Gate (Hard Error)

Cross-target validation runs after generation.

Checks:

1. Server-referenced list/edit views must exist in admin client registries.
2. Server-referenced components must exist in admin client registries.
3. Server-referenced blocks must exist in admin client registries.

Failure behavior:

- Codegen exits with error.
- Error output includes missing keys and suggested file locations.

---

## 10) Implementation Plan (Execution Sequence)

## Phase A - Target-first core refactor (DONE)

1. Refactor `CodegenPlugin` and related types to target model.
2. Migrate `coreCodegenPlugin()` to `targets.server`.
3. Implement target graph resolver with conflict validation.

Primary files:

- `packages/questpie/src/cli/codegen/types.ts`
- `packages/questpie/src/cli/codegen/index.ts`
- `packages/questpie/src/server/config/module-types.ts`

## Phase B - Multi-target CLI and watch mode (DONE)

1. `generate` runs all resolved targets.
2. `dev` watches all target roots.
3. Output summary is per target.

Primary files:

- `packages/questpie/src/cli/commands/codegen.ts`

## Phase C - Admin plugin target expansion (DONE)

1. Move admin server contribution under `targets.server`.
2. Add `targets.admin-client` with admin root discovery.
3. Add admin client generator.

Primary files:

- `packages/admin/src/server/plugin.ts`
- `packages/admin/src/server/codegen/admin-client-template.ts` (new)

## Phase D - Admin runtime hard migration (DONE)

1. Remove `qa` from public client exports.
2. Update `AdminInput`/`Admin.normalize` to generated config input.
3. Ensure providers/router work with generated config shape.

Primary files:

- `packages/admin/src/exports/client.ts`
- `packages/admin/src/client/builder/admin.ts`
- `packages/admin/src/client/runtime/provider.tsx`
- `packages/admin/src/client/views/layout/admin-layout-provider.tsx`

## Phase E - Projection validator (DONE)

1. Implement cross-target projection checks.
2. Fail codegen on mismatch.
3. Add actionable diagnostics.

Primary files:

- `packages/questpie/src/cli/codegen/index.ts`
- `packages/admin/src/server/codegen/*` (if helper extraction is needed)

## Phase F - Examples, templates, docs, tests (DONE)

1. Update examples to generated admin client imports.
2. Update create-questpie templates.
3. Remove old `qa` setup examples from docs.
4. Update and add tests for target graph and admin client generation.

Primary files:

- `examples/**/questpie/admin/*`
- `packages/create-questpie/templates/**/questpie/admin/*`
- `apps/docs/**`
- `packages/questpie/test/codegen/*.test.ts`
- `packages/admin/test/**/*.test.ts`

## Phase G - Admin module client codegen & runtime simplification

Phase G replaces the hardcoded `AdminBuilder`/`coreAdminModule` pattern with
codegen-discovered components within the admin module itself. It simplifies the
entire client-side admin architecture into a flat, kind-discriminated view
registry with plain-object factories — consistent with the server-side model.

> **Companion**: AUDIT-PHASE-G.md — full codebase audit, rationale, and code examples.

### G.0 Design principles

1. **Core modules = user code.** Admin module's built-in views/fields/pages/widgets
   use the exact same file conventions, factories, and codegen patterns as user code.
   No special internal APIs, no hidden switches.
2. **Everything declarative, nothing imperative.** All defaults and mappings are
   expressed as data in declarations (extension defaults, view definitions, config
   objects) — never as hardcoded maps or if/switch in framework code.
3. **Consistent naming across all layers.** Same concept = same name everywhere.
   No synonyms between server, client, codegen, and runtime.
4. **One `view()` factory** on both server and client (same name, same `kind` field).
5. **Flat `views` registry** — no `listViews`/`editViews` split on client state.
6. **No `defaultViews` fallback layer** — view-level config on `ViewDefinition`,
   default view names via extension `defaults`.
7. **`ViewKindRegistry { list, form }`** — `"form"` (not `"edit"`) matches `.form()`
   extension, `admin.form` schema key, and `*-form` view naming.
8. **View names: `{entity-type}-{implementation}`** — `collection-table`,
   `collection-form`, `global-form`. Consistent prefixing.
9. **Plain objects** — no builder classes, no `$options()`, no chaining.
10. **Validation from introspection** — `buildZodFromIntrospection()` with
    `FIELD_VALIDATORS` escape hatch for complex field types.

### G.1 View system design

#### `ViewKindRegistry` — CHANGED: `"edit"` → `"form"`

```ts
interface ViewKindRegistry {
	list: {}; // listing entities
	form: {}; // editing a single entity (was "edit" — renamed for consistency
	// with .form() extension, admin.form schema key, *-form view names)
}
type ViewKind = keyof ViewKindRegistry;
```

Extensible via augmentation. Future kinds: `"preview"`, `"dashboard"`, etc.

#### Naming consistency table

| Layer            | Collection list      | Collection form     | Global form      |
| ---------------- | -------------------- | ------------------- | ---------------- |
| Server extension | `.list()`            | `.form()`           | `.form()`        |
| Kind             | `"list"`             | `"form"`            | `"form"`         |
| Schema key       | `admin.list`         | `admin.form`        | `admin.form`     |
| View name        | `"collection-table"` | `"collection-form"` | `"global-form"`  |
| Component        | `TableView`          | `FormView`          | `GlobalFormView` |

Zero synonyms. Zero translations between layers.

User custom views follow the same `{entity-type}-{implementation}` pattern:
`collection-kanban`, `collection-wizard`, `global-wizard`, etc.

#### Server `ViewDefinition` — kind renamed

```ts
interface ViewDefinition<TName, TKind extends ViewKind, TConfig> {
	type: "view";
	name: TName;
	kind: TKind; // "list" | "form"
	readonly "~config"?: TConfig;
}
```

#### Client `ViewDefinition` — NEW, matches server + carries config

```ts
interface ViewDefinition<
	TName extends string = string,
	TKind extends ViewKind = ViewKind,
	TConfig = unknown,
> {
	readonly name: TName;
	readonly kind: TKind; // "list" | "form"
	readonly component: MaybeLazyComponent; // client-only
	readonly config?: TConfig; // view-level defaults (showSearch, showMeta, etc.)
}
```

`config` holds view-level defaults (e.g., `showSearch: true` on table view).
Schema-level overrides merge on top at runtime.

#### Client `view()` factory

```ts
function view<TName extends string, TKind extends ViewKind, TConfig = unknown>(
	name: TName,
	options: { kind: TKind; component: MaybeLazyComponent; config?: TConfig },
): ViewDefinition<TName, TKind, TConfig>;
```

Replaces `listView()` + `editView()`. Returns `Object.freeze`'d plain object.

#### Default view resolution — via extension defaults, NOT router

Default view names are declared in the admin plugin's **extension definitions**:

```ts
// packages/admin/src/server/plugin.ts
collectionExtensions: {
  list: {
    stateKey: "adminList",
    defaults: { view: "collection-table" },   // ← declarative
  },
  form: {
    stateKey: "adminForm",
    defaults: { view: "collection-form" },    // ← declarative
  },
},
globalExtensions: {
  form: {
    stateKey: "adminForm",
    defaults: { view: "global-form" },        // ← declarative
  },
},
```

Introspection applies defaults generically — **no special cases per entity type**:

```ts
// Generic: extension defaults merge with user-provided state
const listConfig = { ...extensionDefaults.list, ...state.adminList };
// Result: schema.admin.list.view is ALWAYS populated
```

The router reads `schema.admin.list.view` / `schema.admin.form.view` directly.
**No fallback logic. No VIEW_DEFAULTS map. No hardcoded view names in router.**

This is the same mechanism a third-party plugin would use to add a new entity type
with its own default views — the framework requires zero changes.

#### Built-in views (admin module)

Server (3 view files — `global-form.ts` is NEW):

```
modules/admin/views/collection-table.ts → view<ListViewConfig>("collection-table", { kind: "list" })
modules/admin/views/collection-form.ts  → view<FormViewConfig>("collection-form", { kind: "form" })
modules/admin/views/global-form.ts      → view<FormViewConfig>("global-form", { kind: "form" })
```

Client (3 view files in module `client/` dir):

```
modules/admin/client/views/collection-table.ts → view("collection-table", {
  kind: "list",
  component: () => import("./table-view"),
  config: { showSearch: true, showFilters: true, showToolbar: true, realtime: false },
})

modules/admin/client/views/collection-form.ts → view("collection-form", {
  kind: "form",
  component: () => import("./form-view"),
  config: { showMeta: true },
})

modules/admin/client/views/global-form.ts → view("global-form", {
  kind: "form",
  component: () => import("./global-form-view"),
})
```

View-level config (`showSearch`, `showMeta`, etc.) lives on the view definition.
Schema can override per collection/global. No `defaultViews` layer.

Server codegen produces `listViews`/`formViews` via `filterViewsByKind()` for type-safe
`.list()` / `.form()` builder contexts. This is a server-only concern — the client
does not split.

### G.2 Complete client API surface

#### Factories

```ts
// @questpie/admin/client exports:

function view(name, { kind, component, config? })  → ViewDefinition
function field(name, { component, cell?, validator? }) → FieldRegistryEntry
function component(name, { component })             → ComponentDefinition
function page(name, { component, label?, icon?, path? }) → PageDefinition
function widget(name, { component, label?, description?, defaultSize? }) → WidgetDefinition
```

All return `Object.freeze`'d plain readonly objects. No classes, no builders, no `$options()`.
Same factories used by admin module and user code — no difference.

#### `AdminState` (replaces `AdminBuilderState`)

```ts
interface AdminState {
	views: Record<string, ViewDefinition>;
	fields: Record<string, FieldRegistryEntry>;
	components: Record<string, ComponentDefinition>;
	pages: Record<string, PageDefinition>;
	widgets: Record<string, WidgetDefinition>;
	blocks: Record<string, BlockDefinition>;
	translations: TranslationsMap;
	locale: LocaleConfig; // includes labels: { en: "English", sk: "Slovenčina" }
}
```

Removed from old `AdminBuilderState`:

- `"~app"` phantom type
- `listViews` / `editViews` (flat `views` instead)
- `defaultViews` (removed concept entirely)

Locale labels move from hardcoded `Admin.getLocaleLabel()` to `locale.labels` in config.

#### `Admin` class

```ts
class Admin {
	constructor(public readonly state: AdminState) {}

	getViews(): Record<string, ViewDefinition>;
	getView(name: string): ViewDefinition | undefined;
	getViewsByKind(kind: ViewKind): Record<string, ViewDefinition>;
	getField(name: string): FieldRegistryEntry | undefined;
	getFields(): Record<string, FieldRegistryEntry>;
	getComponent(name: string): ComponentDefinition | undefined;
	getPage(name: string): PageDefinition | undefined;
	getPages(): Record<string, PageDefinition>;
	getWidget(name: string): WidgetDefinition | undefined;
	getWidgets(): Record<string, WidgetDefinition>;

	static normalize(input: AdminState): Admin;
}
```

Removed: `getListViews()`, `getEditViews()`, `getDefaultViews()`.
`normalize()` only accepts plain `AdminState` objects (no `AdminBuilder` branch).

#### `FieldRegistryEntry` (replaces `FieldDefinition`)

```ts
interface FieldRegistryEntry<TName extends string = string> {
	readonly name: TName;
	readonly component: React.ComponentType<BaseFieldProps>;
	readonly cell?: React.ComponentType<BaseCellProps>;
	readonly validator?: FieldValidator; // optional — for custom field validation
}
```

Removed: `createZod`, `$options()`, builder class.
Added: optional `validator` for third-party field extensibility.

#### Validation from introspection

```ts
function buildZodFromIntrospection(
	fieldSchema: FieldIntrospection,
	ctx?: { buildSchema: (field: FieldIntrospection) => z.ZodType },
): z.ZodType;
```

Three-tier resolution:

1. `field.validator` (from FieldRegistryEntry — custom fields)
2. `FIELD_VALIDATORS[fieldType]` (built-in special cases: object, array, blocks, time, select, date, datetime, email)
3. Generic introspection path (14 simple fields — zero per-field code)

Replaces 18 per-field `createZod()` functions with ~60% less code.

### G.3 `moduleRoot` on `CodegenTargetContribution`

Add `moduleRoot?: string` to `CodegenTargetContribution`. When present, module-mode
codegen runs discovery within the module's `moduleRoot` subdirectory for that target.

```ts
export interface CodegenTargetContribution {
  root: string;
  outDir?: string;
  outputFile: string;
  moduleRoot?: string;     // NEW — subdirectory within module for this target
  categories?: Record<string, CategoryDeclaration>;
  discover?: Record<string, DiscoverPattern>;
  registries?: { ... };
  transform?: (ctx: CodegenContext) => void;
  generate?: (...) => ...;
}
```

Admin plugin sets `moduleRoot: "client"` on the `admin-client` target.

`generatePackageModules()` iterates ALL targets per module. For each target,
computes discovery root as `{moduleDir}/{moduleRoot}/` (or `{moduleDir}/` if no
moduleRoot). Skips if directory doesn't exist — not every module contributes to
every target.

Primary files:

- `packages/questpie/src/cli/codegen/types.ts` — add `moduleRoot` to types
- `packages/questpie/src/cli/codegen/index.ts` — merge `moduleRoot` in `resolveTargetGraph()`
- `packages/questpie/src/cli/commands/codegen.ts` — multi-target in `generatePackageModules()`

### G.EXT Extension defaults (NEW)

Add `defaults?: Record<string, unknown>` to `RegistryExtension`. When present,
introspection merges extension defaults with user-provided state generically.

```ts
export interface RegistryExtension {
	stateKey: string;
	configType: string;
	defaults?: Record<string, unknown>; // NEW
	// ... isCallback, callbackContextParams, etc.
}
```

Admin plugin sets defaults on collection/global extensions:

```ts
collectionExtensions: {
  list: { stateKey: "adminList", defaults: { view: "collection-table" }, ... },
  form: { stateKey: "adminForm", defaults: { view: "collection-form" }, ... },
},
globalExtensions: {
  form: { stateKey: "adminForm", defaults: { view: "global-form" }, ... },
},
```

Introspection applies defaults generically — same code path for all extensions,
all entity types. No special cases.

Primary files:

- `packages/questpie/src/cli/codegen/types.ts` — add `defaults` to `RegistryExtension`
- `packages/questpie/src/cli/codegen/factory-template.ts` — emit defaults in resolve()
- `packages/questpie/src/server/collection/introspection.ts` — apply defaults generically
- `packages/questpie/src/server/global/introspection.ts` — apply defaults generically
- `packages/admin/src/server/plugin.ts` — set defaults on extensions

### G.4 Admin module client files

Create thin wrapper files in admin module's `client/` subdirectory:

Views (3 files):

- `modules/admin/client/views/collection-table.ts` — `view("collection-table", { kind: "list", component: ..., config: { showSearch: true, ... } })`
- `modules/admin/client/views/collection-form.ts` — `view("collection-form", { kind: "form", component: ..., config: { showMeta: true } })`
- `modules/admin/client/views/global-form.ts` — `view("global-form", { kind: "form", component: ... })`

Fields (18 files — one per built-in field type):

- `modules/admin/client/fields/text.ts` — `field("text", { component: ..., cell: ... })`
- ... (one file per: text, number, boolean, date, dateTime, select, multiSelect, relation, upload, richText, json, slug, email, url, password, color, textarea, blocks)

Components (1 file):

- `modules/admin/client/components/icon.ts` — `component("icon", { component: ... })`

Pages (5 files — dashboard is a regular page, not a defaultViews entry):

- `modules/admin/client/pages/dashboard.ts` — `page("dashboard", { component: ..., path: "/" })`
- ... (login, forgot-password, reset-password, setup)

Widgets (8 files) — same pattern.

Server: rename view files to match new naming:

- `modules/admin/views/collection-table.ts` — `view<ListViewConfig>("collection-table", { kind: "list" })`
- `modules/admin/views/collection-form.ts` — `view<FormViewConfig>("collection-form", { kind: "form" })`
- `modules/admin/views/global-form.ts` (NEW) — `view<FormViewConfig>("global-form", { kind: "form" })`

Primary files:

- `packages/admin/src/server/modules/admin/client/**` — new thin wrapper files
- `packages/admin/src/server/modules/admin/views/*` — renamed view files

### G.5 Admin-client codegen template changes

Update `generateAdminClientTemplate()`:

**Module mode** (`isModuleMode = !!ctx.module`):

- Generates the module's own client defaults — no `_defaults` import.
- Output: flat `AdminState`-shaped object with module's registrations.
- Exported from `@questpie/admin/client/defaults` (new package.json export entry).

**Project mode** (for user projects):

- Imports defaults: `import _defaults from "@questpie/admin/client/defaults"`
- Merges user files on top: `views: { ..._defaults.views, "collection-kanban": _kanban }`
- No `filterViews()` splitting — flat merge for all categories.

Add `./client/defaults` export entry to `packages/admin/package.json`.

Primary files:

- `packages/admin/src/server/plugin.ts` — add `moduleRoot: "client"` to admin-client target
- `packages/admin/src/server/codegen/admin-client-template.ts` — module/project mode, flat views
- `packages/admin/package.json` — new export entry

### G.6 Runtime changes

#### Router (`admin-router.tsx`)

- Remove `DEFAULT_LIST_VIEW_ID`, `DEFAULT_EDIT_VIEW_ID`, all hardcoded view name constants.
- Remove `VIEW_DEFAULTS` map — defaults come from extension system (schema always populated).
- Remove all `defaultViews` usage from route handlers.
- Remove `hasCustomViewSpecified` special-casing for globals.
- All routes use same generic pattern:
  ```ts
  const viewName = schema.admin[operation].view; // ALWAYS present (from extension defaults)
  const viewDef = views[viewName];
  const viewConfig = mergeViewConfig(
  	viewDef?.config,
  	schema.admin[operation]?.["~config"],
  );
  ```
- Add `kind` validation: warn if resolved view's kind doesn't match route expectation.
- Remove `showSearch`, `showFilters`, `showToolbar`, `showMeta`, `realtime` extraction
  from `defaultViews` — these are now on `ViewDefinition.config`, merged via `viewConfig`.

#### Admin class (`admin.ts`)

- `normalize()` accepts `AdminState` directly (no `AdminBuilder` branch).
- Remove `getListViews()`, `getEditViews()`, `getDefaultViews()`.
- Add `getViews()`, `getView(name)`, `getViewsByKind(kind)`.
- Move locale labels from hardcoded map to `locale.labels` in config.

#### Validation (`validation.ts`)

- Remove per-field `createZod` calls from `createFormSchema()`.
- Add `buildZodFromIntrospection(fieldSchema, ctx?)` with three-tier resolution.
- `FIELD_VALIDATORS` registry for special cases (object, array, blocks, time, select, date, datetime, email).
- `useCollectionValidation()` uses `buildZodFromIntrospection()`.

#### Field resolution (`build-field-definitions-from-schema.ts`)

- Remove `registry[fieldType].$options(config)` pattern.
- Plain lookup: `admin.getField(fieldType)` → returns `{ component, cell }`.
- Field config passes through props, not builder methods.

Primary files:

- `packages/admin/src/client/views/layout/admin-router.tsx`
- `packages/admin/src/client/builder/admin.ts`
- `packages/admin/src/client/builder/validation.ts`
- `packages/admin/src/client/views/collection/build-field-definitions-from-schema.ts`
- `packages/admin/src/client/views/collection/field-context.ts`
- `packages/admin/src/client/views/collection/columns/build-columns.tsx`

### G.7 Delete legacy code

| File                                    | Reason                                                      |
| --------------------------------------- | ----------------------------------------------------------- |
| `client/builder/admin-builder.ts`       | `AdminBuilder` class → codegen                              |
| `client/builder/qa.ts`                  | `qa()` factory → codegen                                    |
| `client/builder/defaults/core.ts`       | `coreAdminModule` → generated defaults                      |
| `client/builder/defaults/starter.ts`    | `adminModule` re-export → `@questpie/admin/client/defaults` |
| `client/builder/defaults/fields.tsx`    | 18 hardcoded fields → individual module client files        |
| `client/builder/defaults/views.ts`      | Hardcoded views → individual module client files            |
| `client/builder/defaults/pages.ts`      | Hardcoded pages → individual module client files            |
| `client/builder/defaults/widgets.ts`    | Hardcoded widgets → individual module client files          |
| `client/builder/defaults/components.ts` | Hardcoded components → individual module client files       |
| `client/builder/types/views.ts`         | `DefaultViewsConfig` type → removed concept                 |

Update `exports/client.ts`:

- Remove: `AdminBuilder`, `qa`, `listView`, `editView`, `FieldBuilder`, `PageBuilder`, `WidgetBuilder`,
  `coreAdminModule`, `adminModule`, `DefaultViewsConfig`, `AdminBuilderState`
- Add: `view`, `field`, `component`, `page`, `widget`, `AdminState`,
  `ViewDefinition`, `FieldRegistryEntry`, `ComponentDefinition`, `PageDefinition`, `WidgetDefinition`

### G.8 Tests

- Rewrite `admin-builder.test.ts` → `admin.test.ts` (Admin class with flat views)
- Delete `qa.test.ts`
- Rewrite `module-merging.test.ts` (plain AdminState merging, no AdminBuilder)
- Rewrite `validation.test.ts` (`buildZodFromIntrospection` with FIELD_VALIDATORS)
- Add `factories.test.ts` (`view()`, `field()`, `page()`, `widget()` plain object factories)
- Update codegen template tests for flat views output, no `filterViews()`
- Update projection validator tests for flat views checking
- Add `moduleRoot` merge tests in `resolveTargetGraph()` test suite
- Add extension defaults tests (defaults applied in introspection)

Primary files:

- `packages/admin/test/builder/*.test.ts`
- `packages/admin/test/server/codegen.test.ts`
- `packages/questpie/test/codegen/template.test.ts`

---

## 11) Testing and Validation Matrix

Required checks:

1. `bun run check-types`
2. `bun test`
3. `bun run build`

Mandatory test coverage:

- Target graph merge and conflict rules
- Multi-target generation output
- Watch mode regeneration for non-server target roots
- Admin generated client runtime compatibility
- Projection mismatch hard-fail behavior

---

## 12) Scope and Effort

Phases A-F (DONE):

- Medium-to-large refactor
- Roughly 25-45 files touched depending on final generator placement
- High impact but controlled by phased execution
- Effort: 2-4 weeks including docs/tests/examples stabilization

Phase G (TODO):

- Large refactor — replaces entire admin client builder infrastructure
- Estimated 40-60 files touched (new module client files, factory rewrites, runtime changes, deletions, tests)
- Hard breaking change — `AdminBuilder`, `qa()`, `coreAdminModule`, `listView()`/`editView()`, per-field `createZod`, `defaultViews` all removed
- Effort: 2-3 weeks including tests and examples stabilization

---

## 13) Definition of Done

Phases A-F are done when all items are true (ALL DONE):

1. Plugin system supports plugin-defined codegen targets.
2. Admin plugin declares and builds `admin-client` target.
3. `questpie/admin/.generated/client.ts` is the canonical admin client config artifact.
4. Application admin setup no longer depends on `qa()`.
5. Projection mismatch fails during codegen.
6. Templates and examples use generated admin config.
7. Typecheck/tests/build pass in monorepo.

Phase G is done when all items are true:

8. `AdminBuilder` class, `qa()` factory, `coreAdminModule` are deleted.
9. Client-side views use flat `views` registry with `kind` discriminant `"list" | "form"` (no `listViews`/`editViews`/`defaultViews`).
10. Single `view()` factory on client matches server `view()` pattern. Returns plain frozen object.
11. Admin module provides built-in views/fields/components/pages/widgets as individual files in `modules/admin/client/` — same file convention as user code.
12. `@questpie/admin/client/defaults` export provides codegen-generated module defaults.
13. `moduleRoot` on `CodegenTargetContribution` enables multi-target module codegen.
14. `generatePackageModules()` processes all targets per module.
15. View names follow `{entity-type}-{implementation}` convention: `collection-table`, `collection-form`, `global-form`.
16. Default view names declared via extension `defaults` — router has ZERO hardcoded view names, ZERO fallback logic.
17. `RegistryExtension.defaults` applied generically in introspection — schema always has view name populated.
18. `ViewDefinition.config` carries view-level defaults (showSearch, showMeta, etc.) — no `defaultViews` layer.
19. `buildZodFromIntrospection()` with `FIELD_VALIDATORS` replaces per-field `createZod` functions.
20. `FieldRegistryEntry.validator` enables third-party field validation extensibility.
21. Field lookup is plain `admin.getField(type)` — no `$options()` pattern.
22. All legacy builder infrastructure deleted (see G.7 deletion table).
23. Naming consistency: `kind: "form"` everywhere (not `"edit"`), matching `.form()` extension and `admin.form` schema key.
24. Tests updated and passing. Typecheck/build pass in monorepo.

---

## 14) Explicitly Out of Scope for This Plan

1. Backward compatibility adapters for `qa()` setup.
2. Optional fallback directory conventions (`questpie/client`).
3. Non-admin target features not needed for generic target infrastructure.
4. Keeping unused legacy builder bootstrap code in production path.

Those may be addressed in future RFCs if needed, but are not part of this execution.
