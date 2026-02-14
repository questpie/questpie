# @questpie/admin

**Config-driven, batteries-included admin UI for QUESTPIE CMS**

A fully-featured admin interface using the `qa()` builder pattern for type-safe configuration.

## Features

- **Builder Pattern** - Type-safe `qa()` builder with autocomplete
- **Config-Driven** - UI auto-generated from builder configuration
- **Type-Safe** - Full TypeScript inference with module augmentation
- **Tailwind v4** - Built with Tailwind CSS v4 + shadcn/ui components
- **Rich Text** - Tiptap editor with toolbar controls
- **Relations** - Single select, multi-picker with drag-and-drop
- **Layouts** - Sections, tabs, columns, grids, sidebars
- **Realtime** - SSE-powered live updates
- **Versioning** - Built-in version history
- **i18n Ready** - Localization support for content

## Installation

```bash
bun add @questpie/admin questpie @questpie/tanstack-query
bun add @tanstack/react-query
```

## Quick Start

### 1. Create Admin Builder

```typescript
// src/admin/builder.ts
import { qa, adminModule } from "@questpie/admin/client";
import type { AppCMS } from "./server/cms";

// Create typed builder with admin fields/views
export const qab = qa<AppCMS>().use(adminModule).toNamespace();
```

### 2. Define Collection Configs

```typescript
// src/admin/collections/posts.ts
import { qab } from "../builder";

export const postsAdmin = qab
  .collection("posts")
  .meta({
    label: "Blog Posts",
    icon: FileTextIcon, // React component
  })
  // Fields with registry callback - ({ r }) gives autocomplete!
  .fields(({ r }) => ({
    title: r.text({
      label: "Title",
      placeholder: "Post title...",
      maxLength: 200,
    }),
    slug: r.text({
      label: "Slug",
    }),
    content: r.textarea({
      label: "Content",
    }),
    status: r.select({
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    }),
    publishedAt: r.datetime({
      label: "Publish Date",
    }),
    authorId: r.relation({
      label: "Author",
      targetCollection: "users",
    }),
  }))
  // List view with field proxy - ({ v, f }) gives autocomplete!
  .list(({ v, f }) =>
    v.table({
      columns: [f.title, f.status, f.authorId, f.publishedAt],
    }),
  )
  // Form view
  .form(({ v, f }) =>
    v.form({
      sections: [
        {
          title: "Content",
          fields: [f.title, f.slug, f.content],
        },
        {
          title: "Publishing",
          fields: [f.status, f.publishedAt, f.authorId],
        },
      ],
    }),
  );
```

### 3. Build Admin Configuration

```typescript
// src/admin/builder.ts
import { qa, adminModule } from "@questpie/admin/client";
import type { AppCMS } from "./server/cms";

export const admin = qa<AppCMS>().use(adminModule);

// Module augmentation for global type inference
declare module "@questpie/admin/client" {
  interface AdminTypeRegistry {
    cms: AppCMS;
    admin: typeof admin;
  }
}
```

**Note:** Branding, sidebar, and dashboard are configured server-side via `q().use(adminModule)` from `@questpie/admin/server`.

### 4. Server-Side Configuration

Branding, sidebar, and dashboard are configured on the server:

```typescript
// src/questpie/server/app.ts
import { adminModule } from "@questpie/admin/server";
import { q } from "questpie";

export const cms = q({ name: "my-app" })
  .use(adminModule)
  .branding({ name: "My Admin" })
  .sidebar(({ s, c }) =>
    s.sidebar({
      sections: [
        {
          id: "main",
          items: [
            { type: "link", label: "Dashboard", href: "/admin", icon: c.icon("ph:house") },
          ],
        },
        {
          id: "content",
          label: "Content",
          icon: c.icon("ph:file-text"),
          items: [
            { type: "collection", collection: "posts" },
          ],
        },
      ],
    }),
  )
  .dashboard(({ d, c }) =>
    d.dashboard({
      items: [],
    }),
  )
  .build({ ... });
```

### 5. Setup Tailwind CSS

In your main CSS file, import admin styles and configure Tailwind to scan the admin package:

```css
/* src/styles.css */
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@questpie/admin/styles/index.css";

/* IMPORTANT: Tell Tailwind to scan admin package for utility classes */
@source "../node_modules/@questpie/admin/dist";

/* Your app's theme variables... */
```

### 6. Mount in React

```tsx
// routes/admin.tsx (TanStack Router example)
import { Admin, AdminLayoutProvider } from "@questpie/admin/client";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { admin } from "~/admin/builder";
import { cmsClient } from "~/lib/cms-client";
import { queryClient } from "~/lib/query-client";

// Create runtime instance
const adminInstance = Admin.from(admin);

function AdminLayout() {
  const location = useLocation();

  return (
    <AdminLayoutProvider
      admin={adminInstance}
      client={cmsClient}
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

## Builder API

### Main Entry Point

```typescript
import { qa, adminModule } from "@questpie/admin/client";
import type { AppCMS } from "./server/cms";

// Start from admin module (includes built-in fields/views + user management)
const admin = qa<AppCMS>().use(adminModule);

// Then use the builder to configure collections
const postsAdmin = admin.collection("posts").fields(({ r }) => ({
  title: r.text(),
  // ...
}));
```

**Note:** Branding, sidebar, and dashboard are configured server-side via `q().use(adminModule)` from `@questpie/admin/server`.

### Collection Builder

```typescript
const postsAdmin = qa
  .collection("posts")
  .meta({ label: "Posts", icon: PostIcon })
  .fields(({ r }) => ({
    // r = FieldRegistryProxy with autocomplete for registered fields
    title: r.text({ maxLength: 200 }),
    content: r.richText(),
    status: r.select({ options: [...] }),
  }))
  .list(({ v, f }) => v.table({
    // v = ViewRegistryProxy, f = FieldProxy
    columns: [f.title, f.status],
  }))
  .form(({ v, f }) => v.form({
    fields: [f.title, f.content, f.status],
  }));
```

### Global Builder

```typescript
const settingsAdmin = qa
  .global("settings")
  .meta({ label: "Site Settings", icon: SettingsIcon })
  .fields(({ r }) => ({
    siteName: r.text({ maxLength: 100 }),
    logo: r.text(), // TODO: image field
  }))
  .form(({ v, f }) =>
    v.form({
      fields: [f.siteName, f.logo],
    }),
  );
```

### Sidebar Configuration (Server-side)

```typescript
import { adminModule } from "@questpie/admin/server";
import { q } from "questpie";

const cms = q({ name: "app" })
  .use(adminModule)
  .sidebar(({ s, c }) =>
    s.sidebar({
      sections: [
        {
          id: "main",
          items: [
            { type: "link", label: "Dashboard", href: "/admin", icon: c.icon("ph:house") },
          ],
        },
        {
          id: "content",
          label: "Content",
          items: [
            { type: "collection", collection: "posts" },
            { type: "collection", collection: "pages" },
            { type: "divider" },
            { type: "global", global: "settings" },
          ],
        },
      ],
    }),
  );
```

**Typed Sidebar (Recommended)**

```typescript
import type { AppCMS } from "./server/cms";
import type { SidebarItemForApp } from "@questpie/admin/client";

const sidebarConfig = qa.sidebar<AppCMS>().section("content", (s) =>
  s.title("Content").items([
    { type: "collection", collection: "posts" },
    { type: "global", global: "settings" },
  ]),
);

// Standalone typed items
const items: SidebarItemForApp<AppCMS>[] = [
  { type: "collection", collection: "posts" },
  { type: "global", global: "settings" },
];
```

### Server Dashboard Actions (`a` proxy)

When configuring dashboard on the server with `q().use(adminModule)`, use `a` helpers for header actions instead of hardcoded links.

```typescript
import { adminModule } from "@questpie/admin/server";
import { q } from "questpie";

const cms = q({ name: "app" })
  .use(adminModule)
  .dashboard(({ d, c, a }) =>
    d.dashboard({
      title: { en: "Control Panel" },
      actions: [
        a.create({
          id: "new-post",
          collection: "posts",
          label: { en: "New Post" },
          icon: c.icon("ph:plus"),
          variant: "primary",
        }),
        a.global({
          id: "site-settings",
          global: "siteSettings",
          label: { en: "Site Settings" },
          icon: c.icon("ph:gear-six"),
        }),
        a.link({
          id: "open-site",
          label: { en: "Open Site" },
          href: "/",
          icon: c.icon("ph:arrow-square-out"),
          variant: "outline",
        }),
      ],
      items: [],
    }),
  );
```

Helpers:

- `a.create({ collection })` -> `/admin/collections/:collection/create`
- `a.global({ global })` -> `/admin/globals/:global`
- `a.link({ href })` / `a.action({ href })` -> explicit URL

## Built-in Field Types

The `adminModule` provides these field types:

| Field      | Usage                              | Description                 |
| ---------- | ---------------------------------- | --------------------------- |
| `text`     | `r.text({ maxLength })`            | Single-line text input      |
| `email`    | `r.email()`                        | Email input with validation |
| `password` | `r.password()`                     | Password input              |
| `textarea` | `r.textarea({ rows })`             | Multi-line text             |
| `number`   | `r.number({ min, max })`           | Numeric input               |
| `checkbox` | `r.checkbox()`                     | Boolean checkbox            |
| `switch`   | `r.switch()`                       | Toggle switch               |
| `select`   | `r.select({ options })`            | Dropdown select             |
| `date`     | `r.date()`                         | Date picker                 |
| `datetime` | `r.datetime()`                     | Date + time picker          |
| `relation` | `r.relation({ targetCollection })` | Relation field              |
| `json`     | `r.json()`                         | JSON editor                 |
| `richText` | `r.richText()`                     | Rich text editor (Tiptap)   |

## Form Layouts

### Sections

```typescript
.form(({ v, f }) => v.form({
  sections: [
    {
      title: "Basic Info",
      description: "Main details",
      fields: [f.title, f.slug],
      collapsible: true,
      defaultOpen: true,
    },
    {
      title: "Content",
      fields: [f.content],
    },
  ],
}))
```

### Columns Layout

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

### Grid Layout

```typescript
sections: [
  {
    layout: "grid",
    grid: { columns: 4, gap: 4 },
    fields: [
      { field: f.title, span: 4 }, // full width
      { field: f.price, span: 1 }, // 1/4
      { field: f.currency, span: 1 }, // 1/4
      { field: f.stock, span: 2 }, // 2/4
    ],
  },
];
```

### Tabs

```typescript
.form(({ v, f }) => v.form({
  tabs: [
    {
      id: "content",
      label: "Content",
      fields: [f.title, f.content],
    },
    {
      id: "meta",
      label: "Metadata",
      fields: [f.seo, f.tags],
    },
  ],
}))
```

### Sidebar Layout

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

## Conditional Fields

```typescript
.fields(({ r }) => ({
  status: r.select({
    options: [
      { label: "Active", value: "active" },
      { label: "Cancelled", value: "cancelled" },
    ],
  }),
  // Show only when status is "cancelled"
  cancellationReason: r.textarea({
    visible: (values) => values.status === "cancelled",
    required: (values) => values.status === "cancelled",
  }),
  // Readonly unless draft
  publishedAt: r.datetime({
    readOnly: (values) => values.status !== "draft",
  }),
}))
```

## Relation Fields

```typescript
.fields(({ r }) => ({
  // Single relation
  authorId: r.relation({
    label: "Author",
    targetCollection: "users",
  }),
  // Multiple relations with ordering
  tags: r.relation({
    label: "Tags",
    targetCollection: "tags",
    type: "multiple",
    orderable: true,
  }),
}))
```

## Hooks

```typescript
import {
  useAdminStore,
  useAdminContext,
  useCollectionList,
  useCollectionItem,
  useCollectionCreate,
  useCollectionUpdate,
  useCollectionDelete,
  useGlobal,
  useGlobalUpdate,
  useAuthClient,
  useAdminRoutes,
} from "@questpie/admin/client";

// Collection list with pagination
const { data, isLoading } = useCollectionList("posts", {
  limit: 10,
  offset: 0,
});

// Single item
const { data: post } = useCollectionItem("posts", id);

// CRUD mutations
const createPost = useCollectionCreate("posts");
const updatePost = useCollectionUpdate("posts");
const deletePost = useCollectionDelete("posts");

// Global data
const { data: settings } = useGlobal("settings");
const updateSettings = useGlobalUpdate("settings");

// Admin store
const { admin, client, basePath } = useAdminStore((s) => ({
  admin: s.admin,
  client: s.client,
  basePath: s.basePath,
}));

// Auth
const authClient = useAuthClient();
const session = authClient.useSession();

// Routes
const { routes, navigate } = useAdminRoutes();
navigate({ collection: "posts", action: "create" });
```

## Components

```typescript
import {
  // Navigation
  AdminLink,
  CollectionLink,
  CollectionCreateLink,
  CollectionEditLink,
  GlobalLink,
  DashboardLink,

  // Fields
  TextField,
  EmailField,
  NumberField,
  SelectField,
  CheckboxField,
  SwitchField,
  DateField,
  RelationField,
  JsonField,

  // UI (shadcn)
  Button,
  Card,
  Dialog,
  Sheet,
  Tabs,
  Table,
  // ... 27+ shadcn components
} from "@questpie/admin/client";
```

## Package Exports

```typescript
// Main client exports (recommended)
import {
  qa,
  Admin,
  AdminBuilder,
  adminModule,
  AdminProvider,
  useAdminStore,
  useCollectionList,
  useAdminRoutes,
  AdminLayoutProvider,
  CollectionList,
  CollectionForm,
} from "@questpie/admin/client";

// Server exports (for backend CMS setup)
import { adminModule } from "@questpie/admin/server";

// Styles
import "@questpie/admin/client/styles/index.css";
```

## Realtime Invalidation

Admin data hooks now support SSE-driven live updates.

- Realtime is enabled by default in `AdminProvider`.
- You can disable it globally:

```tsx
<AdminProvider admin={admin} client={client} realtime={false}>
  {children}
</AdminProvider>
```

- Or configure it explicitly (useful if your API is mounted on a custom path):

```tsx
<AdminProvider
  admin={admin}
  client={client}
  realtime={{ enabled: true, basePath: "/api/cms", debounceMs: 150 }}
>
  {children}
</AdminProvider>
```

- Snapshot events are applied directly to query cache when possible. If snapshot mapping is not possible, hooks fall back to `invalidateQueries`.
- `debounceMs` debounces cache apply/invalidation during bursts. Set `0` for strict immediate updates.

- Per-table toggle via view config:

```ts
defaultViews: {
	collectionList: {
		realtime: false,
	},
}
```

- Per-widget toggle via dashboard widget config:

```ts
widgets: [
  { type: "stats", id: "orders", collection: "orders", realtime: false },
];
```

- Per-table UI toggle is available in the table "View Options" sheet (`Realtime Updates`). The preference is persisted per collection view.

## Styling

Built with Tailwind CSS v4 + shadcn/ui:

- 27+ pre-built components
- Light/dark theme support
- oklch color space
- Customizable via Tailwind tokens
- Styles scoped under `.questpie-admin`

## Examples

See [tanstack-barbershop](../../examples/tanstack-barbershop) for a complete working example.

## License

MIT
