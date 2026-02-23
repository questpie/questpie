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
| §5.8 | Sidebar & Dashboard | Widget taxonomy, loader pattern, `a` proxy |
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
