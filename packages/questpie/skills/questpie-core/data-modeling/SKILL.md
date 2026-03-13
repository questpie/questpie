---
name: questpie-core/data-modeling
type: sub-skill
requires: [questpie-core]
---

This skill builds on questpie-core. It covers collections, globals, fields, relations, and localization -- the data modeling layer of QUESTPIE.

## Imports

All data modeling APIs are imported from the `#questpie` alias (codegen-resolved):

```ts
import { collection, global, locale } from "#questpie";
```

Drizzle index helpers come from `drizzle-orm/pg-core`:

```ts
import { uniqueIndex, index } from "drizzle-orm/pg-core";
```

## Collections

A collection is a database-backed data model. Each collection file exports a builder chain:

```ts title="collections/posts.ts"
import { collection } from "#questpie";

export default collection("posts")
  .fields(({ f }) => ({
    title: f.text({ required: true, maxLength: 255 }),
    body: f.richText({ localized: true }),
    cover: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
    status: f.select({ options: ["draft", "published"], default: "draft" }),
    publishedAt: f.date(),
  }))
  .title(({ f }) => f.title)
  .admin(({ c }) => ({
    label: { en: "Posts" },
    icon: c.icon("ph:article"),
  }))
  .options({ timestamps: true, versioning: true });
```

### Builder Chain Methods

| Method | Purpose |
|---|---|
| `.fields(({ f }) => ({...}))` | Define data fields |
| `.title(({ f }) => f.name)` | Record display title |
| `.admin(({ c }) => ({...}))` | Admin UI metadata (label, icon, hidden) |
| `.indexes(({ table }) => [...])` | Database indexes |
| `.list(({ v, f }) => v.collectionTable({...}))` | List view config |
| `.form(({ v, f }) => v.collectionForm({...}))` | Form view config |
| `.hooks({...})` | Lifecycle hooks |
| `.access({...})` | Access control rules |
| `.preview({...})` | Live preview config |
| `.options({...})` | Timestamps, versioning, soft delete |
| `.search({...})` | Search indexing |
| `.searchable(string[])` | Searchable fields |

### Collection Options

```ts
.options({
  timestamps: true,   // adds createdAt, updatedAt
  versioning: true,   // track content versions
  softDelete: true,   // mark as deleted instead of removing
})
```

### Indexes

```ts
import { uniqueIndex } from "drizzle-orm/pg-core";

.indexes(({ table }) => [
  uniqueIndex("posts_slug_unique").on(table.slug),
])
```

### Live Preview

```ts
.preview({
  enabled: true,
  position: "right",     // "right" | "bottom"
  defaultWidth: 50,
  url: ({ record }) => `/posts/${record.slug}?preview=true`,
})
```

### Access Control

```ts
.access({
  read: true,
  create: ({ session }) => session?.user?.role === "admin",
  update: ({ session }) => session?.user?.role === "admin",
  delete: ({ session }) => session?.user?.role === "admin",
})
```

### CRUD Operations (Server-Side)

```ts
const { collections } = context;

// Find many
const results = await collections.posts.find({
  where: { status: "published" },
  orderBy: { publishedAt: "desc" },
  limit: 10,
  offset: 0,
});
// results.docs: Post[], results.totalDocs: number

// Find one
const post = await collections.posts.findOne({ where: { id: "abc" } });

// Create
const newPost = await collections.posts.create({
  title: "Hello",
  body: "<p>World</p>",
  status: "draft",
});

// Update
await collections.posts.update({
  where: { id: "abc" },
  data: { status: "published" },
});

// Delete
await collections.posts.delete({ where: { id: "abc" } });

// Count
const count = await collections.posts.count({ where: { status: "published" } });
```

## Globals

A global is a singleton -- one record, no list view. Use for site-wide settings:

```ts title="globals/site-settings.ts"
import { global } from "#questpie";

export const siteSettings = global("site_settings")
  .fields(({ f }) => ({
    shopName: f.text({ required: true, default: "My App" }),
    tagline: f.text({ localized: true }),
    logo: f.upload({ to: "assets" }),
    contactEmail: f.email({ required: true }),
  }))
  .admin(({ c }) => ({
    label: { en: "Site Settings" },
    icon: c.icon("ph:gear"),
  }))
  .options({ timestamps: true, versioning: true })
  .access({
    read: true,
    update: ({ session }) => session?.user?.role === "admin",
  });
```

### Global Builder Methods

Globals share most methods with collections but do NOT support `.list()`, `.indexes()`, `.title()`, or `.preview()`.

| Method | Purpose |
|---|---|
| `.fields(({ f }) => ({...}))` | Define data fields |
| `.admin(({ c }) => ({...}))` | Admin label and icon |
| `.form(({ v, f }) => v.globalForm({...}))` | Form layout |
| `.hooks({...})` | Lifecycle hooks |
| `.access({...})` | Read/update access control |
| `.options({...})` | Timestamps, versioning |

### Global API

```ts
// Server-side
const settings = await globals.siteSettings.get();
await globals.siteSettings.update({ shopName: "New Name" });

// Client-side
const settings = await client.globals.siteSettings.get();
await client.globals.siteSettings.update({ shopName: "New Name" });
```

## Fields

Fields are defined inside `.fields()` using the `f` builder. Each field drives the database column, API validation, query operators, client types, and admin UI.

### Field Types Overview

| Field | DB Type | Use Case |
|---|---|---|
| `f.text()` | `varchar` / `text` | Short strings, titles, slugs |
| `f.textarea()` | `text` | Long text, descriptions |
| `f.richText()` | `text` (HTML) | Rich formatted content |
| `f.email()` | `varchar` | Email addresses (validated) |
| `f.url()` | `varchar` | URLs (validated) |
| `f.number()` | `integer` / `numeric` | Counts, prices, quantities |
| `f.boolean()` | `boolean` | Flags, toggles |
| `f.date()` | `date` | Calendar dates |
| `f.time()` | `time` | Time of day |
| `f.datetime()` | `timestamp` | Date + time |
| `f.select()` | `varchar` | Single choice from list |
| `f.relation()` | FK column | Reference to another collection |
| `f.upload()` | FK column | File upload linked to storage |
| `f.object()` | `jsonb` | Nested structured data |
| `f.array()` | `jsonb` | Repeatable items |
| `f.blocks()` | `jsonb` | Page builder content blocks |
| `f.json()` | `jsonb` | Raw JSON |

See `references/field-types.md` for complete config options per field type.

### Common Field Options

Every field accepts:

| Option | Type | Description |
|---|---|---|
| `required` | `boolean` | Field must have a value |
| `default` | `T` | Default value |
| `label` | `string \| Record<string, string>` | Display label (supports i18n) |
| `description` | `string \| Record<string, string>` | Help text |
| `localized` | `boolean` | Enable per-locale values |
| `input` | `"optional"` | Optional in API input but required in DB |
| `meta` | `object` | Admin UI rendering hints |
| `virtual` | `SQL` | SQL expression for computed fields |

### Virtual (Computed) Fields

```ts
import { sql } from "questpie";

displayTitle: f.text({
  virtual: sql<string>`(
    SELECT COALESCE(name, 'Unknown') || ' - ' ||
    TO_CHAR("scheduledAt", 'YYYY-MM-DD HH24:MI')
    FROM appointments WHERE id = appointments.id
  )`,
}),
```

Virtual fields are read-only -- they appear in queries but cannot be written to.

## Relations

All relations are defined via `f.relation()` inside `.fields()`.

### Belongs-To (Single)

```ts
author: f.relation({ to: "users", required: true }),
barber: f.relation({ to: "barbers", required: true, onDelete: "cascade" }),
```

Creates a foreign key column pointing to the target collection's `id`.

### Many-to-Many (Through Junction)

Requires a junction collection plus `through`, `sourceField`, and `targetField`:

```ts title="collections/barber-services.ts"
import { collection } from "#questpie";

// Junction table
export default collection("barberServices")
  .fields(({ f }) => ({
    barber: f.relation({ to: "barbers", required: true, onDelete: "cascade" }),
    service: f.relation({ to: "services", required: true, onDelete: "cascade" }),
  }))
  .admin(({ c }) => ({ hidden: true }));
```

```ts title="collections/barbers.ts (inside .fields())"
services: f.relation({
  to: "services",
  hasMany: true,
  through: "barberServices",
  sourceField: "barber",   // FK in junction pointing to THIS collection
  targetField: "service",  // FK in junction pointing to TARGET collection
}),
```

```ts title="collections/services.ts (inside .fields())"
barbers: f.relation({
  to: "barbers",
  hasMany: true,
  through: "barberServices",
  sourceField: "service",
  targetField: "barber",
}),
```

### Querying Relations

```ts
// Include related data
const barber = await collections.barbers.findOne({
  where: { id: "abc" },
  with: { services: true },
});
// barber.services: Service[]

// Filter by relation
const appointments = await collections.appointments.find({
  where: { barber: barberId, status: "pending" },
});
```

## Localization

### Locale Configuration

```ts title="locale.ts"
import { locale } from "#questpie";

export default locale({
  locales: [
    { code: "en", label: "English", fallback: true, flagCountryCode: "us" },
    { code: "sk", label: "Slovencina" },
    { code: "de", label: "Deutsch" },
  ],
  defaultLocale: "en",
});
```

### Localizing Fields

Add `localized: true` to any field that needs per-locale content:

```ts
name: f.text({ required: true, localized: true }),
description: f.textarea({ localized: true }),
price: f.number({ required: true }),  // NOT localized -- same in all locales
```

Localizable types: `text`, `textarea`, `richText`, `select`, `array`, `blocks`.
Typically NOT localized: `number`, `boolean`, `date`, `relation`.

### Localized Arrays

Arrays can be localized as a whole -- each locale gets its own array:

```ts
navigation: f.array({
  localized: true,
  of: f.object({
    fields: {
      label: f.text({ required: true }),
      href: f.text({ required: true }),
    },
  }),
}),
```

### Querying Localized Content

```ts
// Server-side -- locale comes from request context
const services = await collections.services.find({ where: { isActive: true } });

// Client-side -- set locale explicitly
client.setLocale("sk");
const services = await client.collections.services.find({ where: { isActive: true } });
```

### Admin UI Locale (Separate)

The admin panel has its own locale config for the interface language:

```ts title="admin-locale.ts"
import { adminLocale } from "#questpie";

export default adminLocale({
  locales: ["en", "sk"],
  defaultLocale: "en",
});
```

This controls the admin interface language, NOT content locales.

## Nested Objects and Reusable Patterns

Use helper functions to avoid repetition in object fields:

```ts
.fields(({ f }) => {
  const daySchedule = () => ({
    isOpen: f.boolean({ default: true }),
    start: f.time(),
    end: f.time(),
  });

  return {
    workingHours: f.object({
      fields: () => ({
        monday: f.object({ fields: daySchedule }),
        tuesday: f.object({ fields: daySchedule }),
        wednesday: f.object({ fields: daySchedule }),
      }),
    }),
  };
})
```

## Form Layout

```ts
.form(({ v, f }) =>
  v.collectionForm({
    sidebar: {
      position: "right",
      fields: [f.isActive, f.avatar],
    },
    fields: [
      {
        type: "section",
        label: { en: "Contact Information" },
        layout: "grid",
        columns: 2,
        fields: [f.name, f.slug, f.email, f.phone],
      },
      {
        type: "section",
        label: { en: "Profile" },
        fields: [f.bio],
      },
    ],
  }),
)
```

## Common Mistakes

### CRITICAL: Using `.relations()` method

The `.relations()` builder method was removed. All relations are now defined via `f.relation()` inside `.fields()`.

```ts
// WRONG -- .relations() does not exist
collection("posts").relations({ author: belongsTo("users") })

// CORRECT -- use f.relation() inside .fields()
collection("posts").fields(({ f }) => ({
  author: f.relation({ to: "users" }),
}))
```

### HIGH: Forgetting `export default`

Codegen discovers collections/globals by their default export. Without it, the file is silently ignored.

```ts
// WRONG -- no default export, codegen won't find it
export const posts = collection("posts").fields(/* ... */);

// CORRECT
export default collection("posts").fields(/* ... */);
```

Note: named exports alongside default are fine (e.g., `export const posts = ...` followed by `export default posts`).

### HIGH: hasMany without junction table config

A `hasMany: true` relation MUST specify `through`, `sourceField`, and `targetField`. There is no implicit reverse lookup.

```ts
// WRONG -- missing through/sourceField/targetField
services: f.relation({ to: "services", hasMany: true })

// CORRECT
services: f.relation({
  to: "services",
  hasMany: true,
  through: "barberServices",
  sourceField: "barber",
  targetField: "service",
})
```

### MEDIUM: Forgetting `localized: true`

If content should vary by locale but the field is not marked `localized: true`, the data will not be stored in the i18n table and queries with different locales will return the same value.

### MEDIUM: Object fields -- function vs plain object

Both `f.object({ fields: {...} })` and `f.object({ fields: () => ({...}) })` are valid. Use the function form when reusing helpers or referencing `f`.
