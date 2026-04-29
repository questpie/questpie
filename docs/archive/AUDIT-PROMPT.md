# Full Implementation Audit Prompt

> Give this prompt to a fresh AI session to audit the current implementation against the RFCs and plans.

---

## Your Role

You are a senior architect auditing a TypeScript CMS framework called **QUESTPIE**. Your job is to deeply read the codebase and verify that the **actual implementation** matches the design documents (RFCs, plans, audit specs). You must be thorough, precise, and flag every deviation — even small naming inconsistencies.

## Context

QUESTPIE is a headless CMS framework with:

- A **server** layer (collections, globals, fields, hooks, access, jobs, functions, routes, services, blocks)
- An **admin client** layer (React UI: views, fields, components, pages, widgets, blocks)
- A **codegen engine** that discovers files by convention and generates typed entrypoints
- A **plugin system** where plugins declare what categories exist, what builder extensions to add, and what codegen targets to produce
- A **module system** where modules contribute values (collections, fields, views, etc.) that are merged with user code

The project is on branch `feat/file-convention-codegen`. Recent work implemented Phases A–F and partially Phase G of `PLAN-PLUGIN-CONSISTENCY.md`.

## Design Documents to Audit Against

Read these files carefully — they are the **source of truth** for what the implementation should look like:

1. **`/PLAN-PLUGIN-CONSISTENCY.md`** — The master execution plan. Phases A–F are marked DONE. Phase G is the current focus. Contains the "Definition of Done" checklist (24 items in §13).

2. **`/AUDIT-PHASE-G.md`** — Locked design decisions for Phase G. 9 decisions covering: naming consistency (`"form"` not `"edit"`), extension defaults, view definition shape, AdminState shape, plain object factories, buildZodFromIntrospection, moduleRoot, module vs project mode template, and more.

3. **`/RFC-CONTEXT-FIRST.md`** — AppContext architecture. Empty core, everything from modules, `declare module` augmentation, `extractAppServices()`, proxy-based extensions.

4. **`/RFC-FILE-CONVENTION.md`** — File convention + codegen. Discovery rules, builder extension system (3 layers), proxy callbacks, composable sidebar/dashboard.

5. **`/RFC-PLUGIN-SYSTEM.md`** — Plugin system. `CodegenPlugin` interface, categories, extensions, module registries, singletons, type flow end-to-end.

## What to Audit

For each area below, read the relevant source files, compare against the design docs, and report:

- **PASS** — implementation matches design
- **PARTIAL** — partially implemented, list what's missing
- **FAIL** — implementation contradicts design
- **NOT STARTED** — design exists but no implementation yet

### Area 1: Plugin & Target System (Phases A–C)

**Design**: `PLAN-PLUGIN-CONSISTENCY.md` §4, §5, §6 + `RFC-PLUGIN-SYSTEM.md` §3–4

**Check**:

- [ ] `CodegenPlugin` uses target-first model (`targets: Record<string, CodegenTargetContribution>`)
- [ ] `CodegenTargetContribution` has: `root`, `outDir`, `outputFile`, `categories`, `discover`, `registries`, `transform`, `generate`, `moduleRoot`
- [ ] Target graph resolver merges contributions from multiple plugins, validates conflicts
- [ ] `runCodegen` / `generate` command processes all targets
- [ ] `generatePackageModules()` iterates ALL targets per module, uses `moduleRoot` for discovery root
- [ ] Admin plugin declares TWO targets: `server` and `admin-client`
- [ ] Admin-client target has `root: "../admin"`, `moduleRoot: "client"`, `outputFile: "client.ts"`

**Files to read**:

- `packages/questpie/src/cli/codegen/types.ts`
- `packages/questpie/src/cli/codegen/index.ts`
- `packages/questpie/src/cli/commands/codegen.ts`
- `packages/admin/src/server/plugin.ts`

### Area 2: Admin-Client Module System (Phase G — partial)

**Design**: `PLAN-PLUGIN-CONSISTENCY.md` §G.3–G.5, `AUDIT-PHASE-G.md` Decisions 5–6

**Check**:

- [ ] `modules/admin/client/.generated/module.ts` exists and contains all wrapper files (should be ~36: 18 fields, 3 views, 2 components, 5 pages, 8 widgets)
- [ ] Module is exported via `@questpie/admin/client/module` (check `package.json` exports)
- [ ] Admin-client target has `modules: "modules.ts"` in its `discover` config
- [ ] Admin-client template is GENERIC — iterates `ctx.discovered.categories` dynamically, does NOT hardcode category names
- [ ] Template handles three cases: modules only, modules + user files, user files only
- [ ] No `coreAdminModule` import anywhere in generated output or template
- [ ] `keyFromProperty` on `CategoryDeclaration` controls key emission strategy
- [ ] Views category uses `keyFromProperty: "name"` → `[_view.name]: _view`
- [ ] Other categories use static file key → `"bookingCta": _block_bookingCta`
- [ ] Barbershop example has `admin/modules.ts` that imports from `@questpie/admin/client/module`

**Files to read**:

- `packages/admin/src/server/modules/admin/client/.generated/module.ts`
- `packages/admin/src/server/modules/admin/client/index.ts`
- `packages/admin/src/server/codegen/admin-client-template.ts`
- `packages/admin/src/server/plugin.ts` (admin-client target)
- `packages/admin/package.json` (exports)
- `packages/questpie/src/cli/codegen/types.ts` (`CategoryDeclaration.keyFromProperty`)
- `examples/tanstack-barbershop/src/questpie/admin/modules.ts`
- `examples/tanstack-barbershop/src/questpie/admin/.generated/client.ts`

### Area 3: Naming Consistency — `"form"` not `"edit"` (Phase G)

**Design**: `AUDIT-PHASE-G.md` Decision 1, `PLAN-PLUGIN-CONSISTENCY.md` §G.1

**Check**:

- [ ] `ViewKindRegistry` has `list` and `form` (NOT `edit`)
- [ ] Server view definitions use `kind: "form"` (not `"edit"`)
- [ ] Client view definitions use `kind: "form"`
- [ ] View names follow `{entity-type}-{implementation}`: `collection-table`, `collection-form`, `global-form`
- [ ] Extension name on collection is `.form()` (not `.edit()`)
- [ ] Schema key is `admin.form` (not `admin.edit`)
- [ ] NO references to `kind: "edit"` anywhere in the codebase (except possibly old RFCs)
- [ ] `getViewsByKind("form")` works, no `getEditViews()` method

**Files to read**:

- `packages/admin/src/client/builder/view/view.ts` (ViewKind, ViewKindRegistry)
- `packages/admin/src/server/modules/admin/views/` (server view definitions)
- `packages/admin/src/server/modules/admin/client/views/` (client view wrappers)
- `packages/admin/src/client/builder/admin.ts` (Admin class methods)
- `packages/admin/src/server/plugin.ts` (extension names: `form` not `edit`)

### Area 4: View System — Flat Registry (Phase G)

**Design**: `PLAN-PLUGIN-CONSISTENCY.md` §G.1, `AUDIT-PHASE-G.md` Decisions 3, 8

**Check**:

- [ ] `AdminState` (or `AdminBuilderState`) has flat `views: Record<string, ViewDefinition>` — NO `listViews`/`editViews` split
- [ ] `Admin` class has `getViews()`, `getView(name)`, `getViewsByKind(kind)` — NO `getListViews()`, `getEditViews()`
- [ ] NO `defaultViews` concept anywhere
- [ ] `ViewDefinition` has: `name`, `kind`, `component`, optional `config`
- [ ] Single `view()` factory (not separate `listView()` + `editView()`)
- [ ] View-level config (showSearch, showFilters, showMeta, realtime) lives on `ViewDefinition.config` — NOT on a `defaultViews` layer

**Files to read**:

- `packages/admin/src/client/builder/admin-types.ts` (AdminBuilderState / AdminState)
- `packages/admin/src/client/builder/admin.ts` (Admin class)
- `packages/admin/src/client/builder/view/view.ts` (view factories, ViewDefinition)
- `packages/admin/src/client/views/layout/admin-router.tsx` (how views are resolved)

### Area 5: Extension Defaults (Phase G)

**Design**: `PLAN-PLUGIN-CONSISTENCY.md` §G.EXT, `AUDIT-PHASE-G.md` Decision 2

**Check**:

- [ ] `RegistryExtension` type has `defaults?: Record<string, unknown>`
- [ ] Admin plugin sets defaults: `list: { defaults: { view: "collection-table" } }`, `form: { defaults: { view: "collection-form" } }`, global form: `{ defaults: { view: "global-form" } }`
- [ ] Introspection applies extension defaults generically (not hardcoded per entity type)
- [ ] Router reads `schema.admin.list.view` / `schema.admin.form.view` directly — NO fallback logic, NO `VIEW_DEFAULTS` map, NO hardcoded view names
- [ ] Schema always has view name populated (because extension defaults ensure it)

**Files to read**:

- `packages/questpie/src/cli/codegen/types.ts` (RegistryExtension)
- `packages/admin/src/server/plugin.ts` (extension defaults)
- `packages/admin/src/server/registry-helpers.ts` or introspection files
- `packages/admin/src/client/views/layout/admin-router.tsx` (view resolution)

### Area 6: Plain Object Factories (Phase G)

**Design**: `AUDIT-PHASE-G.md` Decision 7, `PLAN-PLUGIN-CONSISTENCY.md` §G.2

**Check**:

- [ ] `view()` factory returns plain frozen object (not a builder class)
- [ ] `field()` factory returns `FieldRegistryEntry` — plain object with `name`, `component`, optional `cell`, optional `validator`
- [ ] `page()`, `widget()`, `component()` factories return plain frozen objects
- [ ] NO builder classes (`FieldBuilder`, `PageBuilder`, `WidgetBuilder`, `ListViewBuilder`, `FormViewBuilder`) in the critical path
- [ ] Same factories used by admin module wrapper files and user code — no difference

**Files to read**:

- `packages/admin/src/client/builder/view/view.ts`
- `packages/admin/src/client/builder/field/field.ts`
- `packages/admin/src/client/builder/page/page.ts`
- `packages/admin/src/client/builder/widget/widget.ts`
- `packages/admin/src/server/modules/admin/client/views/` (how module uses factories)
- `packages/admin/src/server/modules/admin/client/fields/` (how module uses factories)

### Area 7: Validation — `buildZodFromIntrospection` (Phase G)

**Design**: `AUDIT-PHASE-G.md` Decision 4, `PLAN-PLUGIN-CONSISTENCY.md` §G.2

**Check**:

- [ ] `buildZodFromIntrospection()` function exists
- [ ] Three-tier resolution: field.validator → FIELD_VALIDATORS[type] → generic introspection
- [ ] `FIELD_VALIDATORS` registry handles special cases (object, array, blocks, time, select, date, datetime, email)
- [ ] `FieldRegistryEntry` has optional `validator` for third-party fields
- [ ] Per-field `createZod` functions removed from field definitions

**Files to read**:

- `packages/admin/src/client/builder/validation.ts` or similar
- `packages/admin/src/client/builder/field/field.ts` (FieldRegistryEntry type)

### Area 8: Legacy Code Deletion (Phase G)

**Design**: `PLAN-PLUGIN-CONSISTENCY.md` §G.7

**Check**:

- [ ] `client/builder/defaults/core.ts` DELETED (contained `coreAdminModule`)
- [ ] `client/builder/defaults/starter.ts` DELETED (contained `adminModule` re-export)
- [ ] `client/builder/qa.ts` DELETED (contained `qa()` factory)
- [ ] `qa` NOT exported from `@questpie/admin/client`
- [ ] `coreAdminModule` NOT exported from `@questpie/admin/client`
- [ ] `adminModule` NOT exported from `@questpie/admin/client`
- [ ] `AdminBuilder` NOT used in `Admin.normalize()` — only accepts `Admin | plainState`
- [ ] NO `qa().use(...)` pattern anywhere in examples or templates
- [ ] `client/builder/defaults/fields.tsx` DELETED (hardcoded fields → module client files)
- [ ] `client/builder/defaults/views.ts` DELETED (hardcoded views → module client files)
- [ ] `client/builder/defaults/pages.ts` DELETED (hardcoded pages → module client files)
- [ ] `client/builder/defaults/widgets.ts` DELETED (hardcoded widgets → module client files)
- [ ] `client/builder/defaults/components.ts` DELETED (hardcoded components → module client files)
- [ ] `AdminBuilder` class DELETED or at least not in the critical path

**Files to read/verify existence**:

- `packages/admin/src/client/builder/defaults/` (check what files remain)
- `packages/admin/src/client/builder/qa.ts` (should not exist)
- `packages/admin/src/exports/client.ts` (check exports)
- `packages/admin/src/client/builder/admin.ts` (Admin.normalize)
- `packages/admin/src/client/builder/admin-builder.ts` (should be deleted or unused)

### Area 9: Router — Generic View Resolution (Phase G)

**Design**: `AUDIT-PHASE-G.md` Decision 2, `PLAN-PLUGIN-CONSISTENCY.md` §G.6

**Check**:

- [ ] NO `DEFAULT_LIST_VIEW_ID`, `DEFAULT_EDIT_VIEW_ID` constants
- [ ] NO `VIEW_DEFAULTS` map
- [ ] NO `defaultViews` usage in route handlers
- [ ] NO `hasCustomViewSpecified` special-casing for globals
- [ ] All routes use same generic pattern: `const viewName = schema.admin[operation].view`
- [ ] View config merged from `viewDef.config` + `schema.admin[operation]["~config"]`
- [ ] Kind validation: warn if resolved view's kind doesn't match route expectation

**Files to read**:

- `packages/admin/src/client/views/layout/admin-router.tsx`

### Area 10: Admin-Client Wrapper Files (Phase G)

**Design**: `PLAN-PLUGIN-CONSISTENCY.md` §G.4

**Check**:

- [ ] 3 view wrappers exist: `collection-table.ts`, `collection-form.ts`, `global-form.ts`
- [ ] 18 field wrappers (one per built-in field type)
- [ ] Component wrappers (icon, possibly badge)
- [ ] 5 page wrappers (dashboard, login, forgot-password, reset-password, setup)
- [ ] 8 widget wrappers
- [ ] All wrappers use the same factories as user code (`view()`, `field()`, `page()`, etc.)
- [ ] View wrappers carry `config` (showSearch, showMeta, etc.) on the view definition

**Files to read**:

- `packages/admin/src/server/modules/admin/client/views/`
- `packages/admin/src/server/modules/admin/client/fields/`
- `packages/admin/src/server/modules/admin/client/components/`
- `packages/admin/src/server/modules/admin/client/pages/`
- `packages/admin/src/server/modules/admin/client/widgets/`

### Area 11: Server View Definitions (Phase G)

**Design**: `PLAN-PLUGIN-CONSISTENCY.md` §G.4

**Check**:

- [ ] Server view files use `view()` factory with `kind` and `configSchema`
- [ ] 3 server views: `collection-table.ts` (kind: "list"), `collection-form.ts` (kind: "form"), `global-form.ts` (kind: "form")
- [ ] `global-form.ts` EXISTS (it was new in Phase G)
- [ ] View names match convention: `collection-table`, `collection-form`, `global-form`

**Files to read**:

- `packages/admin/src/server/modules/admin/views/`

### Area 12: Tests

**Check**:

- [ ] `packages/admin/test/server/codegen.test.ts` — tests module-based template output (no coreAdminModule)
- [ ] `packages/admin/test/builder/admin.test.ts` — tests Admin class with flat views, no AdminBuilder normalization
- [ ] `packages/admin/test/builder/qa.test.ts` DELETED
- [ ] All tests pass: `cd packages/admin && bun test test/`
- [ ] TypeScript check passes: `npx tsc --noEmit --project packages/admin/tsconfig.json` (ignoring pre-existing StarterCollections/StarterJobs errors)

### Area 13: Cross-Cutting Principles

**Design**: `RFC-CONTEXT-FIRST.md` §2–3, `RFC-PLUGIN-SYSTEM.md` §1.1, `AUDIT-PHASE-G.md` Core Principle

**Check**:

- [ ] **"Core modules = user code"** — admin module's built-in views/fields/pages/widgets use the EXACT same file conventions, factories, and codegen patterns as user code. No special internal APIs.
- [ ] **"Everything declarative, nothing imperative"** — no hardcoded maps, no if/switch for specific entity types. All defaults expressed as data.
- [ ] **"Consistent naming"** — same concept = same name across server, client, codegen, runtime. Check for synonyms (e.g., "edit" vs "form", "list" vs "table").
- [ ] **Empty core** — `packages/questpie` provides primitives, not features. No built-in fields, views, etc.
- [ ] **Proxy-based extensions** — no prototype mutation, generated `factories.ts` uses Proxy + `declare module` augmentation.

## Output Format

For each area, provide:

```
### Area N: [Name]

**Status**: PASS | PARTIAL | FAIL | NOT STARTED

**Findings**:
- [x] Item — matches design
- [ ] Item — DEVIATION: [description of what's wrong and what design says]
- [ ] Item — NOT IMPLEMENTED: [what's missing]

**Files checked**: [list of files you actually read]

**Key deviations** (if any):
1. [File:line] — Expected X per [RFC §Y], found Y instead
```

After all areas, provide:

```
## Summary

### Definition of Done Checklist (from PLAN §13)
Go through items 1–24 and mark each as done/not done.

### Critical Deviations
List the top 5 most impactful deviations from the design.

### Recommended Next Steps
Ordered list of what should be implemented next to make progress toward Phase G completion.
```

## Important Notes

- **Read actual source code**, don't guess from file names
- **Check both existence AND content** — a file existing doesn't mean it's correctly implemented
- **Look for subtle naming issues** — `"edit"` vs `"form"`, `listViews` vs `views`, `AdminBuilderState` vs `AdminState`
- **Check generated output** — read `.generated/` files to verify codegen produces correct output
- **Check exports** — verify public API matches design (no removed items still exported, no missing items)
- **Run commands if possible**: `bun test test/`, `npx tsc --noEmit`, `bun questpie generate`
- The branch has many uncommitted changes — that's expected, this is active development
