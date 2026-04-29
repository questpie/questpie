# Phase G — Final Audit & Locked Decisions

> Date: 2026-03-01
> Status: All design decisions locked. Ready for implementation.
> Input: Full codebase audit + design review session.

---

## Core Principle (Non-Negotiable)

**Core parts of the framework added by modules MUST follow the exact same principles
as if the user added them manually.** No special internal APIs, no hidden switches,
no imperative hacks. The admin module uses the same file conventions, factories,
codegen patterns, and extension mechanisms as any user code.

**Everything declarative, nothing imperative.** All configuration, defaults, and
mappings are expressed as data (declarations), not as code (if/switch/hardcoded maps).
Solutions must scale without touching framework code.

**Consistent naming.** Same concepts use the same names across server, client, codegen,
and runtime. No synonyms, no abbreviations that differ between layers.

---

## Decision 1: Naming Consistency

### Kind: `"edit"` renamed to `"form"`

The extension is `.form()`, the schema key is `admin.form`, the view names end with
`-form` — so the kind must be `"form"`, not `"edit"`.

```typescript
interface ViewKindRegistry {
	list: {};
	form: {}; // was "edit" — now matches .form() extension and view naming
}
```

### View naming convention: `{entity-type}-{implementation}`

If `global-form` has an entity prefix, then collection views must too. No implicit defaults.

| View name          | Kind     | Component        | Entity scope |
| ------------------ | -------- | ---------------- | ------------ |
| `collection-table` | `"list"` | `TableView`      | collection   |
| `collection-form`  | `"form"` | `FormView`       | collection   |
| `global-form`      | `"form"` | `GlobalFormView` | global       |

User custom views follow the same pattern:

```
collection-kanban    → kind: "list"   (custom collection list)
collection-wizard    → kind: "form"   (custom collection form)
global-wizard        → kind: "form"   (custom global form)
```

### Full consistency table

| Layer            | Collection list      | Collection form     | Global form      |
| ---------------- | -------------------- | ------------------- | ---------------- |
| Server extension | `.list()`            | `.form()`           | `.form()`        |
| Kind             | `"list"`             | `"form"`            | `"form"`         |
| Schema key       | `admin.list`         | `admin.form`        | `admin.form`     |
| View name        | `"collection-table"` | `"collection-form"` | `"global-form"`  |
| Component        | `TableView`          | `FormView`          | `GlobalFormView` |

Zero synonyms. Zero translations between layers.

---

## Decision 2: Default View Names via Extension Defaults

### Problem

The plan had `VIEW_DEFAULTS` hardcoded in the router — that is the same imperative
hack as `hasCustomViewSpecified`, just repackaged. Router must have ZERO knowledge
of which view belongs where.

### Solution

Default view names are declared in the **extension definition** on the server side.
The admin plugin's `collectionExtensions` and `globalExtensions` already exist — they
gain a `defaults` property:

```typescript
// packages/admin/src/server/plugin.ts
collectionExtensions: {
  list: {
    stateKey: "adminList",
    defaults: { view: "collection-table" },   // ← declarative
    // ... callbackContextParams, configType, etc.
  },
  form: {
    stateKey: "adminForm",
    defaults: { view: "collection-form" },    // ← declarative
    // ...
  },
},
globalExtensions: {
  form: {
    stateKey: "adminForm",
    defaults: { view: "global-form" },        // ← declarative
    // ...
  },
},
```

Introspection applies defaults generically — no special cases:

```typescript
// Generic: merge extension defaults with user-provided state
const listConfig = { ...extensionDefaults.list, ...state.adminList };
// Result: admin.list.view is ALWAYS populated
```

Effects:

- Client schema **always** has `admin.list.view` and `admin.form.view` populated.
- Router reads `schema.admin.list.view` / `schema.admin.form.view` directly.
- **No fallback logic in router.** No `VIEW_DEFAULTS` map. No `resolveDefaultViewName`.
- User overrides the same way: `.list(({v}) => v["collection-kanban"]({...}))`.
- Third-party plugin adds a new entity type with its own extension defaults — works automatically.

### Router becomes fully generic

```typescript
// ENTIRE view resolution — same for every route type
const viewName = schema.admin[operation].view;  // always present (set by extension defaults)
const viewDef = views[viewName];

if (viewDef && viewDef.kind !== expectedKind) {
  console.warn(`View "${viewName}" has kind "${viewDef.kind}", expected "${expectedKind}"`);
}

return <RegistryViewRenderer loader={viewDef?.component} componentProps={routeProps} />;
```

Zero entity-type knowledge. Zero hardcoded maps. Pure data-driven.

---

## Decision 3: `defaultViews` Props Move to View Definition Config

### Problem

`showSearch`, `showFilters`, `showToolbar`, `realtime`, `showMeta` currently live on
`defaultViews` — a hidden layer. Where do they go?

### Solution

View definition carries its own config. Same factory, same pattern as user code:

```typescript
// modules/admin/client/views/collection-table.ts
export default view("collection-table", {
	kind: "list",
	component: () => import("./table-view"),
	config: {
		showSearch: true,
		showFilters: true,
		showToolbar: true,
		realtime: false,
	} satisfies ListViewConfig,
});

// modules/admin/client/views/collection-form.ts
export default view("collection-form", {
	kind: "form",
	component: () => import("./form-view"),
	config: {
		showMeta: true,
	} satisfies FormViewConfig,
});
```

Router merges view config with schema override:

```typescript
const viewConfig = mergeViewConfig(
	viewDef?.config, // view-level defaults (from view definition)
	schema.admin[operation]?.["~config"], // schema-level override (per collection/global)
);
```

User can override per collection: `.list(({v}) => v["collection-table"]({ showSearch: false }))`.
User can override globally by registering their own view with different config.

`defaultViews` type and all references are deleted.

### Dashboard

Dashboard becomes a regular page in `pages` registry:

```typescript
// modules/admin/client/pages/dashboard.ts
export default page("dashboard", {
	component: () => import("./dashboard-page"),
	label: "Dashboard",
	icon: "ph:house",
	path: "/",
});
```

---

## Decision 4: `buildZodFromIntrospection` — Hybrid with `FIELD_VALIDATORS`

### Audit result

| Category                | Count | Fields                                                                          | Introspection-only?                        |
| ----------------------- | ----- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| Purely metadata-driven  | 9     | text, textarea, number, boolean, json, richText, relation, upload, assetPreview | YES                                        |
| Metadata + minor custom | 5     | email, url, date, datetime, select                                              | YES with type-aware logic                  |
| Context-dependent       | 2     | object, array                                                                   | NO — needs `ctx.buildSchema` for recursion |
| Custom recursive        | 1     | blocks                                                                          | NO — lazy schema + custom refine           |
| Hardcoded format        | 1     | time                                                                            | NO — regex not in metadata                 |

### Solution

Generic introspection handles 14 fields. `FIELD_VALIDATORS` registry handles the 4 special cases.
Same extensibility mechanism for user custom fields.

```typescript
function buildZodFromIntrospection(
	fieldSchema: FieldIntrospection,
	ctx?: { buildSchema: (field: FieldIntrospection) => z.ZodType },
): z.ZodType {
	const validator = FIELD_VALIDATORS[fieldSchema.type];
	if (validator) return validator(fieldSchema, ctx);

	// Generic path: 14 fields, zero per-field code
	let schema = resolveBaseType(fieldSchema.type);
	// apply minLength, maxLength, min, max, pattern from metadata
	return wrapOptional(schema, fieldSchema.required);
}

const FIELD_VALIDATORS: Record<string, FieldValidator> = {
	object: buildObjectZod,
	array: buildArrayZod,
	blocks: buildBlocksZod,
	time: buildTimeZod,
	select: buildSelectZod,
	date: buildDateZod,
	datetime: buildDateTimeZod,
	email: buildEmailZod,
};
```

`FieldRegistryEntry` gains optional `validator` for third-party field extensibility:

```typescript
interface FieldRegistryEntry<TName extends string = string> {
	readonly name: TName;
	readonly component: React.ComponentType<BaseFieldProps>;
	readonly cell?: React.ComponentType<BaseCellProps>;
	readonly validator?: FieldValidator; // optional — for custom fields
}
```

`buildZodFromIntrospection` checks `field.validator` before `FIELD_VALIDATORS` before
generic path. Three-tier resolution, all declarative.

---

## Decision 5: `moduleRoot` + Multi-Target Package Mode

`moduleRoot` on `CodegenTargetContribution` tells package-mode codegen where to run
discovery for each target within a module.

```typescript
// admin plugin
"admin-client": {
  root: "../admin",
  moduleRoot: "client",           // module-mode discovery in client/ subdir
  outputFile: "client.ts",
  // ...
}
```

`generatePackageModules()` iterates ALL targets per module:

```typescript
for (const moduleDir of moduleDirs) {
  for (const [targetId, target] of targetGraph) {
    const discoveryRoot = target.moduleRoot
      ? join(moduleDir.path, target.moduleRoot)
      : moduleDir.path;

    if (!existsSync(discoveryRoot)) continue;  // skip if module doesn't contribute

    await runCodegen({ rootDir: discoveryRoot, targetId, ... });
  }
}
```

---

## Decision 6: Module-Mode vs Project-Mode Template

Detection: `isModuleMode = !!ctx.module`.

**Module mode** (admin package internal):

- No `_defaults` import — this IS the defaults.
- Exports flat `AdminState` object.
- Published as `@questpie/admin/client/defaults`.

**Project mode** (user projects):

- Imports `_defaults` from `@questpie/admin/client/defaults`.
- Merges user files on top.
- No `filterViews()` — flat views in both modes.

---

## Decision 7: Plain Object Factories

All factories return `Object.freeze`'d plain objects. No builders, no classes, no `$options()`.

```typescript
// view() — matches server pattern, kind is "list" | "form"
function view(name, { kind, component, config? }) → ViewDefinition

// field() — component + optional cell + optional validator
function field(name, { component, cell?, validator? }) → FieldRegistryEntry

// page(), widget(), component() — same pattern
function page(name, { component, label?, icon?, path? }) → PageDefinition
function widget(name, { component, label?, description?, defaultSize? }) → WidgetDefinition
function component(name, { component }) → ComponentDefinition
```

Same factories used by admin module files and user files. No difference.

---

## Decision 8: View Definition Shape

```typescript
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

No `defaultFor`. No `"~config"` phantom (use `config` directly). No `.state` nesting.

---

## Decision 9: `AdminState` Shape

```typescript
interface AdminState {
	views: Record<string, ViewDefinition>; // flat, no listViews/editViews split
	fields: Record<string, FieldRegistryEntry>;
	components: Record<string, ComponentDefinition>;
	pages: Record<string, PageDefinition>;
	widgets: Record<string, WidgetDefinition>;
	blocks: Record<string, BlockDefinition>;
	translations: TranslationsMap;
	locale: LocaleConfig; // includes labels: { en: "English", ... }
}
```

Removed: `"~app"`, `listViews`, `editViews`, `defaultViews`.

Locale labels move from hardcoded `Admin.getLocaleLabel()` to `locale.labels` in config.

---

## Execution Order

```
G.0  Plain-object factories: view(), field(), page(), widget(), component()
     ViewKindRegistry: rename "edit" → "form"
     [LOW RISK — new code only]

G.3  Add moduleRoot to CodegenTargetContribution + resolveTargetGraph
     Multi-target generatePackageModules loop
     [MEDIUM RISK — codegen infra]

G.4  Admin module client wrapper files
     View names: collection-table, collection-form, global-form
     View config: showSearch, showMeta, etc. on view definitions
     [LOW RISK — new files only]

G.5  Admin-client template: module/project mode, flat views, no filterViews()
     Package.json ./client/defaults export
     [MEDIUM RISK — template rewrite]

G.1  buildZodFromIntrospection + FIELD_VALIDATORS + field.validator
     [MEDIUM RISK — validation rewrite, well-tested path]

G.EXT Extension defaults: add `defaults` to RegistryExtension
     Apply defaults in introspection generically
     Admin plugin sets default view names on extensions
     [MEDIUM RISK — server-side, affects schema output]

G.6  Admin class: flat views, no builder normalization
     Router: fully generic, reads schema.admin.*.view, no fallbacks
     Field resolution: plain lookup, no $options
     [HIGH RISK — runtime changes]

G.7  Delete legacy files
     Update exports/client.ts
     [HIGH RISK — do last]

G.8  Tests after each step
```

---

## Files Summary

### New (~35)

- `modules/admin/client/views/{collection-table,collection-form,global-form}.ts` (3)
- `modules/admin/client/fields/{text,textarea,...,blocks,assetPreview}.ts` (18)
- `modules/admin/client/components/icon.ts` (1)
- `modules/admin/client/pages/{login,...,dashboard}.ts` (5)
- `modules/admin/client/widgets/{stats,...,progress}.ts` (8)

### Modified (~22)

- `packages/questpie/src/cli/codegen/types.ts` — moduleRoot, RegistryExtension.defaults
- `packages/questpie/src/cli/codegen/index.ts` — merge moduleRoot
- `packages/questpie/src/cli/commands/codegen.ts` — multi-target generatePackageModules
- `packages/questpie/src/server/collection/introspection.ts` — apply extension defaults
- `packages/questpie/src/server/global/introspection.ts` — apply extension defaults
- `packages/admin/src/server/plugin.ts` — moduleRoot, extension defaults, kind "form"
- `packages/admin/src/server/codegen/admin-client-template.ts` — module/project mode
- `packages/admin/src/server/modules/admin/views/*.ts` — rename kind, view names
- `packages/admin/src/client/builder/admin.ts` — flat views, simplified normalize
- `packages/admin/src/client/builder/validation.ts` — buildZodFromIntrospection
- `packages/admin/src/client/views/layout/admin-router.tsx` — generic, no fallbacks
- `packages/admin/src/client/views/collection/build-field-definitions-from-schema.ts`
- `packages/admin/src/exports/client.ts` — swap exports
- `packages/admin/package.json` — ./client/defaults export
- Tests (8+ files)

### Deleted (~10)

- `client/builder/admin-builder.ts`
- `client/builder/qa.ts`
- `client/builder/defaults/{core,starter,fields,views,pages,widgets,components}.ts`
- `client/builder/types/views.ts`
