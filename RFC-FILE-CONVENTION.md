# RFC: File-Convention + Codegen Architecture

> Status: **Draft**
> Authors: @drepkovsky
> Date: 2026-02-23

---

## Summary

Remove `QuestpieBuilder` and replace the manual `app.ts` entrypoint with **automatic codegen from file conventions**. Modules also follow the file convention and their content can be auto-generated.

**What changes:** `QuestpieBuilder` is removed, app wiring is auto-generated.
**What stays identical:** `CollectionBuilder`, `GlobalBuilder`, `Questpie` runtime, admin extensions, field system, auth, migrations, adapters.

**In scope (server-side registries):** View type definitions (`listViews`, `editViews`), component type definitions (`components`), field type definitions (`fields`) — these are server-side metadata registries that modules contribute via `module()`. They determine what `v.table()`, `c.icon()`, `f.richText()` etc. resolve to on the server. The admin module registers these as part of its `module()` definition.

**Explicitly out of scope:** The client-side admin builder (`AdminBuilder` / `qa`) — the React components that **render** field types, views, and components in the browser. These stay unchanged. The TS7056 problem only affects the server-side `QuestpieBuilder` which serializes into `.d.ts`. The client-side builder is React-only code with no serialization pressure.

---

## What Changes

| What                                            | Before                                                      | After                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `QuestpieBuilder` (`q()`, `.use()`, `.build()`) | Manual chain accumulating full app state as one type        | **Removed.** Codegen handles composition.                                                |
| `Questpie` app instance                         | Created manually via `builder.build()` in `app.ts`          | **Auto-generated** by codegen in `.generated/index.ts`                                   |
| App access in hooks/functions                   | `app` param typed as `any`, or `typedApp<BaseCMS>(ctx.app)` | **In context object** — `({ app })` in hooks/access/functions, direct import for scripts |
| Modules (adminModule, starterModule)            | `QuestpieBuilder` instances composed via `.use()`           | **`module()`** — plain data objects; can also use file convention internally             |
| RPC                                             | `rpc()` factory + `r.fn()` + `r.router()`                   | **Renamed to `function`** — `functions/` directory, nested folders = nested routes       |
| `CollectionBuilder`                             | —                                                           | **No change** (`.fields()`, `.hooks()`, `.access()`, `.admin()` etc. all stay)           |
| `GlobalBuilder`                                 | —                                                           | **No change**                                                                            |
| `Questpie` runtime class                        | —                                                           | **No change** — just created differently                                                 |
| Admin extensions                                | —                                                           | **No change**                                                                            |
| Field system, auth, migrations                  | —                                                           | **No change**                                                                            |

---

## Motivation

### The Problem

`QuestpieBuilder` accumulates a massive generic `TState` as chain methods are called. With 9+ collections in `adminModule`, TypeScript cannot serialize the inferred type into `.d.ts` (TS7056). Today this is "solved" with `QuestpieBuilder<any>`, leaking `[x: string]: any` everywhere — killing autocomplete.

This is unfixable within the builder pattern. The type is genuinely too large for a single variable.

### The Solution

No single variable carries the full app state. Each entity lives in its own file. Codegen composes `typeof` import references into flat interfaces. TypeScript serializes references by declaration path — never expands the full type.

### Additional Benefits

- **AI/agentic discoverability** — `glob **/collections/*.ts` finds any collection. No chain tracing needed.
- **Enforced clean structure** — consistent across all QUESTPIE projects.
- **No circular dependencies** — generated file imports entity files, never the other way around. `app` is provided via context.
- **Per-file scope** — each file is self-contained, independently readable and editable.

---

## Design

### 1. Design Principles

#### 1.1 Context Object Convention

**Every callback that receives proxies/helpers uses destructured object syntax.** Never positional arguments.

```ts
// CORRECT — extensible without breaking changes
collection("posts").fields(({ f }) => ({ ... }))
.list(({ v, f, a }) => v.table({ ... }))
.form(({ v, f }) => v.form({ ... }))
.admin(({ c }) => ({ icon: c.icon("ph:article") }))
.actions(({ a, c, f }) => ({ ... }))
.hooks({ beforeChange: [async ({ data, app, operation }) => { ... }] })
.indexes(({ table }) => [ ... ])
.title(({ f }) => f.title)
.access({ read: ({ session }) => !!session })

// WRONG — adding a new param is a breaking change
collection("posts").fields((f) => ({ ... }))
```

This applies everywhere: field definitions, hooks, access rules, admin config callbacks, block definitions, sidebar/dashboard config callbacks, function handlers.

**Rationale:** We can add new context properties (validators, meta helpers, etc.) to any callback without breaking existing code. `({ f })` today, `({ f, validate })` tomorrow — zero breakage.

#### 1.2 App Access — Always From Context

The `Questpie` instance is accessed in two ways:

1. **Context object** — inside hooks, access rules, functions, prefetch, etc. the framework provides `app` in the callback context:

```ts
// Hooks, access, functions — app is always in the context
.hooks({ afterChange: [async ({ doc, app }) => { ... }] })
.access({ read: ({ session, app }) => { ... } })
// function handler
export default { handler: async ({ input, app }) => { ... } }
```

2. **Direct import** — for standalone scripts, tests, or route handlers, import from the generated entrypoint:

```ts
import { app } from "./questpie/.generated";
```

**No `getApp()` or global registries.** Collections, globals, functions never import the app at module level — the generated file imports *them*, not the other way around. Inside framework callbacks `app` is always provided via the context object.

#### 1.3 Naming: "Functions" not "RPC"

What is currently called "RPC" is renamed to **"functions"** throughout:
- `rpc()` → `fn()` or just a plain object export
- `r.fn()` → plain object with `schema` + `handler`
- `r.router()` → auto-generated from file structure
- `functions/` directory replaces manual router composition

---

### 2. File Convention

Two supported layouts: **by-type** and **by-feature**. Both can coexist and are discovered by the same codegen.

#### 2.1 By-Type Layout

```
src/questpie/
├── questpie.config.ts          # Project configuration
├── collections/
│   ├── posts.ts                # 1 file = 1 collection
│   ├── categories.ts
│   └── comments.ts
├── globals/
│   └── site-settings.ts        # 1 file = 1 global
├── auth.ts                     # Auth options (single file)
├── jobs/
│   └── send-newsletter.ts      # 1 file = 1 job
├── functions/
│   ├── search.ts               # 1 file = 1 function endpoint
│   └── admin/                  # Nested folder = nested route namespace
│       ├── stats.ts            # → functions.admin.stats
│       └── users/
│           └── export.ts       # → functions.admin.users.export
├── blocks/                     # Discovered by admin plugin
│   ├── hero.ts
│   └── call-to-action.ts
├── messages/
│   ├── en.ts                   # filename = locale code
│   └── sk.ts
└── .generated/                 # AUTO-GENERATED — .gitignore'd
    └── index.ts                # App entrypoint
```

#### 2.2 By-Feature Layout

```
src/questpie/
├── questpie.config.ts
├── features/
│   ├── blog/
│   │   ├── collections/
│   │   │   ├── posts.ts
│   │   │   └── comments.ts
│   │   ├── globals/
│   │   │   └── blog-settings.ts
│   │   ├── jobs/
│   │   │   └── send-newsletter.ts
│   │   ├── functions/
│   │   │   └── related-posts.ts
│   │   └── blocks/
│   │       └── featured-post.ts
│   └── commerce/
│       ├── collections/
│       │   ├── products.ts
│       │   └── orders.ts
│       └── functions/
│           └── checkout.ts
├── auth.ts
├── messages/
│   ├── en.ts
│   └── sk.ts
└── .generated/
    └── index.ts
```

#### 2.3 Mixed Layout

Both coexist. Top-level `collections/` and `features/*/collections/` are both discovered:

```
src/questpie/
├── questpie.config.ts
├── collections/
│   └── pages.ts                # top-level
├── features/
│   └── blog/
│       └── collections/
│           └── posts.ts        # feature-scoped
└── .generated/
    └── index.ts
```

#### 2.4 Discovery Rules

| Pattern                                             | Export                                          | Key derivation                                                |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `collections/*.ts`, `features/*/collections/*.ts`   | `default` — `CollectionBuilder` or `Collection` | filename kebab→camelCase                                      |
| `globals/*.ts`, `features/*/globals/*.ts`           | `default` — `GlobalBuilder` or `Global`         | filename kebab→camelCase                                      |
| `jobs/*.ts`, `features/*/jobs/*.ts`                 | `default` — job definition                      | filename kebab→camelCase                                      |
| `functions/**/*.ts`, `features/*/functions/**/*.ts` | `default` — function definition                 | path segments: `admin/users/export.ts` → `admin.users.export` |
| `blocks/*.ts`, `features/*/blocks/*.ts`             | `default` — block definition                    | filename kebab→camelCase (discovered by admin plugin)         |
| `messages/*.ts`                                     | `default` — translation messages                | filename = locale code (`en`, `sk`)                           |
| `auth.ts`                                           | `default` — auth options                        | single key                                                    |
| `questpie.config.ts`                                | `default` — config                              | single key                                                    |

**Key derivation:** `send-newsletter.ts` → `sendNewsletter`. `site-settings.ts` → `siteSettings`.

**Conflict resolution:** If `collections/posts.ts` and `features/blog/collections/posts.ts` both exist, that's an error — codegen reports a duplicate key.

> **⚠️ One export per file.** Codegen discovers ONE entity per file — the first named or
> default export. Multiple named exports from a single file are NOT supported and will
> be silently ignored after the first.
>
> **Workaround — multiple functions in one file:** Use a single named export:
>
> ```ts
> // functions/analytics.ts → exposes as rpc.analytics(input)
> export const analytics = fn({ ... });
> ```
>
> The recommended approach is to split into separate files:
>
> ```
> functions/get-revenue-stats.ts   → rpc.getRevenueStats
> functions/get-conversion-rate.ts → rpc.getConversionRate
> ```
>
> For modules that expose multiple functions as a bundle (like `adminModule.functions`),
> the module system handles bundling — not file discovery.

---

### 3. `collection()` — Full API

The `collection()` factory creates a `CollectionBuilder`. This API is **unchanged from today** except:
- Fields callback uses `({ f })` instead of `(f)`
- No `~questpieApp` reference needed (field types come from declaration merging)

#### 3.1 Signature

```ts
function collection<TName extends string>(
  name: TName,
): CollectionBuilder<EmptyCollectionState>;
```

Fields are always defined via `.fields()`:

```ts
collection("posts").fields(({ f }) => ({
  title: f.text({ label: "Title", required: true }),
}));
```

#### 3.2 Full Example

```ts
// collections/posts.ts
import { collection } from "questpie";

export default collection("posts")
  .fields(({ f }) => ({
    title: f.text({ label: "Title", required: true }),
    slug: f.slug({ from: "title" }),
    content: f.richText({ label: "Content" }),
    excerpt: f.textarea({ label: "Excerpt", maxLength: 300 }),
    published: f.boolean({ label: "Published", default: false }),
    publishedAt: f.dateTime({ label: "Published At" }),
    author: f.relation({ to: "users" }),
    category: f.relation({ to: "categories" }),
    tags: f.relation({ to: "tags", hasMany: true }),
    featuredImage: f.upload({ label: "Featured Image" }),
  }))
  .options({
    timestamps: true,       // adds createdAt, updatedAt
    softDelete: true,       // adds deletedAt
    versioning: true,       // enables version history
  })
  .title(({ f }) => f.title)
  .indexes(({ table }) => [
    { columns: [table.slug], unique: true },
    { columns: [table.publishedAt] },
  ])
  .hooks({
    beforeChange: [
      async ({ data, operation, app }) => {
        if (operation === "create" && !data.slug) {
          data.slug = slugify(data.title);
        }
        return data;
      },
    ],
    afterChange: [
      async ({ data, operation, app }) => {
        if (operation === "create") {
          await app.queue.enqueue("sendNewsletter", { postId: data.id });
        }
      },
    ],
  })
  .access({
    read: () => true,
    create: ({ session }) => session?.user.role === "admin",
    update: ({ session }) => session?.user.role === "admin",
    delete: ({ session }) => session?.user.role === "admin",
  })
  // Admin UI extensions (from @questpie/admin, monkey-patched onto CollectionBuilder)
  .admin(({ c }) => ({
    label: "Blog Posts",
    icon: c.icon("ph:article"),
    description: "Manage blog posts",
    group: "content",
  }))
  .list(({ v, f, a }) => v.table({
    columns: [f.title, f.author, f.category, f.published, f.publishedAt],
    searchable: [f.title, f.excerpt],
    defaultSort: { field: f.publishedAt, direction: "desc" },
    actions: {
      header: { primary: [], secondary: [] },
      row: [a.delete],
      bulk: [a.deleteMany],
    },
  }))
  .form(({ v, f }) => v.form({
    sidebar: {
      position: "right",
      fields: [f.published, f.publishedAt, f.category, f.author, f.featuredImage],
    },
    fields: [
      { type: "section", label: "Content", fields: [f.title, f.slug, f.excerpt, f.content] },
      { type: "section", label: "SEO", fields: [f.tags] },
    ],
  }))
  .actions(({ a, c, f }) => ({
    builtin: [a.save(), a.delete(), a.duplicate()],
    custom: [],
  }))
  .preview({
    url: "/blog/{slug}",
  });
```

#### 3.3 CollectionBuilder State Shape

Every chain method sets a key on the internal state. The state is the same as today:

| State Key           | Set By                      | Type                                                  | Accumulate/Replace                   |
| ------------------- | --------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `name`              | `collection(name)`          | `string`                                              | Set once                             |
| `fields`            | `.fields()`                 | Drizzle column map                                    | Replace                              |
| `fieldDefinitions`  | `.fields()`                 | `Record<string, FieldDefinition>`                     | Replace                              |
| `localized`         | `.fields()` (auto-detected) | `Record<string, FieldDefinition>`                     | Replace                              |
| `virtuals`          | `.fields()` (auto-detected) | `Record<string, SQL>`                                 | Replace                              |
| `_pendingRelations` | `.fields()`                 | relation metadata                                     | Replace                              |
| `indexes`           | `.indexes()`                | index definitions                                     | Replace                              |
| `title`             | `.title()`                  | field key string                                      | Replace                              |
| `options`           | `.options()`                | `{ timestamps?, softDelete?, versioning? }`           | Replace                              |
| `hooks`             | `.hooks()`                  | `{ beforeChange[], afterChange[], afterRead[], ... }` | **Accumulate** (arrays concatenated) |
| `access`            | `.access()`                 | `{ read?, create?, update?, delete? }`                | Replace                              |
| `searchable`        | `.searchable()`             | search config                                         | Replace                              |
| `validation`        | `.validation()`             | auto-generated Zod schemas                            | Replace                              |
| `upload`            | `.upload()`                 | upload options                                        | Replace (also adds fields)           |
| `output`            | `.upload()` (adds `url`)    | output columns                                        | Accumulate                           |
| `admin`             | `.admin()`                  | admin UI config                                       | Replace                              |
| `adminList`         | `.list()`                   | list view config                                      | Replace                              |
| `adminForm`         | `.form()`                   | form view config                                      | Replace                              |
| `adminPreview`      | `.preview()`                | preview config                                        | Replace                              |
| `adminActions`      | `.actions()`                | action definitions                                    | Replace                              |

#### 3.4 `.upload()` — Adds Fields Automatically

```ts
export default collection("assets")
  .fields(({ f }) => ({
    alt: f.text({ label: "Alt Text" }),
    caption: f.textarea({ label: "Caption" }),
    width: f.number({ label: "Width" }),
    height: f.number({ label: "Height" }),
  }))
  .upload({
    mimeTypes: ["image/*", "application/pdf"],
    maxSize: 10 * 1024 * 1024, // 10MB
  });
```

`.upload()` automatically injects these fields into the collection: `key`, `filename`, `mimeType`, `size`, `visibility`. It also adds `afterRead` hooks for URL generation and `afterChange` hooks for visibility sync.

#### 3.5 `.merge()` — Extending Module Collections

When a user wants to add fields to a module-provided collection:

```ts
// collections/user.ts — override admin's user collection
import { collection } from "questpie";
import { admin } from "@questpie/admin";

export default admin().collections.user.merge(
  collection("user").fields(({ f }) => ({
    department: f.text({ label: "Department" }),
    phoneNumber: f.text({ label: "Phone" }),
  }))
);
```

`.merge()` spread-merges fields, concatenates hooks, last-wins for access/title/options/admin config.

---

### 4. `global()` — Full API

Same pattern as `collection()`, simpler (no upload, no softDelete, no title):

```ts
// globals/site-settings.ts
import { global } from "questpie";

export default global("siteSettings")
  .fields(({ f }) => ({
    siteName: f.text({ label: "Site Name", required: true }),
    description: f.textarea({ label: "Description" }),
    logo: f.upload({ label: "Logo" }),
    maintenanceMode: f.boolean({ label: "Maintenance Mode", default: false }),
    socialLinks: f.json({ label: "Social Links" }),
  }))
  .options({ versioning: true })
  .hooks({
    afterChange: [
      async ({ doc, app }) => {
        // Invalidate cache when settings change
      },
    ],
  })
  .access({
    read: () => true,
    update: ({ session }) => session?.user.role === "admin",
  })
  // Admin extensions
  .admin(({ c }) => ({
    label: "Site Settings",
    icon: c.icon("ph:gear"),
  }))
  .form(({ v, f }) => v.form({
    fields: [f.siteName, f.description, f.logo, f.maintenanceMode, f.socialLinks],
  }));
```

#### 4.1 GlobalBuilder State Shape

| State Key          | Set By         | Type                                             | Accumulate/Replace                           |
| ------------------ | -------------- | ------------------------------------------------ | -------------------------------------------- |
| `name`             | `global(name)` | `string`                                         | Set once                                     |
| `fields`           | `.fields()`    | Drizzle column map                               | Replace                                      |
| `fieldDefinitions` | `.fields()`    | `Record<string, FieldDefinition>`                | Replace                                      |
| `localized`        | `.fields()`    | `Record<string, FieldDefinition>`                | Replace                                      |
| `virtuals`         | `.fields()`    | `Record<string, SQL>`                            | Replace                                      |
| `options`          | `.options()`   | `{ versioning?, scoped? }`                       | Replace                                      |
| `hooks`            | `.hooks()`     | `{ beforeChange[], afterChange[], afterRead[] }` | Replace (NOT accumulated, unlike Collection) |
| `access`           | `.access()`    | `{ read?, update? }`                             | Replace                                      |
| `admin`            | `.admin()`     | admin UI config                                  | Replace                                      |
| `adminForm`        | `.form()`      | form view config                                 | Replace                                      |

---

### 5. Builder Extension System

`CollectionBuilder` and `GlobalBuilder` ship with **only core methods** (`.fields()`, `.hooks()`, `.access()`, `.options()`, `.indexes()`, etc.). All admin UI methods (`.admin()`, `.list()`, `.form()`, `.actions()`, `.preview()`) and any future extensions are added by **external packages** through a 3-layer extension system.

This is critical: the core framework knows nothing about admin UI. Any package can extend the builders with new methods and state keys using the same mechanism.

#### 5.1 Layer 1: Empty Extension Interfaces (Core)

Core defines empty interfaces that serve as extension points:

```ts
// questpie core — collection/builder/extensions.ts
export interface CollectionBuilderExtensions {}

// questpie core — global/builder/extensions.ts
export interface GlobalBuilderExtensions {}

// questpie core — config/extensions.ts (for app-level config)
export interface ConfigExtensions {}
```

These are empty by default. The `CollectionBuilder` class intersection-types its prototype with `CollectionBuilderExtensions`, so any methods declared there become part of the builder's public API.

#### 5.2 Layer 2: Declaration Merging (Type-Level)

External packages augment these interfaces via `declare module "questpie"`:

```ts
// @questpie/admin — augmentation.ts
declare module "questpie" {
  // Extend CollectionBuilder with admin UI methods
  interface CollectionBuilderExtensions {
    admin(configOrFn: AdminConfig | ((ctx: { c: ComponentProxy }) => AdminConfig)): this;
    list(configFn: (ctx: { v: ViewProxy; f: FieldProxy; a: ActionProxy }) => ListViewConfig): this;
    form(configFn: (ctx: { v: ViewProxy; f: FieldProxy }) => FormViewConfig): this;
    actions(configFn: (ctx: { a: ActionBuilder; c: ComponentProxy; f: FieldBuilderProxy }) => ActionsConfig): this;
    preview(config: PreviewConfig): this;
  }

  // Extend GlobalBuilder with admin UI methods
  interface GlobalBuilderExtensions {
    admin(configOrFn: AdminConfig | ((ctx: { c: ComponentProxy }) => AdminConfig)): this;
    form(configFn: (ctx: { v: ViewProxy; f: FieldProxy }) => FormViewConfig): this;
  }

  // Extend CollectionBuilder state with admin keys
  interface CollectionBuilderState {
    admin?: AdminCollectionConfig;
    adminList?: ListViewConfig;
    adminForm?: FormViewConfig;
    adminPreview?: PreviewConfig;
    adminActions?: ActionsConfig;
  }

  // Extend GlobalBuilder state with admin keys
  interface GlobalBuilderState {
    admin?: AdminGlobalConfig;
    adminForm?: FormViewConfig;
  }

  // Extend config with admin-specific keys
  interface ConfigExtensions {
    sidebar?: (ctx: { s: SidebarProxy; c: ComponentProxy }) => SidebarContribution;
    dashboard?: (ctx: { d: DashboardProxy; c: ComponentProxy; a: DashboardActionProxy }) => DashboardContribution;
    branding?: BrandingConfig;
    adminLocale?: AdminLocaleConfig;
    listViews?: Record<string, ListViewDefinition>;
    editViews?: Record<string, EditViewDefinition>;
    components?: Record<string, ComponentDefinition>;
  }
}
```

After this augmentation, TypeScript sees `.admin()`, `.list()`, `.form()` etc. on `CollectionBuilder` — with full type checking.

#### 5.3 Layer 3: Runtime Monkey-Patching

The actual method implementations are added to prototypes at import time:

```ts
// @questpie/admin — patch.ts (runs as side-effect import)

import { CollectionBuilder, GlobalBuilder } from "questpie";

// Add .admin() to CollectionBuilder
CollectionBuilder.prototype.admin = function(configOrFn) {
  const config = typeof configOrFn === "function"
    ? configOrFn({ c: createComponentProxy(this) })
    : configOrFn;
  return new CollectionBuilder({ ...this.state, admin: config });
};

// Add .list() to CollectionBuilder
CollectionBuilder.prototype.list = function(configFn) {
  const config = configFn({
    v: createViewProxy(this, "list"),
    f: createFieldProxy(this),
    a: createActionProxy(),
  });
  return new CollectionBuilder({ ...this.state, adminList: config });
};

// Add .form() to CollectionBuilder
CollectionBuilder.prototype.form = function(configFn) {
  const config = configFn({
    v: createViewProxy(this, "edit"),
    f: createFieldProxy(this),
  });
  return new CollectionBuilder({ ...this.state, adminForm: config });
};

// ... same for .actions(), .preview(), GlobalBuilder.admin(), GlobalBuilder.form()
```

The side-effect import (`import "@questpie/admin"` or `import { admin } from "@questpie/admin"`) triggers the patching. Codegen ensures this import exists in `.generated/index.ts`.

#### 5.4 How It All Connects

```
┌──────────────────────────────┐
│  questpie core               │
│                              │
│  CollectionBuilder           │
│    .fields()  ← core         │
│    .hooks()   ← core         │
│    .access()  ← core         │
│    .options() ← core         │
│    .indexes() ← core         │
│    .title()   ← core         │
│    .upload()  ← core         │
│    .merge()   ← core         │
│                              │
│  interface CollectionBuilder │
│    Extensions {}  ← empty    │
└──────────────┬───────────────┘
               │ declare module "questpie"
┌──────────────▼───────────────┐
│  @questpie/admin             │
│                              │
│  augmentation.ts:            │
│    .admin()   ← type added   │
│    .list()    ← type added   │
│    .form()    ← type added   │
│    .actions() ← type added   │
│    .preview() ← type added   │
│                              │
│  patch.ts:                   │
│    .admin()   ← impl added   │
│    .list()    ← impl added   │
│    .form()    ← impl added   │
│    .actions() ← impl added   │
│    .preview() ← impl added   │
└──────────────────────────────┘
```

#### 5.5 Creating Your Own Extension

Any package can follow the same pattern. For example, a hypothetical `@questpie/workflows` plugin:

```ts
// @questpie/workflows — augmentation.ts
declare module "questpie" {
  interface CollectionBuilderExtensions {
    workflow(config: WorkflowConfig): this;
  }

  interface CollectionBuilderState {
    workflow?: WorkflowConfig;
  }

  interface ConfigExtensions {
    workflows?: Record<string, WorkflowDefinition>;
  }
}
```

```ts
// @questpie/workflows — patch.ts
import { CollectionBuilder } from "questpie";

CollectionBuilder.prototype.workflow = function(config) {
  return new CollectionBuilder({ ...this.state, workflow: config });
};
```

```ts
// User's collection file — .workflow() just works
export default collection("orders").fields(({ f }) => ({ ... }))
  .workflow({
    states: ["draft", "pending", "approved", "shipped"],
    transitions: { ... },
  });
```

#### 5.6 Proxies in Extension Callbacks

Extension methods receive proxies via destructured context objects (`({ c })`, `({ v, f, a })`, etc.). These proxies are:

| Proxy           | Provided By | Available In                                          | Purpose                                                                    |
| --------------- | ----------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `c` (component) | admin       | `.admin()`, `.actions()`, sidebar cb, dashboard cb    | `c.icon("ph:article")` → `{ type: "icon", props: { name: "ph:article" } }` |
| `v` (view)      | admin       | `.list()` (list views only), `.form()` (edit views)   | `v.table({...})` → `{ view: "table", ...config }` — scoped to context      |
| `f` (field ref) | admin       | `.list()`, `.form()`                                  | `f.title` → `"title"` (string reference to field name)                     |
| `a` (action)    | admin       | `.list()`, `.actions()` (collection), dashboard cb    | Scoped: collection `a` ≠ dashboard `a` — different helpers per context     |
| `s` (sidebar)   | admin       | module/config `sidebar` callback                      | `s.section({...})`, `s.item({...})` — sidebar contribution builders        |
| `d` (dashboard) | admin       | module/config `dashboard` callback                    | `d.section({...})`, `d.stats({...})`, `d.timeline({...})` — widget builders |

**Important:** The `f` proxy in `.list(({ f })` and `.form(({ f })` is a **field reference proxy** (returns string field names), NOT the field builder proxy from `.fields(({ f })`. The field builder proxy creates `FieldDefinition` objects, while the field reference proxy returns string keys for referencing already-defined fields.

| Context                    | `f` is                | Returns           | Example                                             |
| -------------------------- | --------------------- | ----------------- | --------------------------------------------------- |
| `.fields(({ f }) => ...)`  | Field builder proxy   | `FieldDefinition` | `f.text({ required: true })` → `FieldDefinition`    |
| `.list(({ f }) => ...)`    | Field reference proxy | `string`          | `f.title` → `"title"`                               |
| `.form(({ f }) => ...)`    | Field reference proxy | `string`          | `f.title` → `"title"`                               |
| `.title(({ f }) => ...)`   | Field reference proxy | `string`          | `f.title` → `"title"`                               |
| `.actions(({ f }) => ...)` | Field builder proxy   | `FieldDefinition` | For action form fields: `f.text({ label: "Name" })` |

#### 5.7 Server-Side Registries — Components, Views, Blocks

Components, views, and blocks follow the same **registry pattern**:

1. **Server registers** — module defines the type in its `module()` definition (metadata, config schema, reference shape)
2. **Types are extensible** — declaration merging augments registry interfaces
3. **`c`, `v` are importable** — standalone typed proxies, usable anywhere (not just inside callbacks)
4. **Client renders** — `qa` resolves server-emitted references to React components (out of scope for this RFC)

```
┌─────────────────────────────────────────────────────────────────┐
│  Server (this RFC)                                              │
│                                                                 │
│  Module registers type     →  merged into registry              │
│  Registry interface        →  augmented via declaration merging  │
│  c / v are imports         →  typed via registry interfaces     │
│  References are plain data →  { type: "icon", props: { ... } }  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Client (out of scope)                                          │
│                                                                 │
│  qa.registerComponent("icon", IconRenderer)                     │
│  qa.registerListView("table", TableRenderer)                    │
│  qa.registerListView("kanban", KanbanRenderer)                  │
└─────────────────────────────────────────────────────────────────┘
```

**Registry interfaces (core defines empty, modules augment):**

```ts
// questpie core — empty extension points
export interface ComponentRegistry {}
export interface ListViewRegistry {}
export interface EditViewRegistry {}
```

**Admin module augments with built-in types:**

```ts
// @questpie/admin — augmentation.ts
declare module "questpie" {
  interface ComponentRegistry {
    icon: (name: string) => ComponentReference<"icon", { name: string }>;
    badge: (props: { text: string; color?: string }) => ComponentReference<"badge", { text: string; color?: string }>;
  }

  interface ListViewRegistry {
    table: (config: TableViewConfig) => ListViewReference<"table">;
  }

  interface EditViewRegistry {
    form: (config: FormViewConfig) => EditViewReference<"form">;
  }
}
```

**`c`, `v`, `a` are always provided via callbacks — scoped to context:**

Callbacks are the single way to access proxies. They are context-aware — each callback only exposes helpers relevant to that context:

```ts
// .admin() — c is scoped to registered components:
collection("posts").admin(({ c }) => ({
  icon: c.icon("ph:article"),
  label: "Posts",
}))

// .list() — v has only list views, f has this collection's fields, a has list actions:
collection("posts").list(({ v, f, a }) => v.table({
  columns: [f.title, f.author],
  actions: { row: [a.delete] },
}))

// .form() — v has only edit views, f has this collection's fields:
collection("posts").form(({ v, f }) => v.form({
  fields: [f.title, f.content],
}))

// sidebar contribution — s has sidebar builders, c has components:
sidebar: ({ s, c }) => [
  s.section({ id: "content", title: { en: "Content" } }),
  s.item({ sectionId: "content", type: "collection", collection: "posts", icon: c.icon("ph:article") }),
]

// dashboard contribution — d has widget builders, c has components, a has dashboard actions:
dashboard: ({ d, c, a }) => ({
  actions: [a.create({ collection: "posts", label: "New", icon: c.icon("ph:plus") })],
  sections: [d.section({ id: "today", label: { en: "Today" } })],
  items: [d.stats({ sectionId: "today", collection: "posts", label: "Posts" })],
})
```

`c.icon("ph:users")` produces `{ type: "icon", props: { name: "ph:users" } }`. TypeScript knows exactly what methods exist based on declaration merging through `ComponentRegistry`.

**No standalone imports of `c`, `v`, `a`.** Callbacks are always the entry point — they scope available options to the context. This is the best DX because autocomplete shows only what's valid in each position.

**Third-party plugins extend the same registries:**

```ts
// @questpie/kanban-view — augmentation.ts
declare module "questpie" {
  interface ListViewRegistry {
    kanban: (config: KanbanConfig) => ListViewReference<"kanban">;
  }
}

// The module registers the view type:
export const kanbanView = () => module({
  name: "questpie-kanban",
  listViews: { kanban: listView("kanban") },
});

// User's collection — v.kanban() is now typed:
collection("tasks").list(({ v }) => v.kanban({
  groupBy: "status",
  columns: ["todo", "in-progress", "done"],
}))
```

**User-defined components work the same way:**

```ts
// User's augmentation (types.d.ts):
declare module "questpie" {
  interface ComponentRegistry {
    avatar: (props: { src: string; size?: number }) => ComponentReference<"avatar", { src: string; size?: number }>;
  }
}

// Register in config:
modules: [admin()],
components: { avatar: component("avatar") },

// Now c.avatar() is typed everywhere:
collection("users").admin({ icon: c.avatar({ src: "/default.png" }) })
```

**How `c` works at runtime — a proxy that creates `ComponentReference` objects:**

```ts
// @questpie/admin/server — exported const
export const c: ComponentRegistry = new Proxy({}, {
  get: (_, type: string) => (props: unknown) => ({
    type,
    props: type === "icon" && typeof props === "string" ? { name: props } : (props ?? {}),
  }),
}) as ComponentRegistry;
```

Validation that the component type is actually registered happens at `createApp()` merge time — not at reference creation time. This is intentional: modules haven't been merged yet when you write your config, so runtime validation at startup catches invalid references.

#### 5.8 Composable Sidebar & Dashboard

Sidebar and dashboard are **composable from modules**. Each module contributes its own sections and items. `createApp()` merges them using the same depth-first module resolution as everything else.

**The problem with the old approach:**

```ts
// OLD — monolithic sidebar in admin() options
// If audit() adds adminAuditLog, user must manually wire it into admin's sidebar
admin({
  sidebar: ({ s, c }) => s.sidebar({
    sections: [
      s.section({ id: "admin", items: [
        { type: "collection", collection: "user" },
        { type: "collection", collection: "adminAuditLog" },  // ← manual, breaks colocation
      ]}),
    ],
  }),
})
```

**The new approach — each module owns its sidebar contributions:**

Each module contributes a `sidebar` callback. The callback receives `{ s, c }` — the same scopped proxies as before. The callback is resolved immediately when `module()` or `config()` is called, producing plain data. `createApp()` then merges the resolved data from all modules.

```ts
// admin() internally contributes:
sidebar: ({ s, c }) => ({
  sections: [
    s.section({ id: "administration", title: { key: "defaults.sidebar.administration" } }),
  ],
  items: [
    s.item({ sectionId: "administration", type: "collection", collection: "user", icon: c.icon("ph:users") }),
    s.item({ sectionId: "administration", type: "collection", collection: "assets", icon: c.icon("ph:image") }),
  ],
})

// audit() internally contributes:
sidebar: ({ s }) => ({
  items: [
    s.item({ sectionId: "administration", type: "collection", collection: "adminAuditLog" }),
  ],
})

// User's questpie.config.ts contributes:
sidebar: ({ s, c }) => ({
  sections: [
    s.section({ id: "content", title: { en: "Content" } }),
    s.section({ id: "operations", title: { en: "Operations" } }),
  ],
  items: [
    s.item({ sectionId: "content", type: "collection", collection: "posts", icon: c.icon("ph:article") }),
    s.item({ sectionId: "content", type: "collection", collection: "pages" }),
    s.item({ sectionId: "operations", type: "collection", collection: "appointments" }),
  ],
})
```

**Merge result:** All sections collected (deduplicated by `id`, last definition wins for title/icon). All items appended to their sections in module resolution order (starter → admin → audit → user).

##### 5.8.1 Sidebar Contribution Shape

```ts
interface SidebarContribution {
  /** Section definitions — merged by id across modules. */
  sections?: SidebarSectionDef[];
  /** Items — appended to sections by sectionId. */
  items?: SidebarItemDef[];
}

interface SidebarSectionDef {
  /** Unique section ID — used for targeting from other modules. */
  id: string;
  /** Section title. */
  title?: I18nText;
  /** Section icon. */
  icon?: ComponentReference;
  /** Whether section is collapsible. */
  collapsible?: boolean;
}

interface SidebarItemDef {
  /** Which section this item belongs to. */
  sectionId: string;
  /** 'start' to prepend, default is 'end' (append). */
  position?: "start" | "end";
  /** Item type. */
  type: "collection" | "global" | "link" | "divider";
  /** Collection slug (when type = "collection"). */
  collection?: string;
  /** Global slug (when type = "global"). */
  global?: string;
  /** Display label (for links). */
  label?: I18nText;
  /** URL (for links). */
  href?: string;
  /** Icon reference. */
  icon?: ComponentReference;
  /** Open in new tab (for links). */
  external?: boolean;
}
```

##### 5.8.2 Dashboard Contribution Shape

Dashboard follows the same composable pattern:

```ts
interface DashboardContribution {
  /** Dashboard title — last module/user wins. */
  title?: I18nText;
  /** Dashboard description — last module/user wins. */
  description?: I18nText;
  /** Grid columns — last module/user wins. */
  columns?: number;

  /** Quick actions — concatenated from all modules. */
  actions?: DashboardAction[];
  /** Section definitions — merged by id across modules. */
  sections?: DashboardSectionDef[];
  /** Widget items — appended to sections by sectionId. */
  items?: DashboardItemDef[];
}

interface DashboardSectionDef {
  /** Unique section ID. */
  id: string;
  /** Section title. */
  label?: I18nText;
  /** Layout mode. */
  layout?: "grid";
  /** Grid columns for this section. */
  columns?: number;
}

interface DashboardItemDef {
  /** Which section this item belongs to. */
  sectionId: string;
  /** 'start' to prepend, default is 'end' (append). */
  position?: "start" | "end";
  /** Unique widget ID. */
  id: string;
  /** Widget type. */
  type: "stats" | "value" | "progress" | "chart" | "recentItems" | "timeline" | "table" | "custom";
  /** Grid span (1-4). */
  span?: number;
  /** Refresh interval in ms. */
  refreshInterval?: number;
  /** Widget-specific config (collection, filter, loader, etc.) */
  [key: string]: unknown;
}

interface DashboardAction {
  id: string;
  label: I18nText;
  href: string;
  icon?: ComponentReference;
  variant?: "primary" | "outline" | "ghost";
}
```

**Dashboard action helpers — via callback `a` proxy (scoped to dashboard context):**

```ts
// Inside dashboard callback — a has dashboard-specific helpers:
dashboard: ({ d, c, a }) => ({
  actions: [
    // a.create() — shorthand for collection create link
    a.create({ id: "new-post", collection: "posts", label: "New Post", icon: c.icon("ph:plus") }),
    // → { id: "new-post", href: "/admin/collections/posts/create", label: "New Post", icon: { type: "icon", props: { name: "ph:plus" } } }

    // a.global() — shorthand for global edit link
    a.global({ id: "settings", global: "siteSettings", label: "Settings", icon: c.icon("ph:gear") }),

    // a.link() — plain link
    a.link({ id: "docs", href: "https://docs.example.com", label: "Docs" }),
  ],
  // ...
})
```

##### 5.8.3 Sidebar & Dashboard Merge Rules

Sidebar and dashboard are now **first-class keys on `ModuleDefinition`** (not extension `[key: string]`). Merge follows the same depth-first, left-to-right module resolution as everything else (§13.7).

**Sections** — deduplicated by `id`. Later module's section definition overrides earlier (for title, icon, collapsible). If a section is only referenced by items but never defined, it's auto-created with no title.

**Items** — appended to their `sectionId` in module resolution order. Items with `position: "start"` are prepended. Default is append.

**Dashboard metadata** (title, description, columns) — last module or user config wins.

**Dashboard actions** — concatenated from all modules, user's come last.

**User config always wins** — can override any section definition or contribute items to any module-defined section.

```
Module resolution for sidebar:
  starter()  →  (no sidebar)
  admin()    →  defines "administration" section + user/assets items
  audit()    →  adds adminAuditLog item to "administration" section
  user       →  defines "content", "operations" sections + their items

Final merged sidebar:
  [content]         ← user-defined section
    posts           ← user item
    pages           ← user item
  [operations]      ← user-defined section
    appointments    ← user item
  [administration]  ← admin-defined section
    user            ← admin item
    assets          ← admin item
    adminAuditLog   ← audit item (appended after admin's items)
```

##### 5.8.4 Widget Types

Dashboard widgets that need data use an async `loader` function. Loaders run server-side on each dashboard load (or at `refreshInterval`):

| Widget Type | Purpose | Key Config |
|-------------|---------|------------|
| `stats` | Count docs from a collection | `collection`, `filter`, `span` |
| `value` | Custom value from async `loader` | `loader: async ({ app }) => { value, formatted, label, trend }` |
| `progress` | Progress bar from async `loader` | `loader: async ({ app }) => { current, target, label }` |
| `chart` | Aggregate a field into chart | `collection`, `field`, `chartType` (`pie`/`bar`/`line`) |
| `recentItems` | Latest docs from a collection | `collection`, `limit`, `dateField` |
| `timeline` | Event stream from async `loader` | `loader: async ({ app }) => [{ id, title, timestamp, variant, href }]` |
| `table` | Tabular data from async `loader` | `loader: async ({ app }) => { columns, rows }` |
| `custom` | Arbitrary widget resolved by client | `component` (string key), `props` |

##### 5.8.5 Full Example — Composable Config

```ts
// questpie.config.ts
import { config } from "questpie";
import { admin, audit } from "@questpie/admin/server";

export default config({
  modules: [
    admin({ branding: { name: "Barbershop" } }),
    audit(),
  ],

  // User's sidebar contributions — callback with scoped { s, c }
  // Merged with module contributions (admin's "administration" section, audit's items)
  sidebar: ({ s, c }) => ({
    sections: [
      s.section({ id: "overview", title: { en: "Overview" } }),
      s.section({ id: "operations", title: { en: "Operations" } }),
      s.section({ id: "content", title: { en: "Content" } }),
    ],
    items: [
      s.item({ sectionId: "overview", type: "link", label: { en: "Dashboard" }, href: "/admin", icon: c.icon("ph:house") }),
      s.item({ sectionId: "overview", type: "global", global: "siteSettings" }),
      s.item({ sectionId: "operations", type: "collection", collection: "appointments" }),
      s.item({ sectionId: "operations", type: "collection", collection: "reviews" }),
      s.item({ sectionId: "content", type: "collection", collection: "pages" }),
      s.item({ sectionId: "content", type: "collection", collection: "services" }),
    ],
  }),

  // User's dashboard contributions — callback with scoped { d, c, a }
  // Merged with module contributions (audit's timeline widget)
  dashboard: ({ d, c, a }) => ({
    title: { en: "Barbershop Control" },
    columns: 4,
    actions: [
      a.create({ id: "new-appointment", collection: "appointments", label: { en: "New Appointment" }, icon: c.icon("ph:calendar-plus"), variant: "primary" }),
      a.global({ id: "edit-settings", global: "siteSettings", label: { en: "Settings" }, icon: c.icon("ph:gear"), variant: "outline" }),
    ],
    sections: [
      d.section({ id: "today", label: { en: "Today" }, layout: "grid", columns: 4 }),
      d.section({ id: "business", label: { en: "Business" }, layout: "grid", columns: 4 }),
    ],
    items: [
      d.stats({ sectionId: "today", id: "appointments-today", collection: "appointments", label: { en: "Today's Appointments" }, filter: { scheduledAt: { gte: "..." } }, span: 1 }),
      d.stats({ sectionId: "today", id: "pending", collection: "appointments", label: { en: "Pending" }, filter: { status: "pending" }, span: 1 }),
      d.value({ sectionId: "business", id: "monthly-revenue", span: 2, loader: async ({ app }) => { /* ... */ } }),
    ],
  }),

  app: { url: process.env.APP_URL! },
  db: { url: process.env.DATABASE_URL! },
});
```

The audit module's sidebar item (adminAuditLog → "administration" section) and dashboard widget (audit timeline) appear automatically — zero manual wiring. The user never needs to know about module-internal contributions.

---

### 6. Field System — How Fields Work End-to-End

#### 6.1 Builtin Fields

QUESTPIE core provides 16 built-in field types:

| Field      | Factory        | Drizzle Column                         | Operators                                                    |
| ---------- | -------------- | -------------------------------------- | ------------------------------------------------------------ |
| `text`     | `f.text()`     | `varchar` / `text`                     | equals, notEquals, contains, startsWith, endsWith, in, notIn |
| `textarea` | `f.textarea()` | `text`                                 | same as text                                                 |
| `email`    | `f.email()`    | `varchar(255)`                         | same as text                                                 |
| `url`      | `f.url()`      | `varchar(2048)`                        | same as text                                                 |
| `number`   | `f.number()`   | `integer` / `real` / `doublePrecision` | equals, notEquals, gt, gte, lt, lte, in, notIn               |
| `boolean`  | `f.boolean()`  | `boolean`                              | equals, notEquals                                            |
| `date`     | `f.date()`     | `date`                                 | equals, notEquals, gt, gte, lt, lte                          |
| `datetime` | `f.datetime()` | `timestamp`                            | equals, notEquals, gt, gte, lt, lte                          |
| `time`     | `f.time()`     | `time`                                 | equals, notEquals                                            |
| `select`   | `f.select()`   | `varchar`                              | equals, notEquals, in, notIn                                 |
| `relation` | `f.relation()` | `varchar` (FK)                         | equals, notEquals, in, notIn + relation-specific             |
| `upload`   | `f.upload()`   | `varchar` (FK to assets)               | equals, notEquals                                            |
| `json`     | `f.json()`     | `jsonb`                                | —                                                            |
| `object`   | `f.object()`   | multiple columns (flattened)           | per-subfield                                                 |
| `array`    | `f.array()`    | `jsonb`                                | —                                                            |
| `slug`     | `f.slug()`     | `varchar`                              | same as text                                                 |

These are defined in `builtinFields` map and always available via the `f` proxy.

**Notable field config options (not exhaustive):**

`f.relation()` — supports simple and many-to-many through join tables:
```ts
// Simple relation
author: f.relation({ to: "users", required: true, onDelete: "cascade" })

// Many-to-many through join table
services: f.relation({
  to: "services",
  hasMany: true,
  through: "barberServices",    // join table collection name
  sourceField: "barber",        // FK on join table pointing to this collection
  targetField: "service",       // FK on join table pointing to target
})

// Lazy reference (avoids circular imports between collections)
barber: f.relation({ to: () => barbers })
```

`f.upload()` — field-level upload (references an upload collection):
```ts
avatar: f.upload({
  to: "assets",              // target upload collection (default: "assets")
  mimeTypes: ["image/*"],    // allowed MIME types
  maxSize: 5_000_000,        // max file size in bytes
  multiple: false,           // single or multi upload
})
```

`f.object()` / `f.array()` — nested structured fields:
```ts
// Object — flattened into multiple DB columns
workingHours: f.object({
  label: "Working Hours",
  fields: () => ({            // function or plain object
    monday: f.object({ fields: () => ({ isOpen: f.boolean(), start: f.time(), end: f.time() }) }),
    // ...
  }),
})

// Array — stored as JSONB
socialLinks: f.array({
  label: "Social Links",
  of: f.object({ fields: () => ({ platform: f.select({ options: [...] }), url: f.url() }) }),
  maxItems: 5,
  localized: true,           // stored in i18n table
})
```

Common config across all fields:
```ts
f.text({
  label: string | { en: string, sk: string },  // translatable label
  required: boolean,
  default: any,
  unique: boolean,
  localized: boolean,         // stored in i18n table
  virtual: sql`...`,          // computed column, not stored
  input: "optional",          // auto-generated if not provided by user
  description: string | TranslatableString,
  meta: { admin: { hidden, readOnly, disabled, compute, displayAs, placeholder, ... } },
})
```

#### 6.2 How `({ f })` Works — The Field Builder Proxy

When `.fields(({ f }) => ({ ... }))` is called:

1. A `Proxy` object is created from the field type registry (builtin + module fields)
2. `f.text` → proxy `get` handler looks up `"text"` in the registry → returns a factory function
3. `f.text({ required: true })` → calls `createFieldDefinition(textFieldDef, { required: true })` → returns a `FieldDefinition`
4. The returned object `{ title: FieldDefinition, slug: FieldDefinition, ... }` becomes `fieldDefinitions`
5. Each `FieldDefinition` also produces a Drizzle column via `.toColumn()` → stored in `fields`
6. Localized fields are separated into `localized`
7. Virtual fields (SQL expressions) are separated into `virtuals`
8. Relations are collected as `_pendingRelations`, resolved during `.build()`

#### 6.3 How Module Fields Extend the Proxy

Modules can add new field types. The mechanism is **declaration merging on `BuiltinFields`**:

```ts
// @questpie/admin — augmentation
declare module "questpie" {
  interface BuiltinFields {
    richText: typeof richTextField;
    blocks: typeof blocksField;
  }
}
```

When `@questpie/admin` is a dependency and imported (codegen ensures this), TypeScript merges these declarations. The `f` proxy type becomes `BuiltinFields & { richText, blocks }` — `f.richText()` just works in any collection file.

At runtime, the codegen-generated `createApp()` merges field registries from all modules:

```ts
// .generated/index.ts
const mergedFields = {
  ...builtinFields,           // core 16 types
  ...adminModule.fields,      // richText, blocks
  // ...other module fields
};
```

This merged registry is passed to `createFieldBuilder()` when resolving collection field definitions.

#### 6.4 Custom Field Definition

A field type is defined using the `field()` factory:

```ts
import { field } from "questpie";

export const myCustomField = field<MyConfig, MyValue>({
  name: "myField",
  
  // Drizzle column factory
  toColumn: (config) => varchar("column_name", { length: 255 }),
  
  // Zod validation schema
  toZodSchema: (config) => z.string().min(1),
  
  // Query operators
  operators: [equals, notEquals, contains],
  
  // Introspection metadata
  getMetadata: (config) => ({
    type: "myField",
    ...config,
  }),
});
```

Operators are created with the `operator()` factory:

```ts
import { operator } from "questpie";

export const contains = operator<string>({
  name: "contains",
  apply: (column, value) => ilike(column, `%${value}%`),
  schema: z.string(),
});
```

#### 6.5 FieldDefinition State

Each `FieldDefinition` has this internal state:

```ts
interface FieldDefinitionState {
  name: string;               // field type name ("text", "richText", etc.)
  config: BaseFieldConfig;    // user-provided config (label, required, default, etc.)
  fieldDef: FieldDef;         // the field type definition (toColumn, operators, etc.)
  location: FieldLocation;    // "main" | "localized" | "virtual"
}
```

`BaseFieldConfig` (common to all fields):

```ts
interface BaseFieldConfig {
  label?: string | TranslatableString;
  required?: boolean;
  default?: any;
  unique?: boolean;
  localized?: boolean;        // → moves to i18n table
  virtual?: SQL;              // → computed column, not stored
  hidden?: boolean;           // admin UI only
  readOnly?: boolean;         // admin UI only
  meta?: {
    admin?: {
      hidden?: ReactiveHandler;
      readOnly?: ReactiveHandler;
      disabled?: ReactiveHandler;
      compute?: { handler, deps, debounce };
    };
  };
}
```

---

### 7. Functions (Renamed from RPC)

#### 7.1 File Convention — Nested Folders = Nested Routes

```
functions/
├── search.ts                    → functions.search
├── contact.ts                   → functions.contact
└── admin/
    ├── stats.ts                 → functions.admin.stats
    └── users/
        ├── export.ts            → functions.admin.users.export
        └── import.ts            → functions.admin.users.import
```

#### 7.2 Function Definition

Each file exports a default function definition. No `rpc()` factory, no `r.fn()` — just a plain object:

```ts
// functions/search.ts
import { z } from "zod";

export default {
  schema: z.object({
    query: z.string(),
    limit: z.number().optional().default(10),
  }),
  handler: async ({ input, app, session }) => {
    const results = await app.search.query(input.query, { limit: input.limit });
    return { results };
  },
  access: ({ session }) => !!session,
};
```

```ts
// functions/admin/users/export.ts
import { z } from "zod";

export default {
  schema: z.object({ format: z.enum(["csv", "json"]) }),
  handler: async ({ input, app }) => {
    const users = await app.api.collections.user.find({});
    // ... export logic
    return { data: exported, contentType: "text/csv" };
  },
  access: ({ session }) => session?.user.role === "admin",
  // Raw response mode (returns Response instead of JSON)
  raw: true,
};
```

#### 7.3 Function Definition Shape

```ts
interface FunctionDefinition<TInput, TOutput> {
  // Input validation (Zod schema)
  schema?: z.ZodSchema<TInput>;
  
  // Handler — receives typed input + context
  handler: (ctx: {
    input: TInput;
    app: App;        // auto-typed via declaration merging
    session: Session | null;
    req: Request;
  }) => Promise<TOutput>;
  
  // Access control
  access?: (ctx: { session: Session | null; app: App }) => boolean | Promise<boolean>;
  
  // If true, handler returns a raw Response object
  raw?: boolean;
}
```

#### 7.4 Generated Router Type

Codegen produces a nested type from the directory structure:

```ts
// .generated/index.ts (partial)
export interface AppFunctions {
  search: typeof import("../functions/search").default;
  contact: typeof import("../functions/contact").default;
  admin: {
    stats: typeof import("../functions/admin/stats").default;
    users: {
      export: typeof import("../functions/admin/users/export").default;
      import: typeof import("../functions/admin/users/import").default;
    };
  };
}
```

On the client, this enables typed calls: `client.functions.admin.users.export({ format: "csv" })`.

#### 7.5 Route Handler — `createFetchHandler` Without `appRpc`

Today the route handler passes a separate `appRpc` alongside `app`:

```ts
// BEFORE (current — separate rpc)
import { app, appRpc } from "~/questpie/server/app";
const handler = createFetchHandler(app, { basePath: "/api", rpc: appRpc });
```

After the rename, **functions live on the `app` instance** — codegen assembles them into `app.functions`. The `rpc` option is removed:

```ts
// AFTER — functions are on app, no separate rpc
import { app } from "~/questpie/.generated";
import { createFetchHandler } from "questpie";

const handler = createFetchHandler(app, { basePath: "/api" });
```

`createFetchHandler` internally:
1. Routes `/api/collections/*`, `/api/globals/*`, `/api/auth/*`, `/api/storage/*`, `/api/stream` as before.
2. Routes `/api/functions/*` using `app.functions` — path segments map to nested keys (e.g. `/api/functions/admin/stats` → `app.functions.admin.stats`).
3. No separate `rpc` option needed — the handler gets everything from the `app` instance.

**OpenAPI integration** stays the same wrapper pattern:

```ts
// AFTER — withOpenApi wraps createFetchHandler identically
import { withOpenApi } from "@questpie/openapi";
import { createFetchHandler } from "questpie";
import { app } from "~/questpie/.generated";

const handler = withOpenApi(
  createFetchHandler(app, { basePath: "/api" }),
  {
    app,
    basePath: "/api",
    info: {
      title: "Barbershop API",
      version: "1.0.0",
      description: "QUESTPIE API for the Barbershop example",
    },
    scalar: { theme: "purple" },
  },
);
```

Note: `withOpenApi` no longer needs `rpc` — it introspects `app.functions` directly to generate the spec.

**Framework adapters** (`@questpie/elysia`, `@questpie/hono`, `@questpie/next`) continue to wrap `createFetchHandler` — no API change beyond removing `rpc`.

---

### 8. Jobs

#### 8.1 File Convention

```ts
// jobs/send-newsletter.ts
import { z } from "zod";

export default {
  schema: z.object({
    postId: z.string(),
  }),
  handler: async ({ payload, app }) => {
    const post = await app.api.collections.posts.findById(payload.postId);
    // ... send email logic
  },
  // Optional: schedule as cron job
  schedule: "0 9 * * MON", // every Monday at 9am
  // Optional: retry config
  retry: { attempts: 3, delay: 5000 },
};
```

#### 8.2 Job Definition Shape

```ts
interface JobDefinition<TPayload> {
  schema?: z.ZodSchema<TPayload>;
  handler: (ctx: {
    payload: TPayload;          // matches current runtime (NOT "input")
    app: App;
  }) => Promise<void>;
  schedule?: string;           // cron expression
  retry?: { attempts?: number; delay?: number };
}
```

---

### 9. Auth

#### 9.1 File Convention

```ts
// auth.ts
import type { AuthConfig } from "questpie";

export default {
  // Better Auth options
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
  // Admin auth options (roles, etc.)
  admin: {
    defaultRole: "user",
    roles: ["admin", "editor", "user"],
  },
} satisfies AuthConfig;
```

#### 9.2 Auth Merge

Modules provide base auth options. User's `auth.ts` is deep-merged on top:

```
starterModule.auth  →  adminModule.auth  →  user auth.ts
                    (deep merge)         (deep merge)
```

The merge uses `mergeAuthOptions()` — recursively merges objects, arrays are concatenated, primitives are last-wins.

---

### 10. Messages / i18n

#### 10.1 File Convention

```ts
// messages/en.ts
export default {
  "posts.published": "Published",
  "posts.draft": "Draft",
  "errors.notFound": "Resource not found",
  "errors.unauthorized": "You must be logged in",
};
```

```ts
// messages/sk.ts
export default {
  "posts.published": "Publikované",
  "posts.draft": "Koncept",
  "errors.notFound": "Zdroj nebol nájdený",
  "errors.unauthorized": "Musíte byť prihlásený",
};
```

#### 10.2 Message Key Types

Codegen extracts all keys and generates a union type:

```ts
// .generated/index.ts (partial)
export type AppMessageKeys =
  | "posts.published"
  | "posts.draft"
  | "errors.notFound"
  | "errors.unauthorized"
  | StarterModuleMessageKeys  // from modules
  | AdminModuleMessageKeys;
```

This gives type-safe `app.t("posts.published")` calls.

#### 10.3 Message Merge

```
starterModule.messages → adminModule.messages → user messages/*.ts
                       (deep merge per locale) (deep merge per locale)
```

Later messages override same keys in same locale. User messages always win.

---

### 11. Blocks & Rich Text (Admin Plugin)

Blocks and `richText` are both part of the admin plugin — they're not core field types. The admin module registers:
- **`richText`** field type — uses blocks internally for structured content
- **`blocks`** field type — standalone block-based content
- **`blocks/` directory** discovery — codegen plugin scans for user-defined block definitions

Neither is available without `@questpie/admin`.

#### 11.1 File Convention

```ts
// blocks/hero.ts
import { block } from "@questpie/admin";

export default block("hero")
  .fields(({ f }) => ({
    heading: f.text({ required: true, localized: true }),
    subheading: f.textarea({ localized: true }),
    backgroundImage: f.upload(),
    ctaText: f.text({ label: "CTA Button Text", localized: true }),
    ctaLink: f.text({ label: "CTA Link" }),
    height: f.select({ options: ["small", "medium", "large", "full"], defaultValue: "medium" }),
  }))
  .admin(({ c }) => ({
    label: "Hero Banner",
    icon: c.icon("ph:image"),
    description: "Full-width hero section",
    category: {                          // block category for grouping in picker UI
      label: { en: "Sections", sk: "Sekcie" },
      icon: c.icon("ph:layout"),
      order: 1,
    },
  }))
  .allowChildren(0)
  .prefetch(async ({ values, app }) => {
    // app is auto-typed — no circular dep!
    return {};
  });
```

#### 11.2 No Circular Dependencies

Today blocks need the `BaseCMS` pattern to avoid circular imports. With codegen, the import graph is one-directional:

```
.generated/index.ts → imports blocks/hero.ts
blocks/hero.ts → does NOT import .generated/index.ts
blocks/hero.ts → app comes from context ({ app })
```

Zero circular dependencies. The `app` is always provided in the prefetch/hook context.

---

### 12. `config()` — Full API

```ts
// questpie.config.ts
import { config } from "questpie";
import { admin, audit } from "@questpie/admin/server";
import { s3Driver } from "@questpie/storage-s3";
import { smtpAdapter } from "questpie";
import { pgBossAdapter } from "questpie";

export default config({
  // Modules (order matters — later overrides earlier)
  modules: [
    admin({ branding: { name: "My App" } }),
    audit({ retentionDays: 30 }),
  ],

  // Sidebar — composable, merged with module contributions (see §5.8)
  // Callback receives scoped { s, c } proxies
  sidebar: ({ s, c }) => ({
    sections: [
      s.section({ id: "content", title: "Content" }),
    ],
    items: [
      s.item({ sectionId: "content", type: "collection", collection: "posts", icon: c.icon("ph:article") }),
      s.item({ sectionId: "content", type: "collection", collection: "categories", icon: c.icon("ph:tag") }),
    ],
  }),

  // Dashboard — composable, merged with module contributions (see §5.8)
  // Callback receives scoped { d, c, a } proxies
  dashboard: ({ d, c, a }) => ({
    title: "My App Dashboard",
    actions: [
      a.create({ id: "new-post", collection: "posts", label: "New Post", icon: c.icon("ph:plus"), variant: "primary" }),
    ],
    sections: [
      d.section({ id: "overview", label: "Overview", layout: "grid", columns: 4 }),
    ],
    items: [
      d.stats({ sectionId: "overview", id: "total-posts", collection: "posts", label: "Published", filter: { isPublished: true }, span: 1 }),
      d.recentItems({ sectionId: "overview", id: "recent-posts", collection: "posts", limit: 5, dateField: "createdAt", span: 2 }),
    ],
  }),

  // Runtime — environment-dependent values
  app: { url: process.env.APP_URL! },
  db: { url: process.env.DATABASE_URL! },
  secret: process.env.SECRET_KEY,

  // Optional adapters
  storage: { driver: s3Driver({ bucket: "my-app", region: "eu-central-1" }) },
  email: { adapter: smtpAdapter({ host: "smtp.example.com", port: 587 }) },
  queue: { adapter: pgBossAdapter() },
  search: createPostgresSearchAdapter(),

  // Content localization — supports both string shorthand and rich objects
  locale: {
    locales: [
      { code: "en", label: "English", fallback: true, flagCountryCode: "us" },
      { code: "sk", label: "Slovenčina" },
    ],
    defaultLocale: "en",
  },

  // Admin UI localization — from @questpie/admin ConfigExtensions, NOT core
  adminLocale: {
    locales: ["en", "sk"],
    defaultLocale: "en",
  },

  // Default access control (applied when collection/global doesn't define its own)
  defaultAccess: {
    read: ({ session }) => !!session,
    create: ({ session }) => !!session,
    update: ({ session }) => !!session,
    delete: ({ session }) => !!session,
  },

  // Global lifecycle hooks (fire for ALL collections/globals)
  hooks: {
    collections: [
      async ({ operation, collection, app }) => {
        // audit logging, etc.
      },
    ],
  },

  // Auto-migrate on startup
  autoMigrate: process.env.NODE_ENV === "development",

  // CLI
  cli: {
    migrations: { directory: "./src/migrations" },
    seeds: { directory: "./src/seeds" },
  },
});
```

#### 12.1 Config Shape

```ts
interface QuestpieConfig {
  // Modules
  modules?: Module[];
  
  // Runtime (required)
  app: { url: string };
  db: { url: string } | { client: DrizzleClient };
  secret?: string;
  
  // Adapters (optional)
  storage?: StorageConfig;
  email?: { adapter: MailerAdapter; defaults?: MailerDefaults };
  queue?: { adapter: QueueAdapter };
  search?: SearchAdapter;
  realtime?: RealtimeConfig;
  logger?: LoggerConfig;
  kv?: KVConfig;
  
  // Settings (core)
  locale?: LocaleConfig;           // locales: (string | { code, label?, fallback?, flagCountryCode? })[]
  defaultAccess?: CollectionAccess;
  hooks?: GlobalHooksState;
  
  // Composable sidebar/dashboard — callbacks, merged across modules (see §5.8)
  // Added by @questpie/admin via ConfigExtensions declaration merging
  // sidebar?: (ctx: { s: SidebarProxy; c: ComponentProxy }) => SidebarContribution;
  // dashboard?: (ctx: { d: DashboardProxy; c: ComponentProxy; a: ActionProxy }) => DashboardContribution;
  // adminLocale?: AdminLocaleConfig;
  // branding?: BrandingConfig;
  
  // Startup behavior
  autoMigrate?: boolean;
  autoSeed?: boolean | SeedCategory | SeedCategory[];
  
  // CLI
  cli?: {
    migrations?: { directory?: string };
    seeds?: { directory?: string };
  };
}
```

---

### 13. `module()` — Full API

#### 13.1 Module as Data Object

A module is a plain data object — no builder chain, no type accumulation. Each module's collections, globals, etc. are defined in their own files within the package and hand-assembled into the `module()` call.

#### 13.2 Starter Module (`packages/questpie`)

Internal file layout:

```
packages/questpie/src/server/modules/starter/
├── index.ts                        # module() entry — exports starter()
├── collections/
│   ├── user.ts                     # core user collection (auth fields only)
│   ├── assets.ts                   # core assets collection (storage)
│   ├── session.ts                  # better-auth session
│   ├── account.ts                  # better-auth account
│   ├── verification.ts            # better-auth verification
│   └── apikey.ts                   # API key collection
├── jobs/
│   └── realtime-cleanup.ts        # realtime session cleanup
├── auth/
│   └── index.ts                    # core auth options (better-auth base config)
├── migrations/
│   └── *.ts                        # core schema migrations
└── messages/
    └── en.ts                       # core backend messages (error keys, etc.)
```

Definition:

```ts
// packages/questpie/src/server/modules/starter/index.ts
import { module } from "questpie";

import { userCollection } from "./collections/user";
import { assetsCollection } from "./collections/assets";
import { sessionCollection } from "./collections/session";
import { accountCollection } from "./collections/account";
import { verificationCollection } from "./collections/verification";
import { apikeyCollection } from "./collections/apikey";
import { realtimeCleanupJob } from "./jobs/realtime-cleanup";
import { coreAuthOptions } from "./auth";
import { starterMigrations } from "./migrations";
import { coreMessages } from "./messages/en";

export const starter = () => module({
  name: "questpie-starter",

  collections: {
    user: userCollection,
    assets: assetsCollection,
    session: sessionCollection,
    account: accountCollection,
    verification: verificationCollection,
    apikey: apikeyCollection,
  },
  globals: {},
  jobs: {
    realtimeCleanup: realtimeCleanupJob,
  },
  functions: {},
  fields: {},                         // no extra field types — core has builtins only
  auth: coreAuthOptions,
  migrations: starterMigrations,
  messages: { en: coreMessages },
  defaultAccess: {
    read: ({ session }) => !!session,
    create: ({ session }) => !!session,
    update: ({ session }) => !!session,
    delete: ({ session }) => !!session,
  },
});
```

Example of a starter collection — minimal, no admin UI config:

```ts
// packages/questpie/src/server/modules/starter/collections/user.ts
import { collection } from "questpie";

export const userCollection = collection("user")
  .fields(({ f }) => ({
    name: f.text({ label: "Name", required: true }),
    email: f.email({ label: "Email", required: true }),
    emailVerified: f.boolean({ label: "Email Verified", default: false }),
    image: f.url({ label: "Image" }),
    role: f.select({ label: "Role", options: ["admin", "editor", "user"], default: "user" }),
  }))
  .options({ timestamps: true })
  .access({
    read: ({ session }) => !!session,
    create: ({ session }) => session?.user.role === "admin",
    update: ({ session, id }) => session?.user.role === "admin" || session?.user.id === id,
    delete: ({ session }) => session?.user.role === "admin",
  });
```

#### 13.3 Admin Module (`packages/admin`)

Internal file layout:

```
packages/admin/src/server/modules/admin/
├── index.ts                        # module() entry — exports admin()
├── augmentation.ts                 # declare module "questpie" (types)
├── patch.ts                        # monkey-patch .admin(), .list(), .form() etc.
├── collections/
│   ├── user.ts                     # admin user (extends starter's user with .admin()/.list()/.form())
│   ├── assets.ts                   # admin assets (extends starter's assets)
│   ├── saved-views.ts             # admin-internal: saved list views
│   ├── preferences.ts             # admin-internal: user preferences
│   └── locks.ts                    # admin-internal: document locks
├── fields/
│   ├── rich-text.ts               # richText field definition (column, operators, metadata)
│   └── blocks.ts                   # blocks field definition
├── views/
│   ├── list/
│   │   ├── table.ts               # "table" list view definition (config schema, column handling)
│   │   └── kanban.ts              # "kanban" list view definition
│   └── edit/
│       └── form.ts                # "form" edit view definition (config schema, layout rules)
├── components/
│   ├── icon.ts                    # "icon" component definition (reference shape)
│   ├── badge.ts                   # "badge" component definition
│   └── chip.ts                    # "chip" component definition
├── functions/
│   └── *.ts                        # admin API functions (introspection, etc.)
├── plugins/
│   └── admin-plugin.ts            # codegen plugin (discovers blocks/)
├── migrations/
│   └── *.ts                        # admin schema migrations
└── messages/
    ├── en.ts                       # admin UI messages (English)
    └── sk.ts                       # admin UI messages (Slovak)
```

Definition:

```ts
// packages/admin/src/server/modules/admin/index.ts
import { module } from "questpie";
import { starter } from "questpie";         // re-uses starter as dependency

// Side-effect imports — patch builder prototypes + augment types
import "./augmentation";
import "./patch";

import { adminUserCollection } from "./collections/user";
import { adminAssetsCollection } from "./collections/assets";
import { savedViewsCollection } from "./collections/saved-views";
import { preferencesCollection } from "./collections/preferences";
import { locksCollection } from "./collections/locks";
import { richTextField } from "./fields/rich-text";
import { blocksField } from "./fields/blocks";
import { tableListView } from "./views/list/table";
import { kanbanListView } from "./views/list/kanban";
import { formEditView } from "./views/edit/form";
import { iconComponent } from "./components/icon";
import { badgeComponent } from "./components/badge";
import { chipComponent } from "./components/chip";
import { adminFunctions } from "./functions";
import { adminPlugin } from "./plugins/admin-plugin";
import { adminMigrations } from "./migrations";
import { adminMessagesEn } from "./messages/en";
import { adminMessagesSk } from "./messages/sk";

// Re-export starter collections for .admin() overrides
import { sessionCollection } from "questpie/starter";
import { accountCollection } from "questpie/starter";
import { verificationCollection } from "questpie/starter";
import { apikeyCollection } from "questpie/starter";

export type AdminOptions = {
  branding?: BrandingConfig;
};

export const admin = (options?: AdminOptions) => module({
  name: "questpie-admin",

  // Starter is a dependency — resolved first, admin overrides it
  modules: [starter()],

  collections: {
    // Override starter's user & assets with admin UI config
    user: adminUserCollection,
    assets: adminAssetsCollection,
    // Hide auth-internal collections from admin sidebar
    session: sessionCollection.admin({ hidden: true }),
    account: accountCollection.admin({ hidden: true }),
    verification: verificationCollection.admin({ hidden: true }),
    apikey: apikeyCollection.admin({ hidden: true }),
    // Admin-internal collections
    adminSavedViews: savedViewsCollection,
    adminPreferences: preferencesCollection,
    adminLocks: locksCollection,
  },
  globals: {},
  jobs: {},
  functions: adminFunctions,

  // ── Server-side registries ────────────────────────────────

  // Field types — extends the f proxy
  fields: {
    richText: richTextField,          // f.richText() — structured rich content
    blocks: blocksField,              // f.blocks() — standalone block content
  },

  // List view types — extends the v proxy in .list()
  listViews: {
    table: tableListView,             // v.table({ columns, searchable, ... })
    kanban: kanbanListView,           // v.kanban({ groupBy, columns, ... })
  },

  // Edit view types — extends the v proxy in .form()
  editViews: {
    form: formEditView,               // v.form({ fields, sidebar, ... })
  },

  // Component types — extends the c proxy in .admin(), .actions(), sidebar, dashboard
  components: {
    icon: iconComponent,              // c.icon("ph:article") → { type: "icon", props: { name: "ph:article" } }
    badge: badgeComponent,            // c.badge({ label: "New", color: "green" })
    chip: chipComponent,              // c.chip({ label: "Draft", variant: "outline" })
  },

  // ── Config contributions ──────────────────────────────────

  auth: {},
  migrations: adminMigrations,
  messages: {
    en: adminMessagesEn,
    sk: adminMessagesSk,
  },

  // ── Composable sidebar/dashboard (§5.8) ────────────────
  // Admin contributes its own sections + items.
  // Other modules (audit) and user config add to the same sections.

  sidebar: ({ s, c }) => ({
    sections: [
      s.section({ id: "administration", title: { key: "defaults.sidebar.administration" } }),
    ],
    items: [
      s.item({ sectionId: "administration", type: "collection", collection: "user", icon: c.icon("ph:users") }),
      s.item({ sectionId: "administration", type: "collection", collection: "assets", icon: c.icon("ph:image") }),
    ],
  }),

  branding: options?.branding,

  // Codegen plugin — discovers blocks/ directory
  plugins: [adminPlugin()],
});
```

Example of admin extending a starter collection — adds `.admin()`, `.list()`, `.form()`:

```ts
// packages/admin/src/server/modules/admin/collections/user.ts
import { userCollection } from "questpie/starter";

export const adminUserCollection = userCollection
  .admin(({ c }) => ({
    label: "Users",
    icon: c.icon("ph:users"),
    group: "settings",
  }))
  .list(({ v, f, a }) => v.table({
    columns: [f.name, f.email, f.role, f.emailVerified],
    searchable: [f.name, f.email],
    defaultSort: { field: f.name, direction: "asc" },
    actions: {
      row: [a.delete],
      bulk: [a.deleteMany],
    },
  }))
  .form(({ v, f }) => v.form({
    fields: [f.name, f.email, f.role, f.image],
    sidebar: {
      position: "right",
      fields: [f.emailVerified],
    },
  }));
```

#### 13.4 Audit Module (`packages/admin` — Third-Party Module Example)

The audit module demonstrates a simpler module that depends on admin. It adds an `adminAuditLog` collection, a cleanup job, and global lifecycle hooks:

```ts
// packages/admin/src/server/modules/audit/index.ts
import { module, collection } from "questpie";
import { auditLogCollection } from "./collections/audit-log";
import { createCollectionAuditHooks, createGlobalAuditHooks } from "./hooks";
import { auditCleanupJob } from "./jobs/audit-cleanup";

export interface AuditOptions {
  /** Days to retain audit logs. @default 90 */
  retentionDays?: number;
}

export const audit = (options?: AuditOptions) => module({
  name: "questpie-audit",

  collections: {
    adminAuditLog: auditLogCollection,
  },
  jobs: {
    auditCleanup: auditCleanupJob,
  },

  // Global hooks — fire for ALL collections/globals
  hooks: {
    collections: {
      afterChange: [createCollectionAuditHooks().afterChange],
      afterDelete: [createCollectionAuditHooks().afterDelete],
    },
    globals: {
      afterChange: [createGlobalAuditHooks().afterChange],
    },
  },

  // Composable sidebar — adds audit log to admin's "administration" section
  sidebar: ({ s }) => ({
    items: [
      s.item({ sectionId: "administration", type: "collection", collection: "adminAuditLog" }),
    ],
  }),

  // Composable dashboard — contributes audit timeline widget
  dashboard: ({ d }) => ({
    sections: [
      d.section({ id: "activity", label: { key: "audit.dashboard.activity" }, layout: "grid", columns: 4 }),
    ],
    items: [
      d.timeline({
        sectionId: "activity",
        id: "audit-recent-activity",
        label: { key: "audit.widget.recentActivity.title" },
        maxItems: options?.maxItems ?? 10,
        showTimestamps: true,
        timestampFormat: "relative",
        span: 2,
        loader: async ({ app }) => {
          const result = await app.api.collections.adminAuditLog.find({
            limit: options?.maxItems ?? 10,
            sort: { createdAt: "desc" },
            accessMode: "system",
          });
          return result.docs.map((row) => ({
            id: row.id,
            title: `${row.userName} ${row.action}d ${row.resource}`,
            timestamp: row.createdAt,
            variant: row.action === "delete" ? "error" : row.action === "create" ? "success" : "info",
          }));
        },
      }),
    ],
  }),

  migrations: [],     // audit table migration
  messages: {
    en: {
      "audit.widget.recentActivity.title": "Recent Activity",
      "audit.widget.recentActivity.empty": "No recent activity",
      "audit.dashboard.activity": "Activity",
    },
  },
});
```

Usage in `questpie.config.ts`:

```ts
modules: [
  admin({ branding: { name: "My App" } }),
  audit({ retentionDays: 30 }),
],
```

Collections with `audit: false` in their `.options()` are automatically skipped by the audit hooks. Internal admin collections (preferences, locks, saved views) already set this.

#### 13.5 Module Shape

```ts
interface Module {
  name: string;
  
  // Dependencies (other modules)
  modules?: Module[];
  
  // What this module contributes — entities
  collections?: Record<string, CollectionBuilder | Collection>;
  globals?: Record<string, GlobalBuilder | Global>;
  jobs?: Record<string, JobDefinition>;
  functions?: Record<string, FunctionDefinition>;
  
  // What this module contributes — server-side registries
  fields?: Record<string, FieldDef>;                   // extends f proxy: f.richText(), f.blocks()
  listViews?: Record<string, ListViewDefinition>;       // extends v proxy in .list(): v.table(), v.kanban()
  editViews?: Record<string, EditViewDefinition>;       // extends v proxy in .form(): v.form()
  components?: Record<string, ComponentDefinition>;     // extends c proxy: c.icon(), c.badge(), c.chip()
  
  // Composable sidebar/dashboard (§5.8) — callbacks resolved at module() time
  sidebar?: (ctx: { s: SidebarProxy; c: ComponentProxy }) => SidebarContribution;
  dashboard?: (ctx: { d: DashboardProxy; c: ComponentProxy; a: ActionProxy }) => DashboardContribution;
  branding?: BrandingConfig;
  adminLocale?: AdminLocaleConfig;
  
  // Config contributions
  auth?: Partial<AuthConfig>;
  migrations?: Migration[];
  messages?: Record<string, Record<string, string>>;  // { en: { key: value }, sk: { ... } }
  defaultAccess?: CollectionAccess;
  
  // Codegen extension
  plugins?: CodegenPlugin[];
}
```

These server-side registries are **metadata definitions** — they describe what types exist and what config shapes they accept. The actual React rendering components are registered separately on the client side (out of scope for this RFC).

| Registry | Server (module contributes) | Client (AdminBuilder renders) |
|----------|---------------------------|-------------------------------|
| `fields` | Column type, operators, validation, metadata | React field editor component |
| `listViews` | Config schema, column handling, sort/filter logic | React list renderer (table rows, kanban cards) |
| `editViews` | Config schema, field layout, sidebar rules | React form renderer |
| `components` | Reference shape `{ type, props }` | React component (Icon, Badge, Chip) |

#### 13.6 Module Content Can Follow File Convention Too

A module package can internally use the same file convention. Its `module()` call can auto-import from its own `collections/`, `globals/`, etc. directories. This is not mandatory — modules can also be hand-assembled — but it means the same structure scales from user projects to framework packages.

#### 13.7 Module Merge Order

Modules are resolved depth-first, left-to-right:

```
config.modules: [admin()]
  admin.modules: [starter()]
    starter has no modules
    → starter resolved first
  → admin resolved second (overrides starter)
→ user files resolved last (override everything)
```

Merge rules per key:

| Key             | Strategy                                                        |
| --------------- | --------------------------------------------------------------- |
| `collections`   | Spread-merge, later wins                                        |
| `globals`       | Spread-merge, later wins                                        |
| `jobs`          | Spread-merge, later wins                                        |
| `functions`     | Spread-merge, later wins                                        |
| `fields`        | Spread-merge, later wins                                        |
| `listViews`     | Spread-merge, later wins                                        |
| `editViews`     | Spread-merge, later wins                                        |
| `components`    | Spread-merge, later wins                                        |
| `sidebar`       | Sections dedup by id (later wins), items concatenated (§5.8.3)  |
| `dashboard`     | Sections dedup by id, items concatenated, metadata last wins    |
| `auth`          | Deep-merge (recursive)                                          |
| `migrations`    | Concatenate (all kept)                                          |
| `messages`      | Deep-merge per locale (later wins per key)                      |
| `defaultAccess` | Last wins                                                       |
| `branding`      | Last wins                                                       |
| `adminLocale`   | Last wins                                                       |
| `plugins`       | Concatenate (all applied)                                       |

**User code always wins over modules.**

---

### 14. Codegen Plugins

#### 14.1 Plugin Interface

```ts
interface CodegenPlugin {
  name: string;
  
  // Register additional directories to scan
  discover?: {
    // key → glob patterns relative to questpie root
    [stateKey: string]: string | string[];
  };
  
  // Hook: called after all files are discovered, before code is generated
  transform?: (ctx: CodegenContext) => void;
}

interface CodegenContext {
  // All discovered items
  collections: Map<string, DiscoveredFile>;
  globals: Map<string, DiscoveredFile>;
  jobs: Map<string, DiscoveredFile>;
  functions: Map<string, DiscoveredFile>;
  messages: Map<string, DiscoveredFile>;
  
  // Plugin-discovered items (keyed by stateKey from discover)
  custom: Map<string, Map<string, DiscoveredFile>>;
  
  // Add/modify generated code
  addImport(name: string, path: string): void;
  addTypeDeclaration(code: string): void;
  addRuntimeCode(code: string): void;
  set(key: string, value: any): void;   // runtime config values
}
```

#### 14.2 Admin Plugin Example

```ts
function adminPlugin(options?: AdminOptions): CodegenPlugin {
  return {
    name: "questpie-admin",
    
    // Discover blocks (admin-specific)
    discover: {
      blocks: ["blocks/*.ts", "features/*/blocks/*.ts"],
    },
    
    transform(ctx) {
      // Generate AppBlocks type from discovered blocks
      const blocks = ctx.custom.get("blocks");
      if (blocks?.size) {
        // Add block registrations to the runtime createApp() call
        // Add AppBlocks interface to generated types
      }
      
      // Apply inline options
      if (options?.sidebar) {
        ctx.set("sidebar", options.sidebar);
      }
      if (options?.dashboard) {
        ctx.set("dashboard", options.dashboard);
      }
      if (options?.branding) {
        ctx.set("branding", options.branding);
      }
    },
  };
}
```

Future plugins could add `workflows/`, `webhooks/`, `cron/`, etc. — all without changing core.

---

### 15. Codegen — What Gets Generated

#### 15.1 Complete `.generated/index.ts` Example

For a project with:
- `admin()` module
- 2 user collections (posts, categories)
- 1 user global (siteSettings)
- 1 user job (sendNewsletter)
- 2 user functions (search, admin/stats)
- 1 block (hero)
- 2 message locales (en, sk)
- auth.ts

```ts
/* eslint-disable */
// AUTO-GENERATED by questpie codegen — DO NOT EDIT
// Regenerate with: questpie generate

import { createApp, type Questpie, type MergeAuth } from "questpie/runtime";

// ── Modules ────────────────────────────────────────────────
import { admin } from "@questpie/admin";
const _adminModule = admin({/* options from config */});
// Resolved dependency chain: starter → admin
const _starterModule = _adminModule.modules![0]!;

// ── User Collections ───────────────────────────────────────
import _coll_posts from "../collections/posts";
import _coll_categories from "../collections/categories";

// ── User Globals ───────────────────────────────────────────
import _glob_siteSettings from "../globals/site-settings";

// ── User Auth ──────────────────────────────────────────────
import _userAuth from "../auth";

// ── User Jobs ──────────────────────────────────────────────
import _job_sendNewsletter from "../jobs/send-newsletter";

// ── User Functions ─────────────────────────────────────────
import _fn_search from "../functions/search";
import _fn_admin_stats from "../functions/admin/stats";

// ── Blocks (admin plugin) ──────────────────────────────────
import _block_hero from "../blocks/hero";

// ── Messages ───────────────────────────────────────────────
import _msg_en from "../messages/en";
import _msg_sk from "../messages/sk";

// ── Config ─────────────────────────────────────────────────
import _rawConfig from "../questpie.config";

// ════════════════════════════════════════════════════════════
// TYPES — composed from typeof references (zero inference cost)
// ════════════════════════════════════════════════════════════

/** All collections in the app (modules + user, user wins) */
export interface AppCollections {
  // From questpie-starter
  assets: (typeof _starterModule)["collections"]["assets"];
  session: (typeof _starterModule)["collections"]["session"];
  account: (typeof _starterModule)["collections"]["account"];
  verification: (typeof _starterModule)["collections"]["verification"];
  apikey: (typeof _starterModule)["collections"]["apikey"];
  // From questpie-admin (overrides starter where same key)
  user: (typeof _adminModule)["collections"]["user"];
  adminSavedViews: (typeof _adminModule)["collections"]["adminSavedViews"];
  adminPreferences: (typeof _adminModule)["collections"]["adminPreferences"];
  adminLocks: (typeof _adminModule)["collections"]["adminLocks"];
  // User collections (override modules where same key)
  posts: typeof _coll_posts;
  categories: typeof _coll_categories;
}

/** All globals in the app */
export interface AppGlobals {
  siteSettings: typeof _glob_siteSettings;
}

/** All jobs in the app */
export interface AppJobs {
  realtimeCleanup: (typeof _starterModule)["jobs"]["realtimeCleanup"];
  sendNewsletter: typeof _job_sendNewsletter;
}

/** All functions in the app (nested structure from directory layout) */
export interface AppFunctions {
  search: typeof _fn_search;
  admin: {
    stats: typeof _fn_admin_stats;
  };
  // Module functions are flat-merged
  // (admin module's functions go here too)
}

/** All blocks in the app */
export interface AppBlocks {
  hero: typeof _block_hero;
}

/** Auth config — deep merge of all modules + user */
export type AppAuth = MergeAuth<
  (typeof _starterModule)["auth"],
  (typeof _adminModule)["auth"],
  typeof _userAuth
>;

/** Message keys — union of all keys from all locales and modules */
export type AppMessageKeys =
  | keyof typeof _msg_en
  | keyof typeof _msg_sk;
  // | module message keys...

/** The fully typed Questpie app */
export type App = Questpie<{
  name: "my-app";
  collections: AppCollections;
  globals: AppGlobals;
  jobs: AppJobs;
  functions: AppFunctions;
  blocks: AppBlocks;
  auth: AppAuth;
  messageKeys: AppMessageKeys;
}>;

// ════════════════════════════════════════════════════════════
// RUNTIME — create and register the app instance
// ════════════════════════════════════════════════════════════

export const app: App = createApp({
  collections: {
    ..._starterModule.collections,
    ..._adminModule.collections,
    posts: _coll_posts,
    categories: _coll_categories,
  },
  globals: {
    siteSettings: _glob_siteSettings,
  },
  jobs: {
    ..._starterModule.jobs,
    sendNewsletter: _job_sendNewsletter,
  },
  functions: {
    ..._adminModule.functions,
    search: _fn_search,
    "admin.stats": _fn_admin_stats,
  },
  blocks: {
    hero: _block_hero,
  },
  fields: {
    ..._starterModule.fields,
    ..._adminModule.fields,
  },
  auth: _rawConfig.auth ?? {},
  userAuth: _userAuth,
  messages: {
    en: _msg_en,
    sk: _msg_sk,
  },
  moduleMessages: [_starterModule.messages, _adminModule.messages],
  defaultAccess: _rawConfig.defaultAccess ?? _adminModule.defaultAccess,
  migrations: [
    ...(_starterModule.migrations ?? []),
    ...(_adminModule.migrations ?? []),
  ],
  hooks: _rawConfig.hooks,
}, _rawConfig);

```

#### 15.2 What Codegen Does NOT Generate

- Collection/global/job/function definitions — those stay in user files
- Business logic of any kind
- Migration files
- Seed files

Codegen only generates the **wiring layer**: imports, type composition, `createApp()` call, and type exports.

---

### 16. CLI Commands

| Command                     | Description                                                 |
| --------------------------- | ----------------------------------------------------------- |
| `questpie generate`         | Run codegen once — produces `.generated/index.ts`           |
| `questpie dev`              | Watch mode — regenerates on file add/remove, config changes |
| `questpie migrate:generate` | Generate migration (uses `.generated/index.ts`)             |
| `questpie migrate`          | Run pending migrations                                      |
| `questpie seed`             | Run seeds                                                   |
| `questpie seed:generate`    | Generate seed template                                      |

#### 16.1 Watch Mode Granularity

| Change                                                 | Action                                               |
| ------------------------------------------------------ | ---------------------------------------------------- |
| File added/removed in `collections/`, `globals/`, etc. | Regenerate `.generated/index.ts`                     |
| File content modified                                  | **No regeneration** — `typeof import(...)` is stable |
| `questpie.config.ts` modified                          | Full regeneration                                    |
| Module options changed                                 | Full regeneration                                    |

---

### 17. AI/Agentic Discoverability

The file convention is designed for trivial navigation by AI agents:

| Task                   | Method                                                 |
| ---------------------- | ------------------------------------------------------ |
| Find a collection      | `glob **/collections/posts.ts`                         |
| List all collections   | `glob **/collections/*.ts`                             |
| Find a feature's scope | `ls features/blog/`                                    |
| Find all endpoints     | `glob **/functions/**/*.ts` (path = route)             |
| Find blocks            | `glob **/blocks/*.ts`                                  |
| Understand app shape   | Read `.generated/index.ts`                             |
| Add a collection       | Create file in `collections/`, run `questpie generate` |
| Add a field            | Edit the one collection file                           |

**No semantic analysis needed.** Glob + grep is sufficient for any task.

---

### 18. Migration Path from Current Architecture

#### 18.1 Manual Steps

1. **Split `app.ts`** — Extract each collection into `collections/*.ts`, globals into `globals/*.ts`
2. **Create `questpie.config.ts`** — Move runtime config from `.build()` call + module list
3. **Move auth config** — Extract to `auth.ts`
4. **Move messages** — Extract to `messages/en.ts`, `messages/sk.ts`
5. **Move jobs** — Extract to `jobs/*.ts`
6. **Move RPC functions** — Extract to `functions/*.ts` (nested as needed)
7. **Delete `builder.ts`** — No `qb` builder needed
8. **Delete `app.ts`** — Replaced by `.generated/index.ts`
9. **Replace `app` imports** — Import from `.generated/index.ts` for scripts/routes, use context `({ app })` in hooks/functions
10. **Run `questpie generate`**

#### 18.2 Codemod

A `questpie migrate-to-conventions` codemod automates this by:
- Parsing the builder chain in `app.ts`
- Extracting collection/global/job definitions into separate files
- Generating `questpie.config.ts` from `.build()` params
- Updating imports across the project

#### 18.3 Backward Compatibility

`QuestpieBuilder` and all old APIs (`q()`, `.use()`, `.build()`, `rpc()`, `r.fn()`, positional `(f) =>`) are **fully removed** in Phase 6. There is no deprecation period — the old code is deleted. New `create-questpie` templates use the file convention exclusively.

---

## Validation Report (vs `examples/tanstack-barbershop`)

### Gaps — Barbershop patterns not covered by RFC

| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| G1 | `auditModule` — third-party modules beyond admin | Medium | RFC only shows `admin()`. Need: `config({ modules: [admin(), audit()] })` |
| G2 | Dashboard `loader` pattern — async data fetching in widgets | High | Barbershop has `loader: async ({ app }) => {...}` for value/progress/timeline widgets. RFC dashboard section doesn't mention loaders. |
| G3 | Dashboard `a.create()`, `a.global()` action helpers | High | `({ d, c, a })` context — `a` proxy for dashboard actions is missing from RFC |
| G4 | Dashboard widget type taxonomy: `value`, `progress`, `chart`, `timeline`, `stats` (filtered), `recentItems`, `section` grouping | High | RFC only shows `d.stats()`, `d.recentItems()`, `d.custom()` |
| G5 | Block `category` in `.admin()` | Low | Barbershop uses `category: sections(c)` with `BlockCategoryConfig`. Not shown in RFC block example. |
| G6 | `defaultValue` vs `default` in block field config | Low | Blocks use `defaultValue`, `BaseFieldConfig` says `default`. May be block-specific variant. |
| G7 | Rich locale objects `{ code, label, fallback, flagCountryCode }` in `.locale()` | Medium | RFC uses string arrays `["en", "sk"]`. Barbershop uses rich objects. |
| G8 | Relation `through`, `sourceField`, `targetField` (many-to-many join tables) | Low | RFC only shows simple `f.relation({ to })`. The feature exists, just not documented. |
| G9 | Relation `onDelete: "cascade"` | Low | Not shown in RFC examples. Feature exists. |
| G10 | `f.upload()` field-level options: `to`, `mimeTypes`, `maxSize`, `multiple` | Low | RFC documents `.upload()` collection-level. Field-level `f.upload()` config underdocumented. |
| G11 | `input: "optional"` field config | Low | Allows omitting a required field (auto-generated). Not in `BaseFieldConfig`. |
| G12 | Lazy relation reference `to: () => barbers` | Low | Avoids circular imports. RFC only shows string references. |
| G13 | OpenAPI `withOpenApi()` integration with functions | Medium | RFC doesn't mention OpenAPI. Route handler API unspecified after RPC removal. |
| G14 | Seed file convention | Low | RFC mentions `cli.seeds.directory` but no file convention. |
| G15 | `f.object()` / `f.array()` sub-field patterns | Low | `fields: () => ({})` vs `fields: {}`. Complex nested field config not documented. |

### Mismatches — RFC says one thing, barbershop does another

| # | Mismatch | Impact | Resolution |
|---|----------|--------|------------|
| M1 | `.fields((f) =>` → `.fields(({ f }) =>` | All 7 collections + 1 global + 16 blocks | Mechanical find-replace. Part of the plan. |
| M2 | `qb.collection()` → `collection()` standalone import | All collection files | Import change. |
| M3 | `qb.global()` → `global()` standalone import | 1 global file | Import change. |
| M4 | `qb.block()` → `block()` from `@questpie/admin` | 16 block definitions | Import change. |
| M5 | `q.job({name, schema, handler})` → plain object default export | 3 jobs → 3 files | Split + restructure. |
| M6 | `rpc<App>()` + `r.fn()` + `r.router()` → plain objects in `functions/*.ts` | 4 functions + rpc.ts | Full restructure. |
| M7 | `f.datetime()` vs `f.dateTime()` | 2 usages | **Needs clarification** — which is the runtime name? |
| M8 | Hook context: `{ data }` vs `{ doc }`, single fn vs array | Hooks in 2 collections | **Needs decision** — keep current names or rename? |
| M9 | Job handler `{ payload }` vs `{ input }` | 3 jobs | **Needs decision** — rename or keep? |
| M10 | `.branding()` on builder → `admin({ branding })` in config | 1 location | Relocate to config. |
| M11 | `.locale()` rich objects vs RFC string arrays | 1 location | **RFC needs to support rich locale objects.** |
| M12 | Block prefetch context `{ values, ctx }` vs `{ values, app }` | Multiple blocks | **Needs decision** — flatten `ctx.app` to `app`? |
| M13 | Global name `"site_settings"` (snake) vs key derivation `siteSettings` (camel) | 1 global | Name passed to `global()` is the DB slug. Filename key derivation is separate. |
| M14 | `typedApp<App>(app)` → auto-typed context | 3 usages | Remove wrapper, rely on generated types. |

### Unknowns — Decisions needed before implementation

| # | Question | Proposed Answer |
|---|----------|----------------|
| U1 | How does route handler get functions after `appRpc` is removed? | `createFetchHandler(app)` — functions are on the `app` instance. Codegen puts them there. |
| U2 | How does `app` get typed in hooks without `typedApp<App>()`? | Codegen generates `App` type. `Questpie` class is generic. Hooks receive `app: App` from the runtime which already knows the type. |
| U3 | Multiple jobs/functions per file → split to 1 per file? | Yes. `jobs/send-appointment-confirmation.ts`, `jobs/send-appointment-cancellation.ts`, etc. |
| U4 | `auditModule` — how does it plug in? | `config({ modules: [admin(), audit()] })` — top-level module. |
| U5 | `f.datetime()` canonical name? | Check runtime. If `datetime` is the alias, keep it. RFC table should match. |
| U6 | Collection/global name vs filename key derivation? | `collection("barbers")` — first arg is the DB slug. Filename `barbers.ts` must match. Codegen validates `name === derivedKey`. |
| U7 | Sidebar/dashboard — inline in `admin()` or separate files? | Both. Inline for simple, `sidebar.ts` / `dashboard.ts` for complex. |

---

## Implementation Phases

Applied against `examples/tanstack-barbershop` as the reference migration target.

### Phase 0 — RFC Fixes (before any code)

Fix the gaps identified in the validation report:

- [x] Document dashboard widget types (value, progress, chart, timeline, stats, recentItems, section)
- [x] Document dashboard `loader` pattern and `a` (action) proxy
- [x] Support rich locale objects in config `locale` shape
- [x] Document `f.upload()` field-level options (to, mimeTypes, maxSize, multiple)
- [x] Document relation `through`/`sourceField`/`targetField`
- [x] Document block `category` in `.admin()`
- [x] Clarify `f.datetime()` vs `f.dateTime()` against runtime → `f.datetime()` (lowercase)
- [x] Clarify hook context property names → `{ data, original }` in hooks, `{ payload }` in jobs
- [x] Clarify block prefetch context → `{ values, app }` (flattened)
- [x] Document how `createFetchHandler` works without `appRpc` → §7.5
- [x] Add `audit()` module example to config → §13.4

### Phase 1 — Core: `collection()` / `global()` standalone factories

**Goal:** Make `collection("name")` and `global("name")` work as standalone imports from `"questpie"` — no `qb.` prefix needed. `CollectionBuilder` and `GlobalBuilder` stay 100% unchanged internally.

**Changes in `packages/questpie`:**
- [ ] Export `collection()` factory function from `questpie` — wraps `new CollectionBuilder({ name })`
- [ ] Export `global()` factory function from `questpie` — wraps `new GlobalBuilder({ name })`
- [ ] Change `.fields()` callback signature from `(f) =>` to `({ f }) =>` (breaking)
- [ ] Keep old `(f) =>` as deprecated overload during transition
- [ ] Tests: verify `collection("posts").fields(({ f }) => ...).hooks(...)` produces identical state to `qb.collection("posts").fields((f) => ...)`

**Barbershop migration (this phase):**
- [ ] `collections/barbers.ts`: `qb.collection("barbers")` → `collection("barbers")`, `.fields((f) =>` → `.fields(({ f }) =>`
- [ ] Same for all 6 collections + 1 global
- [ ] Remove `import { qb } from "./builder"` from collection/global files
- [ ] Add `import { collection } from "questpie"` / `import { global } from "questpie"`

**Commit:** `feat: add standalone collection()/global() factories, update fields callback signature`

### Phase 2 — Core: `block()` standalone factory

**Goal:** `block("name")` from `@questpie/admin` works standalone.

**Changes in `packages/admin`:**
- [ ] Export `block()` factory function from `@questpie/admin`
- [ ] Change `.fields()` callback from `(f) =>` to `({ f }) =>`

**Barbershop migration:**
- [ ] `blocks.ts` → split into `blocks/*.ts` (1 file per block, 16 files)
- [ ] Each block: `qb.block("hero")` → `block("hero")` from `@questpie/admin`
- [ ] Update `.fields()` callbacks

**Commit:** `feat: add standalone block() factory, split barbershop blocks to individual files`

### Phase 3 — Core: Job and Function plain object format

**Goal:** Jobs and functions are plain objects with `default` exports. No `q.job()` or `r.fn()` factories needed.

**Changes in `packages/questpie`:**
- [ ] Define `JobDefinition` and `FunctionDefinition` interfaces (already exist internally, just export)
- [ ] `createApp()` accepts plain objects for jobs/functions
- [ ] Keep `q.job()` and `r.fn()` as deprecated wrappers that return plain objects
- [ ] Functions become part of `app.functions` — accessible via `createFetchHandler(app)`

**Barbershop migration:**
- [ ] `jobs/index.ts` (3 jobs) → split into `jobs/send-appointment-confirmation.ts`, `jobs/send-appointment-cancellation.ts`, `jobs/send-appointment-reminder.ts`
- [ ] Each: `q.job({ name, schema, handler })` → `export default { schema, handler }`
- [ ] `functions/index.ts` + `functions/booking.ts` → `functions/get-active-barbers.ts`, `functions/get-revenue-stats.ts`, `functions/get-available-time-slots.ts`, `functions/create-booking.ts`
- [ ] Each: `r.fn({ schema, handler })` → `export default { schema, handler }`
- [ ] Delete `rpc.ts`
- [ ] Remove `typedApp<App>(app)` — `app` is directly typed in context

**Commit:** `feat: support plain object job/function definitions, split barbershop jobs and functions`

### Phase 4 — Core: `config()` factory and `module()` refactor

**Goal:** Replace `QuestpieBuilder.build()` with `config()` + `createApp()`. Modules become `module()` data objects.

**Changes in `packages/questpie`:**
- [ ] Export `config()` factory function — validates and returns config object
- [ ] Export `module()` factory function — validates and returns module object
- [ ] `createApp()` accepts config + discovered entities (prepared for codegen)

**Changes in `packages/admin`:**
- [ ] `adminModule` → `admin()` function returning `module({...})`
- [ ] `auditModule` → `audit()` function returning `module({...})`
- [ ] Move sidebar/dashboard from builder plugins to `admin()` options / `ConfigExtensions`

**Barbershop migration:**
- [ ] Create `questpie.config.ts` with full config shape (modules, db, app, storage, email, queue, locale, adminLocale, branding — moved from `app.ts .build()`)
- [ ] Move `auth.ts` config from builder chain to standalone file
- [ ] Move messages to `messages/en.ts`, `messages/sk.ts`
- [ ] Move sidebar config to `admin({ sidebar })` in config or keep as standalone file
- [ ] Move dashboard config similarly
- [ ] Delete `builder.ts`
- [ ] Delete `app.ts`

**Commit:** `feat: add config()/module() factories, migrate barbershop to new config shape`

### Phase 5 — Codegen: `.generated/index.ts`

**Goal:** CLI generates the app entrypoint from file convention discovery.

**Changes in `packages/questpie`:**
- [ ] Implement `questpie generate` CLI command
- [ ] File discovery: scan `collections/*.ts`, `globals/*.ts`, `jobs/*.ts`, `functions/**/*.ts`, `blocks/*.ts`, `messages/*.ts`, `auth.ts`, `questpie.config.ts`
- [ ] Feature layout support: also scan `features/*/collections/*.ts` etc.
- [ ] Key derivation: `send-newsletter.ts` → `sendNewsletter`
- [ ] Conflict detection: duplicate keys → error
- [ ] Module resolution: depth-first merge
- [ ] Template generation: imports, types (`typeof` references), `createApp()`, `App` type export
- [ ] Codegen plugin API: `CodegenPlugin` interface, admin plugin discovers `blocks/`

**Changes in `packages/questpie` (CLI):**
- [ ] `questpie dev` — watch mode, regenerate on file add/remove
- [ ] Update `questpie migrate:generate` to use `.generated/index.ts`

**Barbershop migration:**
- [ ] Add `.generated/` to `.gitignore`
- [ ] Run `questpie generate` — produces `.generated/index.ts`
- [ ] Update route handler: `import { app } from "./questpie/.generated"` + `createFetchHandler(app)`
- [ ] Update worker: `import { app } from "./questpie/.generated"`
- [ ] Update client: `import type { App } from "./questpie/.generated"`
- [ ] Update admin builder: `import type { App } from "./questpie/.generated"`
- [ ] Verify: `bun run build`, `bun run check-types`, all routes work

**Commit:** `feat: implement codegen CLI, migrate barbershop to generated entrypoint`

### Phase 6 — Removal & Cleanup

**Goal:** **Fully remove** old APIs (not just deprecate), update docs, update `create-questpie` templates.

> **Important:** Deprecated code will be **deleted**, not kept with `@deprecated` annotations. The old builder chain pattern, RPC factories, and positional callback signatures are removed entirely. This is a clean break — there is no transition period where both APIs coexist.

- [ ] **Delete** `QuestpieBuilder` class, `q()` factory, `.use()`, `.build()` methods
- [ ] **Delete** `q.job()` factory
- [ ] **Delete** `rpc()`, `r.fn()`, `r.router()` — entire RPC module
- [ ] **Delete** `(f) =>` positional overload in `.fields()` (only `({ f }) =>` remains)
- [ ] **Delete** `createFetchHandler` `rpc` option — functions are always on `app`
- [ ] Remove all internal usages of deleted APIs in `packages/questpie` and `packages/admin`
- [ ] Update `create-questpie` templates to use file convention exclusively
- [ ] Update `apps/docs` documentation
- [ ] Update `AGENTS.md` with new conventions
- [ ] Run full test suite: `bun test` in `packages/questpie`
- [ ] Run barbershop example end-to-end

**Commit:** `feat!: remove QuestpieBuilder, RPC module, and positional callback signatures`

### Phase 7 — Composable Sidebar/Dashboard & Registry Pattern

**Goal:** Implement the composable sidebar/dashboard pattern (§5.8) and the typed registry pattern for components, views, and blocks (§5.7). Sidebar and dashboard move from monolithic `admin()` options to per-module contributions that `createApp()` merges.

#### Types & Registries

- [ ] Add `ComponentRegistry`, `ListViewRegistry`, `EditViewRegistry` interfaces to core (empty, augmented by admin)
- [ ] Add `SidebarContribution`, `DashboardContribution` types (§5.8.1, §5.8.2)
- [ ] Add `sidebar`, `dashboard`, `branding`, `adminLocale` as typed keys on `ModuleDefinition` (not `[key: string]` extension)
- [ ] Add `sidebar`, `dashboard` as typed keys on `AppConfig` (via `ConfigExtensions` augmentation)
- [ ] Admin module augments registries with `icon`, `badge`, `table`, `form`

#### Sidebar/Dashboard Proxy Resolution

- [ ] `module()` resolves sidebar/dashboard callbacks at call time (not identity function for these keys)
- [ ] `config()` resolves sidebar/dashboard callbacks at call time
- [ ] Proxies: `s.section()`, `s.item()` for sidebar; `d.section()`, `d.stats()`, `d.timeline()` etc. for dashboard
- [ ] `a.create()`, `a.global()`, `a.link()` for dashboard actions
- [ ] `c` proxy scoped to registered components (same as in `.admin()` callbacks)

#### Merge Logic in createApp

- [ ] Sidebar merge: sections dedup by id (later wins), items concatenated by sectionId in module order
- [ ] Dashboard merge: sections dedup by id, items concatenated, metadata (title, description, columns) last wins, actions concatenated
- [ ] Items with `position: "start"` prepended, default append
- [ ] Remove sidebar/dashboard from `EXTENSION_KEYS` hardcoded list — now first-class merge

#### Module Updates

- [ ] Update `admin()` — contribute sidebar sections+items as callback, remove old proxy resolution
- [ ] Update `audit()` — contribute sidebar item (adminAuditLog → "administration") + dashboard widget (timeline)
- [ ] Remove `createAuditDashboardWidget()` helper — audit contributes directly
- [ ] Remove `AdminOptions.sidebar`, `AdminOptions.dashboard` — sidebar/dashboard are on module/config, not admin() options

#### Migration

- [ ] Update barbershop `questpie.config.ts` — sidebar/dashboard as callbacks on config level
- [ ] Update `admin-config.ts` `getAdminConfig` — read merged sidebar/dashboard from `instance.state`
- [ ] Update `create-questpie` templates
- [ ] Update docs (`apps/docs`, `AGENTS.md`)
- [ ] Run tests, type-check, biome format

**Commit:** `feat: composable sidebar/dashboard from modules, typed registry pattern`

---

## Open Questions

1. **Should `.generated/index.ts` be committed or `.gitignore`'d?**
   - Recommendation: `.gitignore`'d, `questpie generate` as `postinstall` script

2. ~~**Sidebar/dashboard — files or inline options?**~~
   - **Resolved:** Sidebar/dashboard are composable callbacks on `module()` and `config()`. Each module contributes its own sections+items. `createApp()` merges them. See §5.8.

3. **How to handle email templates?**
   - Option: `emails/*.ts` directory, same convention as jobs.

4. **Should modules be able to use file convention internally?**
   - Yes. A module package can have its own `collections/`, `globals/`, etc. and auto-assemble.
