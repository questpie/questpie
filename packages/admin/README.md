# @questpie/admin

Server-driven admin UI for QUESTPIE. Reads your server schema via introspection and generates a complete admin panel — dashboard, table views, form editors, sidebar navigation, block editor — all from the definitions you already wrote on the server.

## How It Works

QUESTPIE follows a **server-first** architecture. All schema, layout, and behavior is defined on the server with the `questpie` core package. The admin UI consumes this via introspection — no duplicate config needed on the client.

| Layer      | Package                               | Defines                                                           |
| ---------- | ------------------------------------- | ----------------------------------------------------------------- |
| **Server** | `questpie` + `@questpie/admin/server` | Schema, fields, access, hooks, sidebar, dashboard, branding       |
| **Client** | `@questpie/admin/client`              | Field renderers, view renderers, component registry, UI overrides |

## Installation

```bash
bun add @questpie/admin questpie @questpie/tanstack-query @tanstack/react-query
```

## Server Setup

The admin module plugs into the QUESTPIE builder on the server:

```ts
// questpie/server/builder.ts
import { q } from "questpie";
import { adminModule } from "@questpie/admin/server";

export const qb = q.use(adminModule);
```

All admin configuration is defined server-side using the builder chain:

```ts
// questpie/server/app.ts
import { qb } from "./builder";

export const app = qb
  .collections({ posts, pages })
  .globals({ siteSettings })
  .branding({ name: { en: "My Admin Panel" } })
  .sidebar(({ s, c }) =>
    s.sidebar({
      sections: [
        s.section({
          id: "content",
          title: { en: "Content" },
          items: [
            { type: "link", label: "Dashboard", href: "/admin", icon: c.icon("ph:house") },
            { type: "collection", collection: "posts" },
            { type: "collection", collection: "pages" },
            { type: "divider" },
            { type: "global", global: "siteSettings" },
          ],
        }),
      ],
    }),
  )
  .dashboard(({ d, c, a }) =>
    d.dashboard({
      title: { en: "Dashboard" },
      actions: [
        a.create({ collection: "posts", label: { en: "New Post" }, icon: c.icon("ph:plus") }),
        a.global({ global: "siteSettings", label: { en: "Settings" }, icon: c.icon("ph:gear-six") }),
      ],
      items: [],
    }),
  )
  .build({ ... });

export type App = typeof app;
```

### Collection Admin Config

Admin metadata, list views, and form views are defined on the collection itself:

```ts
const posts = qb.collection("posts")
  .fields((f) => ({
    title: f.text({ label: "Title", required: true }),
    content: f.richText({ label: "Content" }),
    status: f.select({ label: "Status", options: ["draft", "published"] }),
    cover: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
    publishedAt: f.date(),
  }))
  .title(({ f }) => f.title)
  .admin(({ c }) => ({
    label: { en: "Blog Posts" },
    icon: c.icon("ph:article"),
  }))
  .list(({ v, f }) =>
    v.table({
      columns: [f.title, f.status, f.publishedAt],
    }),
  )
  .form(({ v, f }) =>
    v.form({
      layout: "with-sidebar",
      sidebar: { position: "right", fields: [f.status, f.publishedAt, f.cover] },
      fields: [
        { type: "section", label: "Content", fields: [f.title, f.content] },
      ],
    }),
  );
```

### Component References

The server emits serializable `ComponentReference` objects instead of React elements. Use the `c` factory in admin config callbacks:

```ts
.admin(({ c }) => ({
  icon: c.icon("ph:article"),       // → { type: "icon", props: { name: "ph:article" } }
  badge: c.badge({ text: "New" }),   // → { type: "badge", props: { text: "New" } }
}))
```

Icons use the [Iconify](https://icon-sets.iconify.design/) format with the Phosphor set (`ph:icon-name`).

### Form Layouts

```ts
// Sections
.form(({ v, f }) => v.form({
  fields: [
    { type: "section", label: "Basic Info", layout: "grid", columns: 2,
      fields: [f.name, f.email, f.phone, f.city] },
    { type: "section", label: "Content", fields: [f.body] },
  ],
}))

// Sidebar layout
.form(({ v, f }) => v.form({
  layout: "with-sidebar",
  sidebar: { position: "right", fields: [f.status, f.image] },
  fields: [f.title, f.content],
}))

// Tabs
.form(({ v, f }) => v.form({
  tabs: [
    { id: "content", label: "Content", fields: [f.title, f.body] },
    { id: "meta", label: "Metadata", fields: [f.seoTitle, f.seoDescription] },
  ],
}))
```

### Reactive Fields

Server-evaluated reactive behaviors in form config:

```ts
.form(({ v, f }) => v.form({
  fields: [
    {
      field: f.slug,
      compute: {
        handler: ({ data }) => slugify(data.title),
        deps: ({ data }) => [data.title],
        debounce: 300,
      },
    },
    { field: f.publishedAt, hidden: ({ data }) => !data.published },
    { field: f.reason, readOnly: ({ data }) => data.status !== "cancelled" },
  ],
}))
```

### Dashboard Actions

```ts
.dashboard(({ d, c, a }) => d.dashboard({
  actions: [
    a.create({ collection: "posts", label: { en: "New Post" }, icon: c.icon("ph:plus"), variant: "primary" }),
    a.global({ global: "siteSettings", label: { en: "Settings" }, icon: c.icon("ph:gear-six") }),
    a.link({ href: "/", label: { en: "Open Site" }, icon: c.icon("ph:arrow-square-out"), variant: "outline" }),
  ],
  items: [
    { type: "section", items: [
      { type: "stats", collection: "posts", label: "Posts" },
    ]},
  ],
}))
```

## Client Setup

The client creates a typed admin builder and mounts the admin UI in React:

### 1. Admin Builder

```ts
// questpie/admin/builder.ts
import { qa, adminModule } from "@questpie/admin/client";
import type { App } from "../server/app";

export const admin = qa<App>().use(adminModule);
```

### 2. Typed Hooks

```ts
// questpie/admin/hooks.ts
import { createTypedHooks } from "@questpie/admin/client";
import type { App } from "../server/app";

export const {
  useCollectionList,
  useCollectionItem,
  useCollectionCreate,
  useCollectionUpdate,
  useCollectionDelete,
  useGlobal,
  useGlobalUpdate,
} = createTypedHooks<App>();
```

### 3. Mount in React

```tsx
// routes/admin.tsx
import { AdminRouter } from "@questpie/admin/client";
import { admin } from "~/questpie/admin/builder";
import { appClient } from "~/lib/client";
import { queryClient } from "~/lib/query-client";

export default function AdminRoute() {
  return (
    <AdminRouter
      admin={admin}
      client={client}
      queryClient={queryClient}
      basePath="/admin"
    />
  );
}
```

### 4. Tailwind CSS

Import admin styles and scan the admin package:

```css
@import "tailwindcss";
@import "@questpie/admin/styles/index.css";

@source "../node_modules/@questpie/admin/dist";
```

## Block Editor

The admin includes a full drag-and-drop block editor. Blocks are defined server-side:

```ts
const heroBlock = qb
  .block("hero")
  .admin(({ c }) => ({
    label: { en: "Hero Section" },
    icon: c.icon("ph:image"),
    category: { label: "Sections", icon: c.icon("ph:layout") },
  }))
  .fields((f) => ({
    title: f.text({ required: true }),
    subtitle: f.textarea(),
    backgroundImage: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
  }))
  .prefetch({ with: { backgroundImage: true } });
```

Render blocks on the client with `BlockRenderer`:

```tsx
import { BlockRenderer, createBlockRegistry } from "@questpie/admin/client";

const registry = createBlockRegistry({
  hero: ({ block }) => (
    <section style={{ backgroundImage: `url(${block.backgroundImage?.url})` }}>
      <h1>{block.title}</h1>
      <p>{block.subtitle}</p>
    </section>
  ),
});

function Page({ blocks }) {
  return <BlockRenderer blocks={blocks} registry={registry} />;
}
```

## Actions System

Collection-level actions with multiple handler types:

| Type       | Description                                 |
| ---------- | ------------------------------------------- |
| `navigate` | Client-side routing                         |
| `api`      | HTTP API call                               |
| `form`     | Dialog with field inputs                    |
| `server`   | Server-side execution with full app context |
| `custom`   | Arbitrary client-side code                  |

Actions can be scoped to `header` (list toolbar), `bulk` (selected items), `single` (per-item), or `row`.

## Realtime

SSE-powered live updates are enabled by default. Collection lists and dashboard widgets auto-refresh when data changes.

```ts
// Disable globally
<AdminRouter admin={admin} client={client} realtime={false} />

// Disable per collection view
.list(({ v }) => v.table({ realtime: false }))
```

## URL-Synced Panels

Admin keeps major panel states in URL search params so links are shareable and browser navigation works as expected.

- `sidebar=view-options` - collection list view options sheet
- `sidebar=history` - version history sidebar (collection/global forms)
- `sidebar=block-library` - block editor library sidebar
- `preview=true` - live preview mode (collection form)

Legacy params (`history`, `viewOptions`, and `sidebar=preview`) are still read for backward compatibility.

## Package Exports

```ts
// Client (React components, builder, hooks)
import { qa, adminModule, AdminRouter, createTypedHooks, BlockRenderer, createBlockRegistry } from "@questpie/admin/client";

// Server (admin module for QUESTPIE builder)
import { adminModule, adminRpc } from "@questpie/admin/server";

// Styles
import "@questpie/admin/styles/index.css";
```

## Component Stack

- **Primitives**: `@base-ui/react` (NOT Radix)
- **Icons**: `@iconify/react` with Phosphor set (`ph:icon-name`)
- **Styling**: Tailwind CSS v4 + shadcn components
- **Toast**: `sonner`

## Documentation

Full documentation: [https://questpie.com/docs/admin](https://questpie.com/docs/admin)

## License

MIT
