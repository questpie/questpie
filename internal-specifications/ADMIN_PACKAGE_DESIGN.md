# Admin Package Design (Questpie CMS)

This document describes the admin config package: a runtime-agnostic (within
React), UI-first configuration that renders into a full admin app with strong
types, minimal verbosity, and realtime-first data.

The admin UI uses shadcn + Tailwind CSS (payload-inspired primitives). Theming
is done through Tailwind tokens and CSS variables, not through runtime themes.

---

## Goals

- Simple to use (DX first): minimal config, strong defaults, type inference.
- Runtime-agnostic config within React (Next, Vite, React Router, TanStack Start).
- UI-focused configuration: layout, labels, actions, overrides.
- Strong type safety and route helpers derived from config + CMS schema.
- Realtime by default (SSE, TanStack Query/DB) and SSR-friendly query options.
- Customizable at every level (fields, rows, lists, pages, components).

## Non-goals

- Replacing CMS schema or CRUD logic. The CMS schema is the source of truth.
- Adding a separate theme engine outside Tailwind.
- Forcing a single form library or router across renderers.

---

## Package split (MVP-first)

For MVP, keep the surface small: a single React package that exports config,
renderer, components, and hooks. Split later only if needed.

- `@questpie/admin`
  - `/config`: types + `defineAdminConfig` helper.
  - `/components`: shadcn-based primitives and defaults.
  - `/hooks`: data fetching, form helpers, list helpers.
  - `/utils`: route helpers, i18n helpers, registry helpers.
- `@questpie/tanstack-query`
  - Query options, realtime sync, SSR-friendly helpers.
- `@questpie/cms` client
  - Used directly (no extra admin-data-client abstraction in MVP).

Future split (optional, only if demand grows):
- `@questpie/admin-config`, `@questpie/admin-runtime`, `@questpie/admin-renderer-react`


---

## Design principles (DX first)

- Map-based config for type inference.
- Smart defaults (field lists, filters, sort, layout).
- Explicit overrides are small and local.
- Custom pages and components can be defined lazily.

---

## Core config API (map-based)

```ts
type AdminConfig<CMS, Cmp = unknown> = {
  app: AdminAppConfig;
  collections: AdminCollectionMap<CMS, Cmp>;
  globals?: AdminGlobalMap<CMS, Cmp>;
  pages?: AdminPageMap<Cmp>;
  components?: AdminComponentRegistry<Cmp>;
  i18n?: AdminI18nConfig;
};

export const defineAdminConfig =
  <CMS, Cmp = unknown>() =>
  (cfg: AdminConfig<CMS, Cmp>) =>
    cfg;
```

### Composability

```ts
const admin = defineAdminConfig<typeof cms>()(
  mergeAdminConfigs([coreAdmin, postsAdmin, productsAdmin])
);
```

---

## App config

```ts
type AdminAppConfig = {
  brand?: {
    name?: I18nText;
    logo?: ComponentRef;
    homeRoute?: string;
  };
  sidebar?: AdminSidebarConfig;
  locales?: AdminLocalesConfig;
  authUI?: AdminAuthUIConfig;
  theme?: AdminThemeConfig; // Tailwind tokens only
  preview?: {
    enabled?: boolean;
    route?: string; // default: /preview/:id
  };
  debug?: {
    showQueryDevtools?: boolean;
    showRouterDevtools?: boolean;
  };
};
```

---

## Collections (UI config only)

```ts
type AdminCollectionConfig<CMS, K extends keyof CMS["collections"], Cmp> = {
  label?: I18nText;
  description?: I18nText;
  icon?: IconRef;
  group?: string;
  list?: AdminListConfig<CMS, K, Cmp>;
  edit?: AdminEditConfig<CMS, K, Cmp>;
  fields?: AdminFieldOverrides<CMS, K, Cmp>;
  actions?: AdminActionsConfig<CMS, K, Cmp>;
  permissions?: AdminPermissionConfig;
  routes?: AdminCollectionRoutesOverride;
};
```

Note: CMS schema defines data, validation, relations. Admin config defines UI.

---

## Field overrides

```ts
type AdminFieldOverride = {
  label?: I18nText;
  description?: I18nText;
  helperText?: I18nText;
  visible?: AdminVisibilityCondition;
  readOnly?: boolean | AdminVisibilityCondition;
  component?: ComponentRef;
  list?: { hidden?: boolean; width?: number; renderCell?: ComponentRef };
  edit?: { hidden?: boolean; section?: string; tab?: string; sidebar?: boolean };
};
```

Defaults are inferred from CMS schema:
- Field type (string, number, relation, array, etc).
- Required, unique, indexed.
- Localized (if `localized: true`).

---

## List view

Defaults:
- Columns from CMS schema (displayable fields).
- Sort by `createdAt` desc if present.
- Filter builder from queryable fields.
- Saved filters are stored in backend collection, not in config.

```ts
type AdminListConfig = {
  view?: "table" | "grid" | "tree";
  columns?: AdminColumnMap;
  defaultSort?: { field: string; order: "asc" | "desc" };
  search?: AdminSearchConfig;
  filterBuilder?: AdminFilterBuilderConfig;
  savedViews?: Array<{
    id: string;
    label: I18nText;
    filters: Where;
    sort?: OrderBy;
    default?: boolean;
  }>;
  rowActions?: AdminRowActions;
  bulkActions?: AdminBulkActions;
  orderable?: boolean;
  tree?: AdminTreeConfig;
};
```

---

## Edit view (layout)

Defaults:
- All fields in Main section.
- Meta fields in sidebar (createdAt, status, updatedAt, etc).

```ts
type AdminEditConfig = {
  title?: (ctx) => I18nText;
  tabs?: AdminTabConfig[];
  sections?: AdminSectionConfig[];
  sidebar?: AdminSidebarConfig;
  headerActions?: AdminActions;
  footerActions?: AdminActions;
};
```

---

## Relationships and embedded collections

Two patterns:

1) Relation to separate collection (e.g. `posts.author -> users`)
2) Embedded join collection (e.g. `posts.images -> post_images -> assets`)

Embedded join collections allow ordering and metadata.

To make this clear in the CMS schema, we can mark embedded collections with
metadata:

```ts
defineCollection("post_images")
  .metadata({
    embeddedInto: "posts",
    hideInNav: true,
  })
  .fields({...});
```

```ts
type RelationFieldUI = {
  mode?: "picker" | "inline" | "create";
  optionLabel?: (row) => string;
  loadOptions?: (ctx) => Promise<Option[]>;
};

type EmbeddedCollectionUI = {
  collection: "post_images";
  mode?: "inline" | "modal" | "drawer";
  orderable?: boolean;
  rowLabel?: (row) => string;
};
```

---

## Actions

Actions can exist on list, row, bulk, edit, page.
Defaults include: create, edit, delete, duplicate, publish.

```ts
type AdminActionsConfig = {
  rowActions?: AdminActionMap;
  bulkActions?: AdminActionMap;
  listActions?: AdminActionMap;
  editActions?: AdminActionMap;
};
```

Optional lifecycle hooks (UI only):

```ts
type AdminCollectionHooks = {
  beforeListLoad?: (ctx) => void;
  afterItemSave?: (item, ctx) => void;
  onBulkDelete?: (ids, ctx) => Promise<boolean>;
};
```

---

## Custom pages

```ts
type AdminPageConfig<Cmp> = {
  path: string;
  label?: I18nText;
  icon?: IconRef;
  component: ComponentRef<Cmp>;
  nav?: boolean;
};
```

---

## Component registry (React-first)

Since the admin is React-only, the registry can accept React components directly.
Lazy loading is optional and can be wrapped by the consumer.

```ts
type AdminComponentRegistry = {
  fields?: {
    text?: React.ComponentType<FieldProps>;
    richText?: React.ComponentType<FieldProps>;
    relation?: React.ComponentType<RelationFieldProps>;
  };
  layouts?: {
    shell?: React.ComponentType<ShellProps>;
    sidebar?: React.ComponentType<SidebarProps>;
  };
  custom?: Record<string, React.ComponentType<any>>;
};
```

Defaults map to shadcn-based components. Custom registry values override defaults.

---

## Routing helpers (typesafe)

Generated from config maps:

```ts
const routes = createAdminRoutes(admin);
routes.collections.posts.list();
routes.collections.posts.edit("id");
routes.pages["tools.image-cleanup"]();
```

---

## Data layer contract (MVP)

Renderer uses `@questpie/cms` client directly. A formal admin-data-client
abstraction can be added later if we need alternative backends.

```ts
interface AdminDataClient {
  find(...): Promise<{ items; total }>;
  findOne(...): Promise<Item>;
  create(...): Promise<Item>;
  update(...): Promise<Item>;
  delete(...): Promise<void>;
  validate?(...): Promise<{ errors: ValidationError[] }>;
  realtime?: { subscribe(...): Unsub };
}
```

Default implementation comes from `@questpie/cms-client`.
TanStack Query/DB uses query options for SSR and realtime.

---

## Validation and error handling

Backend is source of truth; frontend only displays errors. For MVP, reuse
errors from create/update. Optional `/validate` can be added later for
debounced checks (unique, async validation).

Optional endpoint:

- `POST /cms/collections/:collection/validate`
- Payload: `{ mode: "create" | "update", data, id?, fields?, locale? }`
- Response: `{ errors: ValidationError[] }`

```ts
type ValidationError = {
  path: string; // "title" or "gallery.0.caption" or "title.sk"
  code: string; // "required" | "min" | ...
  message: string;
};
```

Renderer maps `path` to field UI. Errors are shown inline and in a summary.

---

## I18n and localization

There are two locales:
- UI locale (labels, helpers, page titles).
- Content locale (localized field values).

### I18n contract

```ts
type I18nText =
  | string
  | { key: string; default?: string }
  | ((ctx: AdminI18nContext) => string);

type AdminI18nContext = {
  locale: string;
  dir: "ltr" | "rtl";
  t: (key: string, vars?: Record<string, unknown>, fallback?: string) => string;
  formatDate: (v: Date | string, opts?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (v: number, opts?: Intl.NumberFormatOptions) => string;
};
```

### Localized fields (content locale)

CMS schema marks localized fields (`localized: true`).
Renderer behavior:
- Show a locale switcher if any localized field exists.
- Show a small locale badge/flag in field labels.
- Allow "copy from locale" (per field or whole form).
- Highlight missing translations (warning badge).
- List view uses current content locale.
- Validation errors include locale in path (`title.sk`).

Optional admin overrides:
- `contentLocales?: { default, available, fallback }`
- `fieldOverrides[foo].localization?: "inherit" | "force" | "disable"`
- `fieldOverrides[foo].localizationShowBadge?: boolean`

---

## Theming and UI primitives

- UI built on shadcn + Tailwind CSS v4.
- Theming is done via CSS variables (oklch color space) in `styles.css`.
- Admin config may expose small theme tokens, but they map to Tailwind classes.
- Payload-inspired primitives guide layout and density, but config is agnostic.

### Complete shadcn setup (to be copied from apps/admin):

**Configuration files:**
- `components.json` - Shadcn config:
  - Style: `base-lyra`
  - Icon library: `hugeicons`
  - CSS variables: enabled
  - Path aliases: `@/components`, `@/lib/utils`, etc.

**Styling:**
- `styles.css` - Tailwind v4 with complete CSS variables:
  - Light/dark theme (oklch colors for better perceptual uniformity)
  - Semantic color tokens: background, foreground, primary, secondary, muted, accent, destructive
  - Component tokens: card, popover, border, input, ring
  - Sidebar tokens: sidebar-primary, sidebar-accent, etc.
  - Chart colors: chart-1 through chart-5
  - Border radius system: sm, md, lg, xl, 2xl, 3xl, 4xl
  - Custom font: JetBrains Mono Variable (monospace)

**Utilities:**
- `lib/utils.ts` - `cn()` helper using clsx + tailwind-merge

**Components (~50+ shadcn UI components):**
- Forms: button, input, textarea, select, checkbox, radio, switch, slider, calendar, date-picker
- Data: table, pagination, badge, avatar, separator
- Overlays: dialog, sheet, popover, tooltip, hover-card, context-menu, dropdown-menu
- Layout: card, accordion, collapsible, tabs, resizable, scroll-area
- Feedback: alert, alert-dialog, toast/sonner, progress, skeleton
- Navigation: breadcrumb, command, menubar, navigation-menu
- Advanced: carousel, chart, combobox, drawer, input-otp

All components will be copied to `packages/admin/src/components/ui/` with no modifications.

**Required dependencies (from apps/admin/package.json):**
```json
{
  "dependencies": {
    "@tailwindcss/vite": "^4.0.6",
    "tailwindcss": "^4.0.6",
    "tailwind-merge": "^3.4.0",
    "clsx": "^2.1.1",
    "class-variance-authority": "^0.7.1",
    "@hugeicons/react": "^1.1.1",
    "shadcn": "^3.6.1",
    "tw-animate-css": "^1.4.0",
    "@fontsource-variable/jetbrains-mono": "^5.2.8",

    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-hook-form": "^8.x",
    "@tanstack/react-query": "^5.x",
    "@tanstack/react-table": "^8.x",

    "cmdk": "^1.1.1",
    "date-fns": "^4.1.0",
    "embla-carousel-react": "^8.6.0",
    "input-otp": "^1.4.2",
    "next-themes": "^0.4.6",
    "react-day-picker": "^9.12.0",
    "react-resizable-panels": "^3.0.6",
    "recharts": "2.15.4",
    "sonner": "^2.0.7",
    "vaul": "^1.1.2"
  }
}
```

---

## Realtime and TanStack integration

- Query options are generated from CMS schema + admin config.
- Realtime uses SSE; `with` relations supported.
- Collection changes invalidate lists, detail, and embedded relations.
- Config does not own data logic; renderer uses data client + query options.

---

## Field type inference (automatic)

Admin fields should be inferred from CMS/Drizzle schema:
- varchar -> TextInput
- text -> Textarea
- jsonb -> JSON editor or RichText (heuristic)
- boolean -> Checkbox/Switch
- timestamp -> DatePicker
- uuid + references -> RelationSelect

Admin config only overrides when needed.

---

## Permissions

Config can declare permission guards for routes/actions.
Actual checks come from backend auth and data client.

---

## Best practices checklist

- Keep admin config small: only override what is different.
- Use map-based collection definitions for strong types.
- Prefer embedded join collections for ordered arrays.
- Use backend validation for all writes.
- Use content locales for localized fields; do not translate data in UI layer.

---

## Migration strategy (from existing apps/admin)

The current `apps/admin` app has a solid foundation with shadcn UI components and TanStack Start setup. Migration will be incremental.

### What we're copying from apps/admin:

**✅ Complete shadcn setup:**
- [ ] `components.json` - shadcn configuration
- [ ] `src/styles.css` - All CSS variables and Tailwind v4 setup
- [ ] `src/lib/utils.ts` - cn() helper function
- [ ] `src/components/ui/*` - All ~50+ shadcn components
- [ ] All related dependencies (tailwindcss, clsx, tailwind-merge, hugeicons, etc.)

**✅ Theme system:**
- [ ] Light/dark mode CSS variables (oklch colors)
- [ ] Sidebar theme tokens
- [ ] Chart color palette
- [ ] Border radius system
- [ ] JetBrains Mono font setup

**✅ Build configuration:**
- [ ] Tailwind v4 setup pattern (vite plugin, CSS imports)
- [ ] Path aliases pattern (@/components, @/lib, etc.)
- [ ] TypeScript configuration patterns

### Migration phases:

### Phase 1: Package setup and core infrastructure
1. Create `packages/admin` with structure:
   - `/config` - defineAdminConfig, types
   - `/components` - Copy all shadcn UI from `apps/admin/src/components/ui/`
   - `/hooks` - Data fetching hooks using `@questpie/tanstack-query`
   - `/utils` - Route helpers, i18n, registry, cn() helper
   - `/styles` - CSS file with Tailwind v4 directives and theme variables
2. Copy complete shadcn setup from `apps/admin`:
   - `components.json` - Shadcn config (base-lyra style, hugeicons, cssVariables)
   - `styles.css` - Complete CSS variables for light/dark theme (oklch colors, sidebar, charts)
   - `lib/utils.ts` - cn() helper (clsx + tailwind-merge)
   - All UI components (~50+ components: button, form, input, select, table, dialog, etc.)
3. Set up build pipeline (tsdown/tsup) with proper CSS bundling
4. Implement `defineAdminConfig` with full type inference from CMS

### Phase 2: Core CRUD (List + Edit views)
1. List view with TanStack Table (filter, sort, pagination)
2. Edit view with React Hook Form integration
3. Basic actions (create, update, delete)
4. Field type inference from Drizzle schema
5. Integration with `@questpie/cms` client

### Phase 3: Relations and advanced features
1. Relation fields (RelationSelect, RelationPicker)
2. Embedded collections (inline editing with ordering)
3. File upload integration (with `assets`)
4. Realtime support (SSE + TanStack DB)

### Phase 4: Polish and UX
1. SavedViews (static + dynamic from DB)
2. Content localization (locale switcher, badges)
3. Lifecycle hooks (UI-only)
4. Custom pages and component registry
5. Preview mode and debug devtools

### Backward compatibility and reference implementation
- Existing `apps/admin` remains functional during migration (parallel development)
- New admin config is opt-in (can be tested per collection)
- Once `@questpie/admin` package is ready, `apps/admin` will be refactored to:
  1. Import `@questpie/admin` package instead of local components
  2. Use `defineAdminConfig()` for configuration
  3. Serve as the **official reference implementation** and documentation example
  4. Demonstrate best practices and all available features
- This ensures the package works in real-world TanStack Start apps

---

## Open questions / TODO

- Should we expose a strict registry merge helper for third-party extensions?
  → **Yes**: Export `mergeRegistries(base, custom)` helper
- How much of content locale fallback should be visible vs implicit?
  → **Hybrid**: Implicit by default, show "Using fallback from `en`" placeholder when field is empty
