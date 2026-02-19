# @questpie/admin - Aktuálny Stav a Roadmap

**Dátum:** 2026-01-13
**Verzia:** 0.0.1 (pre-alpha)
**Core Funkcionalita:** ~95% hotová

---

## Executive Summary

**@questpie/admin** je config-driven admin UI package pre Questpie QuestPie. Hlavná myšlienka:

> **qa() builder + AdminLayoutProvider = kompletné admin UI**

```tsx
// 1. Build admin config
const admin = qa()
  .use(coreAdminModule)
  .branding({ name: "My Admin" })
  .collections({ posts: postsAdmin })
  .sidebar(sidebarConfig);

// 2. Mount in React
<AdminLayoutProvider
  admin={Admin.from(admin)}
  client={appClient}
  queryClient={queryClient}
  LinkComponent={Link}
  basePath="/admin"
>
  <Outlet />
</AdminLayoutProvider>;
```

**Filozofia:**

- **Builder Pattern** - Type-safe `qa()` builder s autocomplete
- **Config-driven** - UI generované z builder configu
- **Seamless DX** - minimum kódu, maximum funkcií
- **Override anywhere** - každý detail je customizovateľný
- **Type-safe** - plná TypeScript podpora end-to-end

---

## CO FUNGUJE TERAZ (Production-Ready)

### 1. Core Architektúra

**qa() Builder Pattern:**

```typescript
import { qa } from "@questpie/admin/builder";
import { coreAdminModule } from "@questpie/admin/builder/defaults";

const admin = qa()
  .use(coreAdminModule)           // Built-in fields/views
  .branding({ name: "My Admin" }) // Branding config
  .collections({ ... })            // Collection configs
  .globals({ ... })                // Global configs
  .sidebar(sidebarConfig)          // Sidebar navigation
  .dashboard(dashboardConfig);     // Dashboard widgets
```

**AdminLayoutProvider:**

```tsx
import { Admin } from "@questpie/admin/builder";
import { AdminLayoutProvider } from "@questpie/admin/views/layout";

const adminInstance = Admin.from(admin);

<AdminLayoutProvider
  admin={adminInstance}
  client={appClient}
  queryClient={queryClient}
  LinkComponent={Link}
  activeRoute={location.pathname}
  basePath="/admin"
>
  {children}
</AdminLayoutProvider>;
```

**Automaticky dostaneš:**

- Sidebar navigáciu (auto-generovaná z configu)
- Routing (`/admin`, `/admin/:collection`, `/admin/:collection/:id`)
- List views (tabuľky s dátami)
- Create/Edit formuláre (AutoFormFields z admin configu)
- Delete funkciu
- Search a filtrovanie
- Pagination
- Realtime updates (SSE)

### 2. Collection Builder

```typescript
const postsAdmin = qab
  .collection("posts")
  .meta({
    label: "Blog Posts",
    icon: FileTextIcon,
  })
  // Fields s registry callback - ({ r }) dáva autocomplete!
  .fields(({ r }) => ({
    title: r.text({ label: "Title", maxLength: 200 }),
    content: r.textarea({ label: "Content" }),
    status: r.select({
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    }),
  }))
  // List view s field proxy - ({ v, f }) dáva autocomplete!
  .list(({ v, f }) =>
    v.table({
      columns: [f.title, f.status],
    }),
  )
  // Form view
  .form(({ v, f }) =>
    v.form({
      sections: [
        { title: "Content", fields: [f.title, f.content] },
        { title: "Settings", fields: [f.status] },
      ],
    }),
  );
```

### 3. Sidebar Builder

```typescript
const sidebarConfig = qa
  .sidebar()
  .section("main", (s) =>
    s.items([
      { type: "link", label: "Dashboard", href: "/admin", icon: HomeIcon },
    ]),
  )
  .section("content", (s) =>
    s
      .title("Content")
      .icon(FileTextIcon)
      .items([
        { type: "collection", collection: "posts" },
        { type: "divider" },
        { type: "global", global: "settings" },
      ]),
  );
```

### 4. Conditional Field Logic

```typescript
.fields(({ r }) => ({
  status: r.select({
    options: [
      { label: "Active", value: "active" },
      { label: "Cancelled", value: "cancelled" },
    ],
  }),
  // Zobrazí sa len keď status === "cancelled"
  cancellationReason: r.textarea({
    visible: (values) => values.status === "cancelled",
    required: (values) => values.status === "cancelled",
  }),
  // Readonly keď nie je draft
  publishedAt: r.datetime({
    readOnly: (values) => values.status !== "draft",
  }),
}))
```

### 5. Lokalizácia (i18n)

- Locale switcher (list + form view)
- Badge pri localized fieldoch
- `localized: true` v field config

### 6. Relation Fields

**Single Relation:**

```typescript
.fields(({ r }) => ({
  authorId: r.relation({
    label: "Author",
    targetCollection: "users",
  }),
}))
```

**Multiple Relations:**

```typescript
.fields(({ r }) => ({
  tags: r.relation({
    label: "Tags",
    targetCollection: "tags",
    type: "multiple",
    orderable: true,  // Drag-and-drop
  }),
}))
```

**Features:**

- Plus button - vytvorí nový záznam
- Edit button - edituje vybraný záznam
- Auto-complete search
- Display label = `_title`
- Drag-and-drop reordering

### 7. Advanced Form Layouts

**Columns:**

```typescript
sections: [
  {
    title: "Contact",
    layout: "columns",
    columns: 2,
    fields: [f.firstName, f.lastName, f.email, f.phone],
  },
];
```

**Grid:**

```typescript
sections: [
  {
    layout: "grid",
    grid: { columns: 4, gap: 4 },
    fields: [
      { field: f.title, span: 4 },
      { field: f.price, span: 1 },
      { field: f.stock, span: 2 },
    ],
  },
];
```

**Tabs:**

```typescript
.form(({ v, f }) => v.form({
  tabs: [
    { id: "content", label: "Content", fields: [f.title, f.content] },
    { id: "meta", label: "Metadata", fields: [f.seo, f.tags] },
  ],
}))
```

**Sidebar Layout:**

```typescript
.form(({ v, f }) => v.form({
  layout: "with-sidebar",
  sections: [
    { title: "Content", fields: [f.title, f.content] },
  ],
  sidebar: {
    position: "right",
    width: "300px",
    fields: [f.status, f.publishedAt],
  },
}))
```

### 8. Version History & Audit Logging

- Kompletná história verzií
- Tracking kto urobil zmenu
- Timestamp každej zmeny
- Diff view (old vs new value)
- Restore previous version
- Action badges (Created, Updated, Deleted)

### 9. TanStack Integration

- TanStack Router (router-agnostic design)
- TanStack Query (pre data fetching)
- TanStack Table (pre list views)
- Optimistic updates
- Realtime SSE

### 10. Batteries Included

**shadcn/ui komponenty:**

- Button, Card, Dialog, Sheet, Tabs, Accordion
- Input, Select, Checkbox, Switch, Textarea
- Table, Pagination, Combobox
- Badge, Tooltip, Popover
- 27+ komponenty celkovo

---

## CONFIG TYPES HOTOVÉ, RENDERING TODO

### 1. Dashboard System

Widget types definované, rendering čiastočne hotový:

```typescript
.dashboard({
  layout: "grid",
  widgets: [
    {
      id: "stats-posts",
      type: "stats",
      title: "Total Posts",
      position: { x: 0, y: 0, w: 3, h: 2 },
      config: { collection: "posts", stat: "count" },
    },
  ],
})
```

### 2. Custom Pages

Config types ready, routing TODO:

```typescript
.pages([
  {
    id: "settings",
    label: "Settings",
    path: "/admin/settings",
    component: SettingsPage,
  },
])
```

---

## NEIMPLEMENTOVANÉ

### 1. Block Editor (Puck)

Visual page builder s Puck integráciou.

### 2. Tree Views

Hierarchické zobrazenie dát (categories, pages).

### 3. Bulk Actions

Hromadné operácie na multiple items.

### 4. Saved Views/Filters

Uloženie user preferences pre list views.

---

## PRIORITY ROADMAP

### Vysoká Priorita

1. **Rich Text Editor (Tiptap)** - Implementované
2. **Block Editor (Puck)** - TODO
3. **Embedded Collections** - Implementované

### Stredná Priorita

4. **Advanced Layout Rendering** - Implementované
5. **Dashboard Widgets** - Čiastočne implementované
6. **Custom Pages Routing** - TODO

### Nízka Priorita

7. **Tree Views** - TODO
8. **Bulk Actions** - TODO
9. **Saved Views** - TODO

---

## KĽÚČOVÉ SÚBORY

### Builder System

- `packages/admin/src/builder/qa.ts` - Main qa() entry point
- `packages/admin/src/builder/admin-builder.ts` - AdminBuilder class
- `packages/admin/src/builder/collection/collection.ts` - Collection builder
- `packages/admin/src/builder/global/global.ts` - Global builder
- `packages/admin/src/builder/sidebar/sidebar-builder.ts` - Sidebar builder
- `packages/admin/src/builder/defaults/core.ts` - Core module (built-in fields/views)

### Runtime

- `packages/admin/src/runtime/provider.tsx` - AdminProvider component
- `packages/admin/src/runtime/store.ts` - Zustand store

### Views

- `packages/admin/src/views/layout/admin-layout-provider.tsx` - Main entry point
- `packages/admin/src/views/layout/admin-layout.tsx` - Layout wrapper
- `packages/admin/src/views/layout/admin-sidebar.tsx` - Sidebar component
- `packages/admin/src/views/layout/admin-router.tsx` - Auto routing
- `packages/admin/src/views/collection/collection-list.tsx` - List view
- `packages/admin/src/views/collection/collection-form.tsx` - Form view
- `packages/admin/src/views/collection/auto-form-fields.tsx` - Auto field generation

### Hooks

- `packages/admin/src/hooks/index.ts` - All hooks exports
- `packages/admin/src/hooks/use-collection.ts` - Collection CRUD hooks
- `packages/admin/src/hooks/use-admin-routes.ts` - Navigation hooks

### Documentation

- `packages/admin/README.md` - User documentation
- `packages/admin/BUILDER_GUIDE.md` - Builder API guide
- `packages/admin/STATUS.md` - This file

### Example

- `examples/tanstack-barbershop/` - Complete working example
- `examples/tanstack-barbershop/src/questpie/admin/admin.ts` - Admin config
- `examples/tanstack-barbershop/src/questpie/admin/builder.ts` - Typed builder
- `examples/tanstack-barbershop/src/questpie/admin/collections/` - Collection configs
- `examples/tanstack-barbershop/src/routes/admin.tsx` - Layout route

---

## AKO POKRAČOVAŤ (Pre AI/Developers)

### Pred začatím:

1. **Prečítaj dokumentáciu:**
   - `packages/admin/README.md` - User-facing features
   - `packages/admin/BUILDER_GUIDE.md` - Builder API guide
   - `packages/admin/STATUS.md` - Aktuálny stav (tento súbor)

2. **Pozri example:**
   - `examples/tanstack-barbershop/` - Working example
   - Spusti: `cd examples/tanstack-barbershop && bun run dev`

3. **Check dependencies:**
   - `DEPENDENCIES.md` - Správne verzie

### Coding Guidelines:

**DO:**

- Import z admin package: `import { Button } from "@questpie/admin/components"`
- Config-driven approach - všetko z configu
- Type-safe - plné TypeScript types
- Use tabs (NOT spaces)
- Use double quotes
- Check `DEPENDENCIES.md` before adding deps

**DON'T:**

- Neduplikuj UI komponenty v examples
- Nevytváraj manual route files
- Nepíš switch statements pre collections

### Testing:

1. **Manual testing:**

   ```bash
   cd examples/tanstack-barbershop
   bun install
   bun run dev
   ```

2. **Type checking:**

   ```bash
   cd packages/admin
   bun run check-types
   ```

3. **Build:**
   ```bash
   cd packages/admin
   bun run build
   ```

---

## EXAMPLE USAGE

### Complete Setup

```typescript
// 1. Create typed builder
// src/admin/builder.ts
import { qa as originalQa } from "@questpie/admin/builder";
import { coreAdminModule } from "@questpie/admin/builder/defaults";
import type { App } from "./server/app";

export const qab = originalQa<App>().use(coreAdminModule).toNamespace();

// 2. Define collection config
// src/admin/collections/posts.ts
import { qab } from "../builder";

export const postsAdmin = qab
  .collection("posts")
  .meta({ label: "Posts" })
  .fields(({ r }) => ({
    title: r.text({ label: "Title" }),
    content: r.textarea({ label: "Content" }),
  }))
  .list(({ v, f }) => v.table({ columns: [f.title] }))
  .form(({ v, f }) => v.form({ fields: [f.title, f.content] }));

// 3. Build admin
// src/admin/admin.ts
import { qa } from "@questpie/admin/builder";
import { coreAdminModule } from "@questpie/admin/builder/defaults";
import { postsAdmin } from "./collections/posts";
import { sidebarConfig } from "./sidebar";

export const admin = qa()
  .use(coreAdminModule)
  .branding({ name: "My Admin" })
  .collections({ posts: postsAdmin })
  .sidebar(sidebarConfig);

// Module augmentation
declare module "@questpie/admin/builder" {
  interface AdminTypeRegistry {
    app: App;
    admin: typeof admin;
  }
}

// 4. Mount in React
// routes/admin.tsx
import { Admin } from "@questpie/admin/builder";
import { AdminLayoutProvider } from "@questpie/admin/views/layout";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { admin } from "~/admin/admin";
import { appClient } from "~/lib/client";
import { queryClient } from "~/lib/query-client";
import "@questpie/admin/styles/index.css";

const adminInstance = Admin.from(admin);

function AdminLayout() {
  const location = useLocation();

  return (
    <AdminLayoutProvider
      admin={adminInstance}
      client={appClient}
      queryClient={queryClient}
      LinkComponent={Link}
      activeRoute={location.pathname}
      basePath="/admin"
    >
      <Outlet />
    </AdminLayoutProvider>
  );
}
```

---

**Posledná update:** 2026-01-13
**Status:** Production-ready pre basic/intermediate use cases
