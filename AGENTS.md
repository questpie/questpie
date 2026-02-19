# AGENTS.md

Source-of-truth guidance for AI agents working in this monorepo.

## Project Snapshot

- **Monorepo**: Turborepo with **Bun** as the only package manager (`packageManager: bun@1.3.0`).
- **Language**: TypeScript + ESM across all packages.
- **Product**: QUESTPIE — application framework (core engine + adapters + config-driven admin UI).

## Workspace Layout

| Path                                                | Purpose                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/questpie`                                 | Core engine — field builders, CRUD, RPC, introspection, CLI. Exports: `questpie`, `questpie/client`, `questpie/shared`. |
| `packages/admin`                                    | Config-driven admin UI (React + Tailwind v4 + shadcn). Exports: `@questpie/admin/server`, `@questpie/admin/client`.     |
| `packages/tanstack-query`                           | TanStack Query option builders, `streamedQuery`, batch helpers.                                                         |
| `packages/openapi`                                  | OpenAPI spec generation + Scalar UI middleware (`withOpenApi`).                                                         |
| `packages/elysia`, `packages/hono`, `packages/next` | Framework adapters — thin wrappers around `createFetchHandler`.                                                         |
| `packages/create-questpie`                          | CLI scaffolder (`bunx create-questpie`). Templates live in `templates/`.                                                |
| `apps/docs`                                         | Documentation site (TanStack Start + Vite + Fumadocs). Content in `content/docs/`.                                      |
| `examples/*`                                        | Full reference implementations (tanstack-barbershop, city-portal).                                                      |

## Key Architecture

### Package Internals (questpie)

`packages/questpie/src/` is split into:

- `server/` — Collections, globals, fields, RPC, adapters, integrated services (auth, storage, queue, mailer, realtime), migration.
- `client/` — Client-side client, typed hooks.
- `shared/` — Shared types and utilities used by both sides.
- `exports/` — Public entry points (`index.ts`, `client.ts`, `shared.ts`, `cli.ts`).
- `cli/` — CLI commands (`questpie migrate`, `questpie migrate:create`).

Internal imports use the `#questpie/*` subpath alias (e.g. `#questpie/server/fields/field`).

### Server-First Split

All QUESTPIE projects follow this split:

| Layer      | Directory          | Defines                                                               |
| ---------- | ------------------ | --------------------------------------------------------------------- |
| **Server** | `questpie/server/` | Schema, fields, access control, hooks, RPC, jobs — WHAT the data does |
| **Admin**  | `questpie/admin/`  | Branding, custom renderers, client builder — HOW it renders           |
| **Routes** | `routes/`          | HTTP mounting only — no business logic                                |

### Callable Builder Pattern

The `q` builder is the entry point for all server-side config:

```ts
// builder.ts
import { q } from "questpie";
import { adminModule } from "@questpie/admin/server";
export const qb = q.use(adminModule);

// app.ts
export const app = qb
  .collections({ posts, pages })
  .globals({ siteSettings })
  .auth({ ... })
  .build({ db: { url }, app: { url }, migrations });
```

### Field Builder System

Fields are defined via a proxy-based `f` factory inside `.fields()`:

```ts
const posts = qb.collection("posts").fields((f) => ({
  title: f.text({ label: "Title", required: true }),
  content: f.richText({ label: "Content" }),
  published: f.boolean({ label: "Published", default: false }),
  category: f.select({ label: "Category", options: ["news", "blog"] }),
}));
```

Built-in field types: `text`, `number`, `boolean`, `date`, `dateTime`, `select`, `multiSelect`, `relation`, `upload`, `richText`, `json`, `slug`, `email`, `url`, `password`, `color`, `textarea`.

**Custom fields** via `field<TConfig, TValue>()` factory — see `packages/questpie/src/server/fields/field.ts`.
**Custom operators** via `operator<TValue>()` — see `packages/questpie/src/server/fields/common-operators.ts`.

### Standalone RPC

End-to-end type-safe server functions, independent from the app instance:

```ts
// rpc.ts
import { rpc } from "questpie";
export const r = rpc();

// functions/my-fn.ts
export const myFn = r.fn({
  schema: z.object({ id: z.string() }),
  handler: async ({ input, app }) => { ... },
});

// app.ts
export const appRpc = r.router({ ...adminRpc, myFn });
```

### Introspection & Component References

Server emits serializable references that the client resolves via registries:

- **Component references**: `c.icon("ph:article")`, `c.badge({ ... })` — `ComponentReference<TType, TProps>`.
- **View references**: `v.table({})`, `v.form({ sidebar, fields })` — resolved from `state.listViews` / `state.editViews`.
- **Field metadata**: Introspection API at `packages/questpie/src/server/collection/introspection.ts` emits `CollectionSchema` / `FieldSchema`.

## Registry-First Philosophy (Critical)

- **Never** hardcode admin/view/component/type names in server runtime — always derive from builder state and registered maps.
- **Fields**: resolve from `QuestpieBuilder.state.fields`.
- **Views**: resolve from `state.listViews` / `state.editViews`.
- **Components**: resolve `c.*` from `state.components`.
- **Entities**: collections/globals/jobs/queues flow from builder state, not literal names.
- Defaults are provided by module registration (`q.use(adminModule)` / `qa.use(adminModule)`), not hardcoded.
- Client resolves server-emitted `{ type, props }` references using its own registry — never assume server-only types.
- When extending builders, prefer lazy type extraction (`FieldsOf<this>`, `QuestpieStateOf<this>`) over giant mapped types.

## Development Workflow

### Commands (from repo root)

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `bun install`          | Install all workspace deps                           |
| `bun run dev`          | Start all packages in dev/watch mode (via turbo)     |
| `bun run build`        | Build all packages                                   |
| `bun run check-types`  | TypeScript type checking across the monorepo         |
| `bun test`             | Run tests (Bun test runner, migrations silenced)     |
| `bun run lint`         | Biome lint check                                     |
| `bun run lint:fix`     | Biome lint with auto-fix                             |
| `bun run format`       | Prettier format (writes)                             |
| `bun run format:check` | Prettier format check                                |
| `bun run clean`        | Remove lock files, node_modules, and build artifacts |

### Package-Specific Commands

Inside `packages/questpie`:

- `bun test` — run tests
- `bun test --watch` — watch mode
- `bun run build` — build via tsdown
- `bun run check-types` — type check

### Formatting & Linting

- **Biome** (`biome.json`): tabs for indentation, double quotes for JS/TS.
- Organize imports via Biome assist.
- Run `bunx @biomejs/biome check --write .` to fix all issues.

### Testing

- Test runner: **Bun's built-in test runner** (`bun test`).
- Tests live in `packages/questpie/test/` organized by feature:
  - `test/collection/` — CRUD, hooks, relations, uploads, field access, localization.
  - `test/fields/` — Field builder, reactive fields, type inference.
  - `test/global/` — Global settings.
  - `test/integration/` — Integration tests.
  - `test/migration/`, `test/seed/`, `test/search/`, `test/openapi/` — Feature-specific.
- Migration output is silenced in tests via `QUESTPIE_MIGRATIONS_SILENT=1`.
- Tests use `@electric-sql/pglite` for in-process PostgreSQL.

### Changesets & Publishing

- **Changesets** for versioning: `bun changeset` to create, `bun run version` to apply.
- All core packages are in a **fixed version group** (questpie, @questpie/admin, @questpie/elysia, @questpie/hono, @questpie/next, @questpie/tanstack-query).
- `@questpie/openapi` and `create-questpie` version independently.
- Examples are **ignored** by changesets.
- Publishing: `bun run release` — builds packages, applies publishConfig overrides, resolves `workspace:*`, runs `changeset publish`.

### Dependencies

- **Always check `DEPENDENCIES.md`** before adding deps — it lists pinned versions for critical packages (zod v4, drizzle-orm beta, better-auth, etc.).
- Internal deps **must** use `workspace:*`.
- Key pinned versions: `zod ^4.2.1`, `drizzle-orm 1.0.0-beta.*`, `react ^19.2.0`, `tailwindcss ^4.0.6`.

### Git Workflow

- Default branch: `main`.
- Feature branches: `feat/*`, `fix/*`, `chore/*`.
- Changesets are committed with PRs — each PR with user-facing changes should include a changeset.

## Admin UI Conventions (packages/admin)

### Component Stack

- **Primitives**: `@base-ui/react` (NOT @radix-ui).
- **Icons**: `@iconify/react` with Phosphor set (`ph:icon-name`). NOT lucide-react, NOT @phosphor-icons/react.
- **Toast**: `sonner` — `toast.error()`, `toast.success()`.
- **Adding components**: `bunx shadcn@latest add <name>` from `packages/admin`.

### API Patterns

base-ui uses `render` prop, NOT `asChild`:

```tsx
// ✅ Correct
<DialogTrigger render={<Button>Open</Button>} />

// ❌ Wrong — asChild is Radix, not base-ui
<DialogTrigger asChild><Button>Open</Button></DialogTrigger>
```

### Responsive

- `ResponsivePopover` — Popover on desktop, Drawer on mobile.
- `ResponsiveDialog` — Dialog on desktop, fullscreen Drawer on mobile.
- Hooks: `useIsMobile()`, `useIsDesktop()`, `useMediaQuery()`.

### Anti-Patterns

- ❌ Custom `<button>`/`<div>` instead of `<Button>`/`<Card>`.
- ❌ `console.error` for user errors — use `toast.error()`.
- ❌ `asChild` prop — use `render` prop.
- ❌ UI-specific fields in the database schema — admin config is UI-only.

## Blocks & Circular Dependencies

When blocks use functional `.prefetch()` that needs typed `ctx.app`, a circular dependency arises (`app.ts` → `blocks.ts` → `App` from `app.ts`). The workaround is the **BaseCMS pattern**:

```ts
// app.ts
export const baseApp = qb.collections({ ... }).globals({ ... }).auth({ ... });
export type BaseCMS = (typeof baseApp)["$inferCms"]; // ← blocks import THIS
export const app = baseApp.blocks(blocks).build({ ... });
export type App = typeof app;
```

```ts
// blocks.ts — uses type-only import of BaseCMS
import { typedApp } from "questpie";
import type { BaseCMS } from "./app";

.prefetch(async ({ values, ctx }) => {
  const app = typedApp<BaseCMS>(ctx.app);
  return { posts: (await app.api.collections.posts.find({ ... })).docs };
});
```

This is a known limitation — we're working on a more ergonomic solution. Blocks with only declarative prefetch (`{ with: { field: true } }`) don't need this pattern.

## Reactive Field System

Fields support reactive behaviors in `meta.admin`:

- **`hidden`**: Conditionally hide — `({ data }: { data: Record<string, any> }) => !data.isPublished`
- **`readOnly`**: Make read-only based on conditions.
- **`disabled`**: Disable conditionally.
- **`compute`**: Auto-compute values — `{ handler, deps, debounce }`.

All reactive handlers run **server-side** with access to `ctx.db`, `ctx.user`, `ctx.req`.

**Dynamic options** for select/relation:

```ts
city: f.relation({
  to: "cities",
  options: {
    handler: async ({ data, search, ctx }) => {
      const cities = await ctx.db.query.cities.findMany({
        where: { countryId: data.country },
      });
      return { options: cities.map((c) => ({ value: c.id, label: c.name })) };
    },
    deps: ({ data }) => [data.country],
  },
});
```

## References

- Core package README: `packages/questpie/README.md`
- Admin package README: `packages/admin/README.md`
- Admin builder guide: `packages/admin/BUILDER_GUIDE.md`
- Dependencies: `DEPENDENCIES.md`
- Documentation source: `apps/docs/content/docs/`
