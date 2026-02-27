# Implementation Progress

> Tracks all implementation tasks for the **File-Convention + Codegen Architecture** described in [`RFC-FILE-CONVENTION.md`](./RFC-FILE-CONVENTION.md).
>
> Each task references the RFC section it relates to (`§N.N`) so an AI agent can jump straight to the relevant spec with a targeted read.

---

## Phase 0 — RFC Fixes (before any code)

> Fix gaps identified in the validation report. **All done.**
> See: RFC §Validation Report (line ~2380)

- [x] Document dashboard widget types — RFC §5.8
- [x] Document dashboard `loader` pattern and `a` (action) proxy — RFC §5.8
- [x] Support rich locale objects in config `locale` shape — RFC §12
- [x] Document `f.upload()` field-level options — RFC §3.4, §6.1
- [x] Document relation `through`/`sourceField`/`targetField` — RFC §6.1
- [x] Document block `category` in `.admin()` — RFC §11.1
- [x] Clarify `f.datetime()` (lowercase) — RFC §6.1
- [x] Clarify hook context `{ data, original }`, job `{ payload }` — RFC §3.2, §8.2
- [x] Clarify block prefetch context `{ values, app }` — RFC §11.1
- [x] Document `createFetchHandler` without `appRpc` — RFC §7.5
- [x] Add `audit()` module example — RFC §13.4

---

## Phase 1 — Core: `collection()` / `global()` standalone factories

> Make `collection("name")` and `global("name")` work as standalone imports from `"questpie"`. `CollectionBuilder` and `GlobalBuilder` stay 100% unchanged internally.
> See: RFC §3 (`collection()` Full API), §4 (`global()` Full API), §1.1 (Context Object Convention)

### packages/questpie changes

- [x] Export `collection()` factory function from `"questpie"` — wraps `new CollectionBuilder({ name })`
  > RFC §3.1 (Signature)
- [x] Export `global()` factory function from `"questpie"` — wraps `new GlobalBuilder({ name })`
  > RFC §4
- [x] Change `.fields()` callback signature from `(f) =>` to `({ f }) =>`
  > RFC §1.1 (Context Object Convention), §6.2 (How `({ f })` Works)
- [x] Keep old `(f) =>` as temporary overload (removed in Phase 6)
- [x] Tests: verify `collection("posts").fields(({ f }) => ...).hooks(...)` produces identical builder state to old `qb.collection("posts").fields((f) => ...)`

### Barbershop migration

- [x] `collections/barbers.ts`: `qb.collection("barbers")` → `collection("barbers")`, `.fields((f) =>` → `.fields(({ f }) =>`
- [x] Same for all 6 collections + 1 global (barbers, services, barber-services, appointments, reviews, pages, site-settings)
- [x] Remove `import { qb } from "./builder"` from all collection/global files
- [x] Add `import { collection } from "questpie"` / `import { global } from "questpie"`

### Commit

```
feat: add standalone collection()/global() factories, update fields callback signature
```

---

## Phase 2 — Core: `block()` standalone factory

> `block("name")` from `@questpie/admin` works standalone. No `qb.block()` needed.
> See: RFC §11 (Blocks & Rich Text)

### packages/admin changes

- [x] Export `block()` factory function from `@questpie/admin`
  > RFC §11.1 (File Convention)
- [x] Change `.fields()` callback from `(f) =>` to `({ f }) =>`
  > RFC §1.1

### Barbershop migration

- [x] Split `blocks.ts` (784 lines, 16 blocks) → `blocks/*.ts` (1 file per block)
  > RFC §2.1 (By-Type Layout), §11.1
- [x] Each block: `qb.block("hero")` → `block("hero")` from `@questpie/admin`
- [x] Update `.fields()` callbacks to `({ f }) =>`

### Commit

```
feat: add standalone block() factory, split barbershop blocks to individual files
```

---

## Phase 3 — Core: Job and Function plain object format

> Jobs and functions are plain objects with `default` exports. No `q.job()` or `r.fn()` factories needed.
> See: RFC §7 (Functions), §8 (Jobs)

### packages/questpie changes

- [x] Define and export `JobDefinition` interface
  > RFC §8.2 (Job Definition Shape)
- [x] Define and export `FunctionDefinition` interface
  > RFC §7.3 (Function Definition Shape)
- [x] `createApp()` accepts plain objects for jobs/functions
- [x] Keep `q.job()` and `r.fn()` as temporary wrappers that return plain objects (removed in Phase 6)
- [x] Functions become part of `app.functions` — accessible via `createFetchHandler(app)`
  > RFC §7.5 (Route Handler)

### Barbershop migration

- [x] Split `jobs/index.ts` (3 jobs) → individual files:
  - `jobs/send-appointment-confirmation.ts`
  - `jobs/send-appointment-cancellation.ts`
  - `jobs/send-appointment-reminder.ts`
  > RFC §8.1 (File Convention)
- [x] Each job: `q.job({ name, schema, handler })` → `export default job({ ... })`
  > RFC §8.2
- [x] Split `functions/index.ts` + `functions/booking.ts` → individual files:
  - `functions/get-active-barbers.ts`
  - `functions/get-revenue-stats.ts`
  - `functions/get-available-time-slots.ts`
  - `functions/create-booking.ts`
  > RFC §7.1 (File Convention — Nested Folders = Nested Routes)
- [x] Each function: `r.fn({ schema, handler })` → `export default fn({ ... })`
  > RFC §7.2
- [x] Delete `rpc.ts`
- [x] Remove `typedApp<App>(app)` — `app` is directly typed in context
  > RFC §1.2 (App Access — Always From Context)

### Commit

```
feat: support plain object job/function definitions, split barbershop jobs and functions
```

---

## Phase 4 — Core: `config()` factory and `module()` refactor

> Replace `QuestpieBuilder.build()` with `config()` + `createApp()`. Modules become `module()` data objects.
> See: RFC §12 (`config()` Full API), §13 (`module()` Full API)

### packages/questpie changes

- [x] Export `config()` factory function — validates and returns config object
  > RFC §12, §12.1 (Config Shape)
- [x] Export `module()` factory function — validates and returns module object
  > RFC §13.1, §13.5 (Module Shape)
- [x] `createApp()` accepts config + discovered entities (prepared for codegen)
  > RFC §15.1 (Complete `.generated/index.ts` Example)

### packages/admin changes

- [x] `adminModule` → `admin()` function returning `module({...})`
  > RFC §13.3 (Admin Module)
- [x] `auditModule` → `audit()` function returning `module({...})`
  > RFC §13.4 (Audit Module)
- [x] Move sidebar/dashboard from builder plugins to `admin()` options / `ConfigExtensions`
  > RFC §5.8 (Sidebar & Dashboard Configuration)

### Barbershop migration

- [x] Create `questpie.config.ts` with full config shape
  > RFC §12 — modules, db, app, storage, email, queue, locale, adminLocale, branding
- [x] Move `auth.ts` config from builder chain to config-level `auth` property
  > RFC §9 (Auth), §9.1 (File Convention)
- [x] Keep messages in `i18n/en.ts`, `i18n/sk.ts` — referenced from config via `translations`
  > RFC §10 (Messages / i18n), §10.1 (File Convention)
- [x] Move sidebar config to `admin({ sidebar })` in config
  > RFC §5.8
- [x] Move dashboard config to `admin({ dashboard })` in config
  > RFC §5.8
- [x] Delete `builder.ts` — no `qb` builder needed
- [x] Rewrite `app.ts` — uses `createApp()` with config + entities

### Commit

```
feat: add config()/module() factories, migrate barbershop to new config shape
```

---

## Phase 5 — Codegen: `.generated/index.ts`

> CLI generates the app entrypoint from file convention discovery.
> See: RFC §15 (Codegen — What Gets Generated), §16 (CLI Commands), §14 (Codegen Plugins)

### packages/questpie — codegen implementation

- [x] Implement `questpie generate` CLI command
  > RFC §16 (CLI Commands)
- [x] File discovery: scan `collections/*.ts`, `globals/*.ts`, `jobs/*.ts`, `functions/**/*.ts`, `blocks/*.ts`, `messages/*.ts`, `auth.ts`, `questpie.config.ts`
  > RFC §2.4 (Discovery Rules)
- [x] Feature layout support: also scan `features/*/collections/*.ts` etc.
  > RFC §2.2 (By-Feature Layout)
- [x] Key derivation: `send-newsletter.ts` → `sendNewsletter`
  > RFC §2.4
- [x] Conflict detection: duplicate keys → error
  > RFC §2.4
- [x] Module resolution: depth-first merge (handled by `createApp()` at runtime)
  > RFC §13.7 (Module Merge Order)
- [x] Template generation: imports, `createApp()` call, `App` type export
  > RFC §15.1 (Complete `.generated/index.ts` Example)
- [x] Codegen plugin API: `CodegenPlugin` interface, admin plugin discovers `blocks/`
  > RFC §14.1 (Plugin Interface), §14.2 (Admin Plugin Example)

### packages/questpie — CLI changes

- [x] `questpie dev` — watch mode, regenerate on file add/remove
  > RFC §16.1 (Watch Mode Granularity)
- [x] Update `loadQuestpieConfig` to auto-resolve `.generated/index.ts` for new AppConfig format
  > RFC §16

### Barbershop migration

- [x] Add `.generated/` to `.gitignore`
- [x] Run `questpie generate` — produces `.generated/index.ts`
- [x] Update `app.ts` — re-exports from `.generated/index.ts` (route handler, client, admin unchanged)
- [x] Verify: `bun run build` passes, field tests pass (78/78)

### Commit

```
feat: implement codegen CLI, migrate barbershop to generated entrypoint
```

---

## Phase 6 — Removal & Cleanup

> **Fully remove** old APIs — no deprecation period, clean delete.
> See: RFC §18.3 (Backward Compatibility)

### Deletions in packages/questpie

- [x] **Delete** `QuestpieBuilder` class, `q()` factory, `.use()`, `.build()` methods — `q` marked `@internal` (used only by admin module internals); `starterModule`, `adminModule` (server), `auditModule` builder chains removed; `admin()`, `audit()`, `starter()` functions use `module()` + `config()` pattern; `core-builder.ts` deleted
- [x] **Delete** `q.job()` factory — removed from `q` namespace (standalone `job()` remains)
- [x] **Delete** `rpc()`, `r.fn()`, `r.router()` — entire RPC module deleted (`server/rpc/`)
- [x] **Delete** `(f) =>` positional overload in `.fields()` — only `({ f }) =>` remains (done in Phase 1)
  > RFC §1.1 (Context Object Convention)
- [x] **Delete** `createFetchHandler` `rpc` option — functions are always on `app`
  > RFC §7.5 (Route Handler)

### Cleanup across all packages

- [x] Remove all internal usages of deleted APIs in `packages/questpie` and `packages/admin`
- [x] Update `create-questpie` templates to use file convention exclusively
  > RFC §2 (File Convention)
- [x] Update `apps/docs` documentation
- [x] Update `AGENTS.md` with new conventions
  > RFC §17 (AI/Agentic Discoverability)
- [x] Run full test suite: `bun test` in `packages/questpie` — 781 pass, 0 fail
- [x] Run full test suite: `bun test` in `packages/admin` — 253 pass (1 pre-existing fail)
- [x] Type check passes across monorepo (only pre-existing admin errors)
- [ ] Run barbershop example end-to-end

### Commit

```
feat!: remove QuestpieBuilder, RPC module, and positional callback signatures
```

---

## Phase 7 — Composable Sidebar/Dashboard & Typed Registry Pattern

> Move sidebar and dashboard from monolithic `admin()` options to **per-module contributions**.
> Each module contributes its own sidebar sections/items and dashboard widgets.
> `createApp()` merges contributions from all modules + user config.
> See: RFC §5.7 (Registry Pattern), §5.8 (Composable Sidebar/Dashboard), Phase 7 checklist.

### Types & Proxies

- [x] Define contribution types: `SidebarContribution`, `DashboardContribution`, `SidebarSectionDef`, `SidebarItemDef`, `DashboardSectionDef`, `DashboardItemDef`
  > RFC §5.8.1, §5.8.2
- [x] Define proxy types: `SidebarProxy`, `DashboardProxy`, `DashboardActionProxy`
  > RFC §5.8
- [x] Define callback types: `SidebarCallbackContext`, `DashboardCallbackContext`, `SidebarCallback`, `DashboardCallback`
  > RFC §5.8
- [x] Augment `ModuleDefinition` and `AppConfig` with typed sidebar/dashboard/branding/adminLocale keys
  > RFC §13.5 (Module Shape), §12.1 (Config Shape)

### Proxy Factories (packages/admin/src/server/patch.ts)

- [x] `createSidebarContributionProxy()` — creates `SidebarProxy` instances
- [x] `createDashboardContributionProxy()` — creates `DashboardProxy` instances
- [x] `createSidebarCallbackContext()` / `createDashboardCallbackContext()` — full callback contexts
- [x] `resolveSidebarCallback()` / `resolveDashboardCallback()` — resolve callback or pass-through static

### Core Merge Logic (packages/questpie/src/server/config/create-app.ts)

- [x] `mergeModuleIntoState()` — array extension keys concatenated (sidebar/dashboard contributions)
- [x] Entity extension key merging — same array concatenation support
- [x] `createApp()` step 7 — config-level contributions appended to module-level arrays

### Admin Module (packages/admin/src/server/modules/admin/index.ts)

- [x] Remove `AdminOptions.sidebar` and `AdminOptions.dashboard`
- [x] Default admin sidebar as `SidebarContribution` (administration section with users + assets)
- [x] Module stores `sidebar: [contribution]` array on module definition
- [x] Remove inline proxy resolution code (sProxy, dProxy, cProxy, aProxy)

### Audit Module (packages/admin/src/server/modules/audit/index.ts)

- [x] Auto-contribute sidebar item: audit log in "administration" section
- [x] Auto-contribute dashboard widget: audit timeline in "activity" section (opt-out via `dashboard: false`)
- [x] Remove `createAuditDashboardWidget()` helper

### Admin Config Merge (packages/admin/src/server/modules/admin/functions/admin-config.ts)

- [x] `normalizeSidebarContributions()` / `normalizeDashboardContributions()` — normalize state to contribution arrays
- [x] `mergeSidebarContributions()` — sections dedup by id, items concat by sectionId, position support
- [x] `mergeDashboardContributions()` — metadata last-wins, actions concat, sections dedup, items concat
- [x] `isLegacySidebarConfig()` / `isLegacyDashboardConfig()` — backward compatibility with builder pattern
- [x] Updated `getAdminConfig` handler to use new merge pipeline

### Exports (packages/admin/src/server/index.ts)

- [x] Export all new contribution types, proxy types, callback types
- [x] Export proxy factory functions
- [x] Remove `createAuditDashboardWidget` and `AuditDashboardWidgetOptions` exports

### Barbershop Example

- [x] Move sidebar from `admin({ sidebar })` to `config({ sidebar })` with contribution format
- [x] Move dashboard from `admin({ dashboard })` to `config({ dashboard })` with contribution format
- [x] Remove `createAuditDashboardWidget` import — audit contributes automatically

### Verification

- [x] Core package: `bun test` — 95 pass, 0 fail (integration tests)
- [x] Core package: `bun run build` — clean
- [x] Core package: `tsc --noEmit` — clean
- [x] Admin package: `tsc --noEmit` — no new errors (only pre-existing client-side issues)
- [x] Biome lint: no new warnings
- [ ] Barbershop example: end-to-end run
- [ ] Update `create-questpie` templates
- [ ] Update `apps/docs` documentation

### Commit

```
feat: composable sidebar/dashboard from modules, typed registry pattern (Phase 7)
```

---

## Phase 8 — Unified Module Architecture (RFC-MODULE-ARCHITECTURE)

> Transform modules from factory functions to static codegen-generated objects.
> Move plugins to config level, split config into runtime-only + definition.
> See: RFC-MODULE-ARCHITECTURE.md

### Phase 8.1–4: New Type System, Plugin System, Core Conventions, Codegen Templates

- [x] Created `RuntimeConfig` interface and `runtimeConfig()` factory
- [x] Created `AppDefinition` interface and `RouteDefinition` type
- [x] Updated `createApp()` with dual signature: `createApp(definition, runtime)` + legacy
- [x] Updated `DiscoverPattern` type with full resolution spec
- [x] Updated codegen discover.ts: routes core category, singles map, plugin resolution
- [x] Updated codegen template.ts: new/legacy architecture support
- [x] Added core single file discovery: locale.ts, hooks.ts, access.ts, context.ts
- [x] Added route dispatch in `createFetchHandler` at /routes/* URL pattern
- [x] Created module-template.ts for npm package codegen (.generated/module.ts)
- [x] Updated admin codegen plugin: sidebar.ts, dashboard.ts, branding.ts, admin-locale.ts, blocks

### Phase 8.5–6: Package-Level Codegen + Module Splits

- [x] **Starter module split**: collections/ (6 files), jobs/, auth.ts, access.ts, messages/, .generated/module.ts
- [x] **Audit module split**: sidebar.ts, dashboard.ts, hooks.ts (default export), .generated/module.ts
- [x] **Admin module split**: collections/ (9 files), sidebar.ts, modules.ts, fields.ts, .generated/module.ts
- [x] Export `starterModule` from packages/questpie, `adminModule`/`auditModule` from packages/admin

### Phase 8.7: Migrate Examples

- [x] **Barbershop**: modules.ts, sidebar.ts, dashboard.ts, branding.ts, admin-locale.ts, locale.ts, runtimeConfig()
- [x] **City-portal**: modules.ts, sidebar.ts, dashboard.ts, branding.ts, admin-locale.ts, locale.ts, context.ts, runtimeConfig()

### Phase 8.8: Delete Old Factory Functions

- [x] Deleted `starter()` factory from `starter.module.ts` (file removed entirely)
- [x] Deleted `admin()` factory from `packages/admin/src/server/modules/admin/index.ts` (~370 lines removed)
- [x] Deleted `audit()` factory from `packages/admin/src/server/modules/audit/index.ts` (~55 lines removed)
- [x] Removed `starter` export from `packages/questpie/src/exports/index.ts`
- [x] Removed `admin`, `audit`, `AdminOptions`, `AuditModuleOptions` exports from admin barrel files
- [x] Updated `create-questpie` template: `runtimeConfig()`, modules.ts, branding.ts, sidebar/dashboard as default exports
- [x] Updated docs landing page code snippet to use `runtimeConfig()`
- [x] Updated 30+ JSDoc comments across packages/questpie and packages/admin source files

### Verification

- [x] `tsc --noEmit` in packages/questpie — **clean** (0 errors)
- [x] `tsc --noEmit` in packages/admin — **23 pre-existing errors** (0 new)
- [x] `bun test` in packages/questpie — **781 pass, 0 fail**
- [x] Biome check — auto-fixed formatting, no new errors
- [ ] Barbershop example end-to-end
- [ ] City-portal example end-to-end
- [ ] Update documentation (.md/.mdx files) — low priority, many references remain in docs

### Commit

```
feat!: unified module architecture — static modules, delete factory functions (Phase 8)
```

---

## Phase 9 — Context-First Architecture (RFC-CONTEXT-FIRST)

> Eliminate monkey-patching, `declare module` augmentation, and the `Questpie<TConfig>` god object.
> Replace with codegen-generated typed factories, flat `AppContext`, and first-class services.
> See: Plan file `concurrent-honking-narwhal.md`

### Phase 9.1: Services Convention + Flat Context

- [x] Added `defineService()` to questpie core
- [x] Added `services` category to codegen discovery
- [x] Generated `AppContext` interface with flat typed services
- [x] `createContext()` function for scripts/standalone usage

### Phase 9.2: Codegen-Generated Typed Builders (Eliminate Monkey-Patching)

- [x] Added `CollectionBuilder.set()` generic extension point
- [x] Admin codegen plugin declares `registries` (admin, list, form, preview, actions)
- [x] Codegen generates `.generated/factories.ts` with:
  - `declare module "questpie"` augmentation for `CollectionBuilder<TState>` and `GlobalBuilder<TState>`
  - Prototype patches: `CollectionBuilder.prototype.admin = function(configOrFn) { ... }`
  - Simple factory functions: `collection()`, `global()` with proper `EmptyCollectionState` return types
- [x] Users import typed factories from `#questpie` (alias to `.generated/index.ts`)
- [x] **Key insight**: wrapper approach `(...args: any[])` destroyed generic inference; prototype patching preserves it

### Phase 9.3: Eliminate God Object

- [x] Inline `_U2I` / `_MP` type helpers in generated code (no recursive `ExtractFromModuleArray`)
- [x] `type AppX = _ModuleX & { ... }` pattern (intersection, not interface extends)
- [x] `_MP<K>` falls back to `{}` when module doesn't contribute a category (handles `never`)
- [x] `as any` casts for modules array and singles in `createApp()` (handles `as const` readonly)

### Phase 9.4: Migrate Examples + Verify

- [x] Set up `#questpie` import alias in barbershop, city-portal, create-questpie template
  - `tsconfig.json` paths: `"#questpie": ["./src/questpie/server/.generated/index.ts"]`
  - `package.json` imports: `"#questpie": "./src/questpie/server/.generated/index.ts"`
- [x] Migrated 18 files across all examples: `collection`/`global` from `"#questpie"`, other symbols from `"questpie"`
- [x] TypeScript compilation: **zero errors in generated files** across all examples
- [x] Unit tests: **248 pass, 0 fail** (questpie core)
- [x] Admin tests: **211 pass, 2 pre-existing fail** (unrelated `BlocksField` export issue)
- [x] Integration tests: 697 pass, 76 fail (all pglite infrastructure — pre-existing)

### Phase 9.5: Context-First AppContext + Proxy-Based Extensions

- [x] Created `AppContext` interface (`packages/questpie/src/server/config/app-context.ts`)
  - Empty by default, augmented via `declare module "questpie"` in generated code
  - `extractAppServices()` helper populates flat services from app instance
- [x] All handler contexts now extend `AppContext`:
  - `HookContext`, `AccessContext`, `TransitionHookContext` (collection)
  - `GlobalHookContext`, `GlobalAccessContext`, `GlobalTransitionHookContext` (global)
  - `FunctionHandlerArgs`, `FunctionAccessContext`, `RawFunctionHandlerArgs` (functions)
  - `JobHandlerArgs` (queue)
  - `BlockPrefetchContext` (admin blocks)
  - `RouteHandlerArgs` (routes)
- [x] All context creation sites use `extractAppServices()` instead of manual service spreading
- [x] Codegen template generates `declare module "questpie" { interface AppContext { ... } }` augmentation
- [x] Standalone `App` interface (extends `AppContext`) replaces `Questpie<>` in user-facing generated code
- [x] Internal `_AppInternal` type kept only for type derivation (not exported)
- [x] Replaced prototype patches with Proxy-based extensions in `factory-template.ts`:
  - Extension registry objects (`_collExt`, `_globExt`) with stateKey + resolve logic
  - Proxy wrappers (`_wrapColl`, `_wrapGlob`) intercept extension calls → `builder.set()`
  - Core builder methods pass-through and re-wrap to preserve Proxy chain
  - `declare module "questpie"` type augmentations preserved for TypeScript inference
- [x] Zero prototype mutations in generated code
- [x] TypeScript: zero errors in questpie core, 1 pre-existing error in admin (unrelated)
- [x] Unit tests: 248 pass, 0 fail

### Key Files Changed

| File | Action | Lines |
|------|--------|-------|
| `packages/questpie/src/server/config/app-context.ts` | **New** | ~50 |
| `packages/questpie/src/cli/codegen/factory-template.ts` | **Rewritten** — Proxy wrappers | ~383 |
| `packages/questpie/src/cli/codegen/template.ts` | Modified — AppContext augmentation | ~955 |
| `packages/questpie/src/server/collection/builder/types.ts` | Modified — extends AppContext | ~1020 |
| `packages/questpie/src/server/global/builder/types.ts` | Modified — extends AppContext | ~400 |
| `packages/questpie/src/server/functions/types.ts` | Modified — extends AppContext | ~200 |
| `packages/questpie/src/server/integrated/queue/types.ts` | Modified — extends AppContext | ~100 |
| `packages/admin/src/server/block/block-builder.ts` | Modified — extends AppContext | ~200 |
| `packages/questpie/src/server/collection/crud/shared/hooks.ts` | Modified — extractAppServices | ~200 |
| All context creation sites (~12 files) | Modified — extractAppServices | various |

### Phase 9.6: RFC Alignment — Remove App Type, Type AppContext (this session)

- [x] Removed `export type App = _AppInternal` from generated template — RFC §1 "No App type"
- [x] Removed `emitLegacyRuntime()` and all legacy codegen paths — modules.ts is now required
- [x] Changed AppContext augmentation from `any` to typed `_AppInternal['db']` etc.
- [x] Changed all admin client generics from `Questpie<any>` → `QuestpieApp`:
  - `packages/admin/src/client/hooks/typed-hooks.ts`
  - `packages/admin/src/exports/client.ts`
  - `packages/admin/src/client/builder/index.ts`
  - `packages/admin/src/client/utils/routes.ts`
  - `packages/admin/src/client/components/admin-link.tsx`
  - `packages/admin/src/client/hooks/use-admin-routes.ts`
  - `packages/admin/src/client/runtime/routes.ts`
  - Relation field components: `relation-picker.tsx`, `relation-select.tsx`, `relation-field.tsx`
  - `packages/admin/src/client/views/collection/auto-form-fields.tsx`
- [x] Updated barbershop user files: `App` → `AppConfig`, removed dead `App` imports
- [x] Added `generate` script to both examples (`bun questpie generate -c src/questpie/server/questpie.config.ts`)
- [x] TypeScript: **zero errors** in packages/questpie, packages/admin, examples/tanstack-barbershop
- [x] Unit tests: **248 pass, 0 fail**

---

## Quick Reference — RFC Section Index

| Section | Topic | Key decisions |
|---------|-------|---------------|
| §1.1 | Context Object Convention | `({ f }) =>` not `(f) =>` everywhere |
| §1.2 | App Access | Context `({ app })` in hooks/functions, direct import for scripts |
| §1.3 | "Functions" not "RPC" | Rename throughout |
| §2 | File Convention | by-type, by-feature, mixed layouts |
| §3 | `collection()` Full API | Standalone factory, all chain methods stay |
| §4 | `global()` Full API | Standalone factory |
| §5 | Builder Extension System | 3 layers: interfaces → declaration merging → monkey-patching |
| §5.7 | Registry Pattern | Extensible interfaces via declaration merging, `c`/`v` via callbacks |
| §5.8 | Sidebar & Dashboard | Composable contributions, section dedup, item concat, callbacks |
| §6 | Field System | 16 builtins, admin adds richText/blocks, custom fields |
| §7 | Functions | Plain objects, nested folders = nested routes |
| §7.5 | Route Handler | `createFetchHandler(app)` — no `rpc` option |
| §8 | Jobs | Plain objects, 1 file per job |
| §9 | Auth | Standalone `auth.ts` file |
| §10 | Messages / i18n | `messages/*.ts`, merge strategy |
| §11 | Blocks & Rich Text | Admin plugin fields, `block()` factory |
| §12 | `config()` | Full config shape, modules array |
| §13 | `module()` | Starter, admin, audit module definitions |
| §13.7 | Module Merge Order | Depth-first, left-to-right, user wins |
| §14 | Codegen Plugins | `CodegenPlugin` interface |
| §15 | Generated Output | Complete `.generated/index.ts` example |
| §16 | CLI Commands | `generate`, `dev`, `migrate:generate` |
| §17 | AI Discoverability | Glob + grep is sufficient |
| §18 | Migration Path | Manual steps, codemod, full removal |
