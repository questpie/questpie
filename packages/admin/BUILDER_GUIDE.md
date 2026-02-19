# Admin Builder Guide

Complete guide to the QUESTPIE Admin Builder v3.

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [Builder API](#builder-api)
- [Type-Safe Navigation](#type-safe-navigation)
- [Forms](#forms)
- [Relations](#relations)
- [Widgets](#widgets)
- [Custom Fields & Views](#custom-fields--views)

---

## Overview

The Admin Builder provides a type-safe, declarative API for configuring the admin UI. It follows these principles:

1. **Builder = Config** - No `.build()` methods, builders are used directly
2. **Single Generic Pattern** - Each builder has one generic `TState` that flows through the chain
3. **Immutable State** - Every method returns a new builder instance
4. **Type Safety** - Full autocomplete and type checking throughout

### Architecture

```
┌─────────────────────────────────────────┐
│         AdminBuilder<TState>            │
│  - Field registry (fields)              │
│  - View registry (listViews, editViews) │
│  - Collections/Globals configs          │
│  - Pages, Widgets, Components           │
└─────────────────────────────────────────┘
           │
           ├─► CollectionBuilder<TState>
           │   - Field definitions
           │   - List view config
           │   - Form view config
           │
           ├─► GlobalBuilder<TState>
           │   - Field definitions
           │   - Form view config
           │
           └─► Pages, Widgets, Custom fields/views
```

**Server-side config** (branding, sidebar, dashboard, locales) is configured via `q().use(adminModule)` from `@questpie/admin/server`.

---

## Core Concepts

### 1. Builder State

Every builder has a readonly `state` property that contains the configuration:

```typescript
const admin = qa().use(coreAdminModule);

// State is the config - no .build() needed!
console.log(admin.state.fields); // { text: FieldBuilder<...>, ... }
```

### 2. Context Flow

Builders carry context through `~` prefixed properties:

- `~app` - Backend Questpie app type (for collection name autocomplete)
- `~adminApp` - Admin builder instance (for field/view registry access)
- `~options` - Field-specific options (inferred from component props)
- `~config` - View/widget configuration

### 3. Proxy Pattern

Builders provide proxies for type-safe autocomplete:

```typescript
.fields(({ r }) => ({
  // r = FieldRegistryProxy - autocomplete for registered fields
  name: r.text({ maxLength: 100 }),
  email: r.email(),
}))

.list(({ v, f }) => v.table({
  // v = ViewRegistryProxy - autocomplete for registered views
  // f = FieldProxy - autocomplete for field names
  columns: [f.name, f.email], // ← Autocomplete!
}))
```

---

## Builder API

### Main Entry Point

```typescript
import { qa } from "@questpie/admin/builder";
import { coreAdminModule } from "@questpie/admin/builder/defaults";

// Option 1: Start empty and add modules
const admin = qa()
  .use(coreAdminModule)
  .fields({ ... })
  .views({ ... })
  .widgets({ ... })
  .pages({ ... });

// Option 2: Create typed builder with namespace (recommended)
import type { App } from "./server/app";

const qab = qa<App>()
  .use(coreAdminModule)
  .toNamespace();

// Now qab.collection() and qab.global() have type-safe access
const postsAdmin = qab.collection("posts")
  .fields(({ r }) => ({ ... }));
```

**Note:** Branding, sidebar, dashboard, and locales are configured server-side via `q().use(adminModule)` from `@questpie/admin/server`.

### AdminBuilder Methods

| Method                  | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `.use(module)`          | Merge another builder's fields/views/widgets/pages   |
| `.fields(fields)`       | Register field definitions                           |
| `.views(views)`         | Register view definitions (auto-sorted to list/edit) |
| `.widgets(widgets)`     | Register widget definitions                          |
| `.pages(pages)`         | Register page definitions                            |
| `.components(comps)`    | Register component implementations                   |
| `.defaultViews(config)` | Set default views configuration                      |
| `.toNamespace()`        | Create scoped qa-like namespace                      |

**Server-side methods** (via `q().use(adminModule)` from `@questpie/admin/server`):
- `.branding(config)` - Set branding (name, logo, colors)
- `.sidebar(config)` - Set sidebar navigation  
- `.dashboard(config)` - Set dashboard widgets
- `.adminLocale(config)` - Set admin UI locale settings

### Field Registration

Register reusable field types with form and cell components:

```typescript
import { field } from "@questpie/admin/builder";
import { TextField } from "@questpie/admin/components/fields";

const admin = qa()
  .use(coreAdminModule)
  .fields({
    // Custom field
    slug: field("slug", {
      component: SlugField, // Form component
      cell: SlugCell, // Optional table cell component
    }),

    // With type-safe options
    richText: field("richText", {
      component: RichTextEditor,
    }),
  });
```

**BaseFieldProps** (omitted from options inference):

```typescript
type BaseFieldProps = {
  name: string;
  value: any;
  onChange: (value: any) => void;
  onBlur: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  error?: string;
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  localized?: boolean;
  locale?: string;
  control?: any; // React Hook Form control
  className?: string;
};
```

### View Registration

Register reusable view components for collections:

```typescript
import { listView, editView } from "@questpie/admin/builder";

const admin = qa()
  .use(coreAdminModule)
  .views({
    table: listView("table", {
      component: TableView,
    }),

    kanban: listView("kanban", {
      component: KanbanView,
    }),

    form: editView("form", {
      component: FormView,
    }),

    splitView: editView("splitView", {
      component: SplitView,
    }),
  });
```

### Collection Configuration

Configure UI for backend collections:

```typescript
// Using typed namespace (recommended)
const qab = qa<App>().use(coreAdminModule).toNamespace();

const postsAdmin = qab
  .collection("posts")
  .meta({
    label: "Blog Posts",
    icon: PostIcon, // IconComponent (not string!)
  })
  .fields(({ r }) => ({
    // r = FieldRegistryProxy with autocomplete
    title: r.text({ maxLength: 200 }),
    slug: r.text(),
    content: r.richText(),
    status: r.select({
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
      ],
    }),
    author: r.relation({
      targetCollection: "users", // ← Autocomplete!
    }),
    tags: r.relation({
      targetCollection: "tags",
      type: "multiple",
    }),
  }))
  .list(({ v, f }) =>
    v.table({
      // v = ViewRegistryProxy, f = FieldProxy
      columns: [f.title, f.status, f.author], // ← Autocomplete!
      filters: [f.status, f.author],
      search: [f.title, f.slug],
    }),
  )
  .form(({ v, f }) =>
    v.form({
      sections: [
        {
          title: "Content",
          fields: [f.title, f.slug, f.content],
        },
        {
          title: "Settings",
          fields: [f.status, f.author, f.tags],
        },
      ],
    }),
  );
```

### Global Configuration

Configure UI for backend globals (singleton settings):

```typescript
const settingsAdmin = qab
  .global("siteSettings")
  .meta({
    label: "Site Settings",
    icon: SettingsIcon,
  })
  .fields(({ r }) => ({
    siteName: r.text({ maxLength: 100 }),
    logo: r.text(), // TODO: image field
    primaryColor: r.text(),
    socialLinks: r.json(),
  }))
  .form(({ v, f }) =>
    v.form({
      sections: [
        {
          title: "Branding",
          fields: [f.siteName, f.logo, f.primaryColor],
        },
        {
          title: "Social",
          fields: [f.socialLinks],
        },
      ],
    }),
  );
```

### Widgets (Client-side)

Register reusable widgets for use in dashboards:

```typescript
import { widget } from "@questpie/admin/builder";

const admin = qa()
  .use(coreAdminModule)
  .widgets({
    stats: widget("stats", {
      component: StatsWidget,
    }),
    recentItems: widget("recent-items", {
      component: RecentItemsWidget,
    }),
  });
```

**Dashboard configuration** is done server-side via `q().use(adminModule)` from `@questpie/admin/server`.

### Server Dashboard Actions (`a` proxy)

For server-side builder (`q().use(adminModule)`), dashboard config callback also exposes `a` for header actions.

```typescript
import { adminModule } from "@questpie/admin/server";
import { q } from "questpie";

const app = q({ name: "app" })
  .use(adminModule)
  .dashboard(({ d, c, a }) =>
    d.dashboard({
      title: { en: "Dashboard" },
      actions: [
        a.create({
          id: "new-post",
          collection: "posts",
          label: { en: "New Post" },
          icon: c.icon("ph:plus"),
          variant: "primary",
        }),
        a.global({
          id: "settings",
          global: "siteSettings",
          label: { en: "Settings" },
          icon: c.icon("ph:gear-six"),
        }),
      ],
      items: [],
    }),
  );
```

Action helpers:

- `a.create({ collection })` -> `/admin/collections/:collection/create`
- `a.global({ global })` -> `/admin/globals/:global`
- `a.link({ href })` / `a.action({ href })` -> direct URL

### Sidebar Configuration (Server-side)

Sidebar is configured on the server builder:

```typescript
import { adminModule } from "@questpie/admin/server";
import { q } from "questpie";

const app = q({ name: "app" })
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
          icon: c.icon("ph:file-text"),
          items: [
            { type: "collection", collection: "posts" },
            { type: "collection", collection: "pages" },
          ],
        },
        {
          id: "settings",
          label: "Settings",
          items: [
            { type: "global", global: "siteSettings" },
            { type: "divider" },
            { type: "page", pageId: "analytics" },
          ],
        },
      ],
    }),
  );
```

---

## Type-Safe Navigation

The admin provides type-safe navigation helpers with autocomplete:

### AdminLink Component

```typescript
import { AdminLink } from "@questpie/admin/components";

// Link to dashboard
<AdminLink to="dashboard">Dashboard</AdminLink>

// Link to collection list
<AdminLink collection="posts">View Posts</AdminLink>

// Link to create new item
<AdminLink collection="posts" action="create">
  New Post
</AdminLink>

// Link to edit item
<AdminLink collection="posts" action="edit" id="123">
  Edit Post
</AdminLink>

// Link to global
<AdminLink global="siteSettings">Site Settings</AdminLink>

// Link to custom page
<AdminLink pageId="analytics">Analytics</AdminLink>
```

**Type Safety:**

- `collection` prop autocompletes backend collection names
- `global` prop autocompletes backend global names
- `pageId` autocompletes custom page IDs

### Specialized Link Components

```typescript
import {
  CollectionLink,
  CollectionCreateLink,
  CollectionEditLink,
  GlobalLink,
  DashboardLink,
} from "@questpie/admin/components";

// Collection list
<CollectionLink collection="posts">View Posts</CollectionLink>

// Create new
<CollectionCreateLink collection="posts">New Post</CollectionCreateLink>

// Edit item
<CollectionEditLink collection="posts" id="123">Edit</CollectionEditLink>

// Global
<GlobalLink global="siteSettings">Settings</GlobalLink>

// Dashboard
<DashboardLink>Dashboard</DashboardLink>
```

### Programmatic Navigation

```typescript
import { useAdminRoutes } from "@questpie/admin/hooks";

function MyComponent() {
  const { routes, navigate } = useAdminRoutes();

  // Navigate to collection list
  navigate({ collection: "posts" });

  // Navigate to edit
  navigate({ collection: "posts", action: "edit", id: "123" });

  // Navigate to global
  navigate({ global: "siteSettings" });

  // Get URL without navigating
  const url = routes.collection("posts");
  const editUrl = routes.collectionEdit("posts", "123");
}
```

---

## Forms

Forms use React Hook Form + TanStack Query for optimistic updates.

### CollectionForm Component

Automatic form wrapper with:

- Form state management (React Hook Form)
- CRUD operations (TanStack Query)
- Optimistic updates
- Error handling
- Loading states

```typescript
import { CollectionForm } from "@questpie/admin/views";
import { TextField, SelectField } from "@questpie/admin/components/fields";

function PostForm({ id }: { id?: string }) {
  return (
    <CollectionForm
      collection="posts"
      id={id}
      onSuccess={(post) => {
        console.log("Saved:", post);
      }}
    >
      {/* Field components automatically connect to form */}
      <TextField name="title" label="Title" required />
      <TextField name="slug" label="Slug" />
      <SelectField
        name="status"
        label="Status"
        options={[
          { label: "Draft", value: "draft" },
          { label: "Published", value: "published" },
        ]}
      />
      <RelationField
        name="author"
        targetCollection="users"
        label="Author"
      />
    </CollectionForm>
  );
}
```

### Field Components

All field components work with React Hook Form:

```typescript
import {
  TextField,
  NumberField,
  SelectField,
  CheckboxField,
  DateField,
  RelationField,
  JsonField,
} from "@questpie/admin/components/fields";

// Text input
<TextField
  name="title"
  label="Title"
  placeholder="Enter title..."
  maxLength={200}
  required
/>

// Number input
<NumberField
  name="price"
  label="Price"
  min={0}
  step={0.01}
/>

// Select (single or multiple)
<SelectField
  name="category"
  label="Category"
  options={[
    { label: "Tech", value: "tech" },
    { label: "Design", value: "design" },
  ]}
/>

// Checkbox
<CheckboxField name="published" label="Published" />

// Date/DateTime
<DateField name="publishedAt" label="Publish Date" />

// JSON editor
<JsonField name="metadata" label="Metadata" />
```

---

## Relations

Relations are first-class citizens with type-safe components.

### RelationField Component

Unified component that handles all relation types:

```typescript
import { RelationField } from "@questpie/admin/components/fields";

// Single relation (one-to-one, many-to-one)
<RelationField
  name="author"
  targetCollection="users"  // ← Autocomplete!
  label="Author"
  required
/>

// Multiple relations (one-to-many, many-to-many)
<RelationField
  name="tags"
  targetCollection="tags"
  type="multiple"
  label="Tags"
  maxItems={10}
  orderable  // Drag-and-drop reordering
/>

// With filtering based on form values
<RelationField
  name="assignee"
  targetCollection="users"
  filter={(formValues) => ({
    role: "editor",
    team: formValues.team,  // Dynamic filter
  })}
/>
```

### Relation Types

**Single (`type="single"`):**

- Renders as dropdown select
- Stores single ID
- Use for: one-to-one, many-to-one

**Multiple (`type="multiple"`):**

- Renders as tag list + picker modal
- Stores array of IDs
- Use for: one-to-many, many-to-many
- Supports drag-and-drop reordering if `orderable={true}`

### Relation Builder API

In collection config:

```typescript
.fields(({ r }) => ({
  author: r.relation({
    targetCollection: "users",  // ← Autocomplete!
  }),

  tags: r.relation({
    targetCollection: "tags",
    type: "multiple",
    maxItems: 10,
    orderable: true,
  }),
}))
```

### Embedded Collections

For complex nested data:

```typescript
import { EmbeddedCollectionField } from "@questpie/admin/components/fields";

<EmbeddedCollectionField
  name="addresses"
  label="Addresses"
  renderFields={(index) => (
    <>
      <TextField name={`addresses.${index}.street`} label="Street" />
      <TextField name={`addresses.${index}.city`} label="City" />
      <TextField name={`addresses.${index}.zip`} label="ZIP" />
    </>
  )}
/>
```

---

## Widgets

Widgets are reusable dashboard components with type-safe configuration.

### Creating Widgets

```typescript
import { widget } from "@questpie/admin/builder";
import type { WidgetComponentProps } from "@questpie/admin/builder";

// 1. Define config type
export type MyWidgetConfig = {
  title: string;
  collection: string;
  limit?: number;
};

// 2. Create component
export function MyWidget({ config }: WidgetComponentProps & { config: MyWidgetConfig }) {
  const { title, collection, limit = 10 } = config;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Widget content */}
      </CardContent>
    </Card>
  );
}

// 3. Register widget
const admin = qa()
  .use(coreAdminModule)
  .widgets({
    myWidget: widget("myWidget", {
      component: MyWidget,
    }),
  });
```

### Built-in Widget Types

- **Stats** - Numeric statistics with trend
- **Chart** - Line, bar, pie charts
- **Recent Items** - Latest records from a collection
- **Quick Actions** - Action buttons

---

## Custom Fields & Views

### Custom Field Component

```typescript
import type { BaseFieldProps } from "@questpie/admin/builder";

export type SlugFieldProps = BaseFieldProps & {
  // Custom options (will be inferred as ~options)
  sourceField?: string;
  transform?: (value: string) => string;
};

export function SlugField({
  name,
  value,
  onChange,
  label,
  sourceField,
  transform = (v) => v.toLowerCase().replace(/\s+/g, "-"),
  ...rest
}: SlugFieldProps) {
  const form = useFormContext();
  const sourceValue = form.watch(sourceField);

  useEffect(() => {
    if (sourceValue && !value) {
      onChange(transform(sourceValue));
    }
  }, [sourceValue]);

  return (
    <FieldWrapper name={name} label={label} {...rest}>
      <TextInput
        value={value ?? ""}
        onChange={onChange}
        placeholder="auto-generated-slug"
      />
    </FieldWrapper>
  );
}

// Register
const admin = qa()
  .use(coreAdminModule)
  .fields({
    slug: field("slug", {
      component: SlugField,
    }),
  });

// Use in collection
.fields(({ r }) => ({
  slug: r.slug({
    sourceField: "title",  // ← Options are inferred!
  }),
}))
```

### Custom List View

```typescript
import type { ListViewComponentProps } from "@questpie/admin/builder";

export function KanbanView({ collection, fields }: ListViewComponentProps) {
  const { data } = useCollectionList(collection);

  return (
    <div className="flex gap-4">
      {columns.map(column => (
        <KanbanColumn key={column} items={filterByColumn(data, column)} />
      ))}
    </div>
  );
}

// Register
const admin = qa()
  .use(coreAdminModule)
  .views({
    kanban: listView("kanban", {
      component: KanbanView,
    }),
  });
```

### Custom Edit View

```typescript
export function SplitView({ collection, id, fields }: EditViewComponentProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <CollectionForm collection={collection} id={id}>
          {/* Form fields */}
        </CollectionForm>
      </div>
      <div>
        {/* Preview pane */}
      </div>
    </div>
  );
}
```

---

## Best Practices

1. **Start from core module** - Don't reinvent built-in fields/views
2. **Use typed namespace** - `qa<App>().use(module).toNamespace()` for best DX
3. **Use type-safe navigation** - AdminLink over manual URLs
4. **Leverage field registry** - Reuse field definitions across collections
5. **Keep views simple** - Complex logic belongs in hooks
6. **IconComponent not strings** - Use actual React components for icons
7. **Validation on backend** - Admin automatically uses backend schemas
8. **Builder state is config** - No `.build()` needed

---

## Next Steps

- See `examples/tanstack-barbershop` for complete example
- Check `packages/admin/src/components` for all built-in components
- Review `specifications/` for detailed design docs
