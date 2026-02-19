---
"questpie": patch
"@questpie/admin": patch
"@questpie/openapi": patch
"@questpie/tanstack-query": patch
---

Remove deprecated collection/global scoped `.functions()` RPC from builders and runtime routes. RPC is now app-level only via `rpc().router(...)` on `/rpc/:path...`.

Update docs to match current behavior:
- runtime install baseline is `questpie` (add `zod`/`drizzle-orm` only when imported directly)
- explicit sidebar items are automatically excluded from the auto-generated section
- `where.RAW` now documents and supports object args with optional i18n aliases via `({ table, i18nCurrentTable, i18nFallbackTable })`

Live preview now runs only for existing collection records (edit mode with an id) and resolves preview URLs from persisted DB values instead of unsaved form state, preventing stuck loading when fields like slug are edited before save.

Relation list cells now support `meta.admin.listCell` options for richer table rendering. Setting `display: "avatarChip"` shows relation chips with avatar thumbnails, with optional `avatarField` and `labelField` dot-paths.

List view relation auto-expansion now detects nested avatar relation paths (for example `avatar.url`) and requests nested relation data so avatar chips render without manual `with` configuration.

Add upload/system field introspection (including synthetic `preview`) so assets can render preview + upload metadata reliably from schema.

Update default assets admin config to show preview in list and form sidebar.

Add real user admin actions in defaults:
- header `createUser` (name/email/password/role)
- single-item `resetPassword` (new + confirm)
- wired to Better Auth admin API calls with session bearer token

Polish user form behavior:
- email becomes read-only on existing records
- ban reason/expiry only show when banned

Improve server action client mapping/execution with real form field mapping, RPC execution, and effects handling.

Add full versions/revert parity across the stack:
- new collection/global adapter routes for versions and revert
- questpie client methods (`findVersions`, `revertToVersion`)
- tanstack-query option builders for versions/revert queries and mutations
- OpenAPI generation for versions/revert on collections and globals

Expand soft-delete and admin action UX:
- built-in admin actions now include `restore` and `restoreMany`
- list view supports persisted `includeDeleted` state and passes it to queries
- bulk toolbar supports restore-many flows

Add version history UI in admin forms with revert confirmations for collections and globals.

Panel state is now URL-driven for better shareability and navigation:
- side panels use `sidebar=...` (`history`, `view-options`, `block-library`)
- live preview mode uses `preview=true`
- legacy params remain supported for backward compatibility

Add integration test coverage for adapter versioning routes and extend package docs for the new endpoints and URL-synced panel behavior.

Add workflow stage transitions:
- `transitionStage()` CRUD method for collections and globals — validates stage, enforces transition guards, creates version snapshot without data mutation
- `access.transition` permission rule (falls back to `access.update` when not defined)
- `beforeTransition` / `afterTransition` hooks with `fromStage` and `toStage` context
- HTTP routes: `POST /:collection/:id/transition` and `POST /globals/:name/transition`
- Client SDK `transitionStage()` proxy + TanStack Query `transitionStage` mutation builder
- OpenAPI `POST` transition endpoints (generated only for workflow-enabled collections/globals)
- Admin built-in `"transition"` action with workflow metadata exposed in config
- Scheduled transitions via queue job (`scheduledAt` parameter — future dates enqueue, past dates execute immediately)

**Breaking: remove `RegisteredApp` type and `Register` interface** — The `Register` module augmentation pattern created unavoidable circular type dependencies (TS7022/TS2502) whenever `questpie.gen.ts` augmented `Register.app` with the full app type. All context types (`WidgetFetchContext`, `ServerActionContext`, `BlockPrefetchContext`, `BlocksPrefetchContext`) now use `app: any`. For typed access, use `typedApp<App>(ctx.app)` instead.

**Admin field meta augmentation** — The admin package now properly augments all questpie field meta interfaces (`TextFieldMeta`, `BooleanFieldMeta`, `SelectFieldMeta`, etc.) with `admin?: *FieldAdminMeta` via `declare module "questpie"`. Previously, using `meta: { admin: { ... } }` in field definitions caused TS2353 errors because no augmentation existed. Rich text and blocks field metas are augmented via `declare module "@questpie/admin/server"`.

**Unify admin meta types with renderer implementations** — `ObjectFieldAdminMeta`, `ArrayFieldAdminMeta`, and `UploadFieldAdminMeta` now match the properties that admin renderers actually consume:
- `ObjectFieldAdminMeta`: `wrapper`, `layout`, `columns`, `defaultCollapsed`
- `ArrayFieldAdminMeta`: `orderable`, `mode`, `layout`, `columns`, `itemLabel`, `minItems`, `maxItems`
- `UploadFieldAdminMeta`: adds `showPreview`, `editable`, `previewVariant`, `multiple`, `maxItems`, `orderable`, `layout`
- `ServerChartWidget`: adds optional `field`, `dateField` is now optional
- `ServerValueWidget`: adds optional `refreshInterval`

**Audit module is now opt-in** — `auditModule` is no longer auto-included in `adminModule`. Users must explicitly `.use(auditModule)` to enable audit logging. Export `createAuditDashboardWidget()` for wiring audit into dashboard. The audit collection has full admin UI config (`.admin()`, `.list()`, `.form()`) with a read-only table view — use `{ type: "collection", collection: "adminAuditLog" }` in sidebar.

**New `audit` option on admin config** — Set `audit: false` in `.admin()` to exclude a collection or global from audit logging. All internal admin collections already have this set.

**Remove `bindCollectionToBuilder`** — Starter module collections (user, assets) now use `.admin()`, `.list()`, `.form()` directly. The `~questpieApp` rebinding was unnecessary since admin methods are monkey-patched on the prototype.

**Fix `.admin()` / `.list()` / `.form()` crashing on standalone collections** — Component and view proxies now skip validation when no registry is available (standalone builders without `.components()` / `.listViews()` / `.editViews()`). Audit-log collection uses a new `adminCoreBuilder` with admin registries pre-configured, so it resolves `c.icon(...)`, `v.table(...)`, and `v.form(...)` correctly.

**Breaking: rename `fetchFn` → `loader` on all dashboard widget types.** Server-side interfaces (`ServerStatsWidget`, `ServerTimelineWidget`, etc.) and client-side configs (`ValueWidgetConfig`, `ProgressWidgetConfig`, etc.). The serialized flag is renamed from `hasFetchFn` to `hasLoader`.
