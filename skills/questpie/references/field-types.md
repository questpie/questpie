# Field Types Reference

Complete configuration patterns for built-in QUESTPIE field types. Fields use a positional constructor argument followed by a fluent chain: `f.text(255).required().default("x")`, there is NO constructor-options object like `f.text({ required: true })`. Per-field sections below list only the **constructor argument(s)**; everything else (`.required()`, `.default()`, `.label()`, etc.) comes from the shared fluent methods.

## Contents

- [Common Fluent Methods (All Fields)](#common-fluent-methods-all-fields)
- [`f.text(maxLength?)`](#ftextmaxlength)
- [`f.textarea()`](#ftextarea)
- [`f.richText(options?)`](#frichtextoptions)
- [`f.email(maxLength?)`](#femailmaxlength)
- [`f.url(maxLength?)`](#furlmaxlength)
- [`f.number(mode?)`](#fnumbermode)
- [`f.boolean()`](#fboolean)
- [`f.date()`](#fdate)
- [`f.time(config?)`](#ftimeconfig)
- [`f.datetime(config?)`](#fdatetimeconfig)
- [`f.select(options)`](#fselectoptions)
- [`f.relation(target)`](#frelationtarget)
- [`f.upload(config?)`](#fuploadconfig)
- [`f.object(fields)`](#fobjectfields)
- [`.array()`](#array)
- [`f.blocks()`](#fblocks)
- [`f.json(config?)`](#fjsonconfig)
- [Reactive Admin Behaviors](#reactive-admin-behaviors)

## Common Fluent Methods (All Fields)

Every field factory returns a chainable field. These methods are shared by all field types:

| Method                          | Description                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `.required()`                   | Field must have a value (NOT NULL)                                                           |
| `.default(value)`               | Default value (value, `() => value`, or SQL)                                                 |
| `.label(text)`                  | Display label (supports i18n)                                                                |
| `.description(text)`            | Help text (supports i18n)                                                                    |
| `.localized()`                  | Per-locale values                                                                            |
| `.inputOptional()`              | Optional in API input but required in DB                                                     |
| `.inputFalse()`                 | Exclude from API input                                                                       |
| `.outputFalse()`                | Exclude from output, write-only field                                                        |
| `.array()`                      | Wrap as a repeatable array (see [`.array()`](#array))                                        |
| `.minItems(n)` / `.maxItems(n)` | Array item bounds                                                                            |
| `.admin(config)`                | Admin UI rendering hints (see [Reactive Admin Behaviors](#reactive-admin-behaviors))         |
| `.access(rules)`                | Per-field access control                                                                     |
| `.hooks(handlers)`              | Per-field lifecycle hooks                                                                    |
| `.virtual(sql?)`                | SQL expression for computed read-only field                                                  |
| `.zod(fn)`                      | Extend/replace Zod schema (output narrows value type)                                        |
| `.drizzle(fn)`                  | Raw Drizzle column builder, constraints/SQL defaults land in DDL; `$type` narrows value type |
| `.$type<T>()`                   | Explicitly set TS value type (type-level; mainly json)                                       |

> `.admin()` is contributed by the admin module. Type-specific helpers also exist (e.g. text `.pattern()`/`.trim()`, number `.min()`/`.max()`/`.positive()`/`.int()`/`.step()`, date `.autoNow()`); they are documented under each field below.

## `f.text(maxLength?)`

Short strings, titles, slugs. DB type: `varchar(maxLength)` (default `255`). Pass `{ mode: "text" }` for unlimited `text`.

Constructor arg: `maxLength?: number` (default `255`), or `{ mode: "text" }`.

Type-specific chain methods: `.pattern(re)`, `.trim()`, `.lowercase()`, `.uppercase()`, `.min(n)`, `.max(n)`.

```ts
name: f.text(255).required(),
slug: f.text(255).required().inputOptional(),
body: f.text({ mode: "text" }),
```

## `f.textarea()`

Long text, descriptions. DB type: `text`. Renders as a textarea in admin.

Constructor arg: none. Chain `.min(n)` / `.max(n)` for length bounds.

```ts
bio: f.textarea().localized(),
description: f.textarea().label({ en: "Description", sk: "Popis" }),
```

## `f.richText(options?)`

Rich formatted content. DB type: `jsonb` (TipTap document) by default, or `text` with `{ mode: "markdown" }`. Renders as a rich text editor in admin. Imported from the admin module's field set (available as `f.richText` in collection `.fields()`).

Constructor arg: `options?: { mode?: "json" | "markdown" }` (default `"json"`).

```ts
content: f.richText().localized(),
notes: f.richText({ mode: "markdown" }),
```

## `f.email(maxLength?)`

Email addresses with format validation. DB type: `varchar(maxLength)` (default `255`).

Constructor arg: `maxLength?: number` (default `255`). Chain `.min(n)` / `.max(n)` for length bounds.

```ts
email: f.email().required(),
contactEmail: f.email().label("Contact Email"),
```

## `f.url(maxLength?)`

URLs with format validation. DB type: `varchar(maxLength)` (default `2048`).

Constructor arg: `maxLength?: number` (default `2048`). Chain `.min(n)` / `.max(n)` for length bounds.

```ts
website: f.url(),
link: f.url(500).label("Profile URL"),
```

## `f.number(mode?)`

Numeric values. DB type depends on mode: `integer` (default), `smallint`, `bigint`, `real`, `double`, or `numeric` (decimal).

Constructor arg: a mode string (`"integer" | "smallint" | "bigint" | "real" | "double"`) OR a decimal config `{ mode: "decimal"; precision?: number; scale?: number }`.

Type-specific chain methods: `.min(n)`, `.max(n)`, `.positive()`, `.int()`, `.step(n)`.

```ts
sortOrder: f.number().default(0),
price: f.number({ mode: "decimal", precision: 10, scale: 2 }).required().min(0),
rating: f.number("real").min(0).max(5),
```

## `f.boolean()`

Boolean flags. DB type: `boolean`.

Constructor arg: none.

```ts
isActive: f.boolean().default(true).required(),
isFeatured: f.boolean().default(false),
```

Render as a switch via `.admin()`:

```ts
isActive: f.boolean().default(true).admin({ displayAs: "switch" }),
```

## `f.date()`

Calendar dates (exact `YYYY-MM-DD` string, never `Date`). DB type: `date`.

Constructor arg: none. Type-specific chain methods: `.autoNow()` (default to the current UTC `YYYY-MM-DD` on create), `.autoNowUpdate()` (set that UTC date string on every write).

```ts
publishedAt: f.date(),
birthDate: f.date().required(),
startDate: f.date().default("2024-01-01"),
```

## `f.time(config?)`

Time of day (`HH:MM:SS`). DB type: `time`.

Constructor arg: `config?: { precision?: 0-6; withSeconds?: boolean }`.

```ts
startTime: f.time().label("Start"),
eventTime: f.time({ precision: 3 }),
```

## `f.datetime(config?)`

One instant. Default DB type: `timestamptz(3)`. Server and official typed-client value is a `Date`; plain JSON/MCP/OpenAPI input is RFC 3339 with `Z` or an explicit offset. Reject timezone-less strings rather than guessing.

Constructor arg: `config?: { precision?: 0-6; withTimezone?: boolean }`. Type-specific chain methods: `.autoNow()`, `.autoNowUpdate()`.

```ts
scheduledAt: f.datetime().required(),
createdAt: f.datetime().autoNow().inputFalse(),
updatedAt: f.datetime().autoNowUpdate().inputFalse(),
```

Nested `Date` values survive official HTTP, realtime, Channels, and supported TanStack hydration through explicit type metadata. Never implement an ISO-looking-string reviver: `f.date()` and ordinary strings must stay strings.

## `f.select(options)`

Single value from a predefined list. DB type: `varchar`.

Constructor arg: `options: SelectOption[]`, an array of objects (there is no bare `string[]` overload). Each option:

| Key           | Type                 | Description                               |
| ------------- | -------------------- | ----------------------------------------- |
| `value`       | `string \| number`   | Stored value (REQUIRED)                   |
| `label`       | `string \| i18n`     | Display label (REQUIRED)                  |
| `description` | `string \| i18n`     | Optional helper text                      |
| `icon`        | `ComponentReference` | Optional icon (e.g. `c.icon("ph:check")`) |
| `disabled`    | `boolean`            | Disable this option                       |

Multi-select is `.array()`; the type-specific `.enum(name)` switches storage to a Postgres enum.

```ts
status: f.select([
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
]).default("draft").required(),
```

Options with i18n labels:

```ts
status: f.select([
  { value: "pending", label: { en: "Pending", sk: "Cakajuce" } },
  { value: "confirmed", label: { en: "Confirmed", sk: "Potvrdene" } },
  { value: "completed", label: { en: "Completed", sk: "Dokoncene" } },
]).required().default("pending"),
```

## `f.relation(target)`

Reference to another collection. The target is positional.

Constructor arg: `target` is one of:

- a collection-name string, `f.relation("user")`
- a lazy ref `() => collection`, `f.relation(() => users)` (avoids import cycles)
- a polymorphic map, `f.relation({ users: "users", posts: "posts" })`

By default this is a belongs-to (single FK column). Chain methods configure it:

- **Chained modifiers**: `.required()`, `.label()`, `.onDelete(action)`, `.onUpdate(action)`, `.relationName(name)`, `action` is `"cascade" | "set null" | "restrict"` (etc.).
- **Transition methods** (change the relation shape): `.hasMany({ foreignKey })`, `.manyToMany({ through, sourceField?, targetField? })`, `.multiple()` (inline `jsonb` array of FKs).

Belongs-to (single):

```ts
author: f.relation("user").required(),
category: f.relation("categories").onDelete("set null"),
```

Lazy ref (import-cycle-safe):

```ts
import { barbers } from "@/questpie/server/collections/barbers";
barber: f.relation(() => barbers).required().onDelete("cascade"),
```

Many-to-many (through junction):

```ts
tags: f.relation("tags").manyToMany({
  through: "postTags",
  sourceField: "post",
  targetField: "tag",
}),
```

Multiple (inline array of FKs, no junction):

```ts
images: f.relation("assets").multiple(),
```

Dynamic options (admin):

```ts
city: f.relation("cities").admin({
  filter: ({ data }) => ({ countryId: data.country }),
}),
```

## `f.upload(config?)`

File upload linked to a storage collection.

Constructor arg: `config?` with `to?: string` (target upload collection, defaults `"assets"`), `mimeTypes?: string[]`, `maxSize?: number` (bytes), and M2M keys `through?`/`sourceField?`/`targetField?`. Label is chained, not a config key.

Type-specific chain method: `.multiple()` (inline array of asset IDs).

```ts
avatar: f.upload({ mimeTypes: ["image/*"], maxSize: 5_000_000 }).label("Avatar"),
document: f.upload({ to: "media", mimeTypes: ["application/pdf"] }),
cover: f.upload(),
gallery: f.upload({ mimeTypes: ["image/*"] }).multiple(),
```

## `f.object(fields)`

Nested structured data stored as JSONB.

Constructor arg: `fields`, a plain record of nested fields, passed **directly** (not wrapped in `{ fields }`).

```ts
address: f.object({
  street: f.text().required(),
  city: f.text().required(),
  zip: f.text(10),
}),
```

Reuse nested shapes with a helper that returns a field record:

```ts
.fields(({ f }) => {
  const daySchedule = () => ({
    isOpen: f.boolean().default(true),
    start: f.time(),
    end: f.time(),
  });

  return {
    workingHours: f.object({
      monday: f.object(daySchedule()),
      tuesday: f.object(daySchedule()),
    }),
  };
})
```

## `.array()`

Repeatable items stored as JSONB. `.array()` is a **zero-argument** chain method on any field, the item type IS the field you call it on. Bounds and labels are chained.

Chain after `.array()`: `.minItems(n)`, `.maxItems(n)`, `.localized()`, `.label()`, `.admin({ orderable, mode, ... })`.

Array of primitives:

```ts
tags: f.text().array(),
```

Array of objects:

```ts
socialLinks: f.object({
  platform: f.select([
    { value: "instagram", label: "Instagram" },
    { value: "facebook", label: "Facebook" },
    { value: "twitter", label: "Twitter" },
  ]),
  url: f.url(),
}).array().maxItems(5),
```

Localized array (each locale has its own array):

```ts
navigation: f.object({
  label: f.text().required(),
  href: f.text().required(),
  isExternal: f.boolean().default(false),
}).array().localized(),
```

Orderable inline array in admin:

```ts
items: f.object({ name: f.text() }).array().admin({ orderable: true, mode: "inline" }),
```

## `f.blocks()`

Content blocks for page builders. Stored as JSONB. Imported from the admin module's field set (available as `f.blocks` in collection `.fields()`).

Constructor arg: none. Chain `.localized()`, `.label()`, `.admin()`.

```ts
content: f.blocks().localized(),
pageContent: f.blocks(),
```

## `f.json(config?)`

Raw JSON data. No schema validation by default; value types as loose `JsonValue`. DB type: `jsonb` (or `json` with `{ mode: "json" }`).

Constructor arg: `config?: { mode?: "jsonb" | "json" }`.

```ts
metadata: f.json(),
rawConfig: f.json({ mode: "json" }).label("Configuration"),
```

Type it explicitly with `.$type<T>()` (type only) or `.zod()` (type + runtime validation), the type flows into CRUD select/insert types:

```ts
type Layout = { rows: { id: string; span: number }[] };

layout: f.json().$type<Layout>(),
settings: f.json().zod(() => z.object({ theme: z.enum(["light", "dark"]) })),
```

## Reactive Admin Behaviors

Admin rendering hints and reactive behaviors are authored with the chained `.admin({...})` call. Beyond per-field display options (`placeholder`, `displayAs`, `orderable`, `mode`, ...), every field's `.admin()` accepts reactive behaviors:

| Behavior   | Type                                                   | Description                  |
| ---------- | ------------------------------------------------------ | ---------------------------- |
| `hidden`   | `boolean \| ({ data }) => boolean`                     | Conditionally hide the field |
| `readOnly` | `boolean \| ({ data }) => boolean`                     | Conditionally make read-only |
| `disabled` | `boolean \| ({ data }) => boolean`                     | Conditionally disable        |
| `compute`  | `({ data }) => value` or `{ handler, deps, debounce }` | Auto-compute the value       |

```ts
slug: f.text().admin({ placeholder: "auto-generated" }),
isActive: f.boolean().default(true).admin({ displayAs: "switch" }),

// Reactive: hide until advanced mode is on
seoTitle: f.text().admin({ hidden: ({ data }) => !data.showAdvanced }),

// Reactive: auto-generate slug from title
slug: f.text().admin({
  compute: {
    handler: ({ data }) => slugify(data.title),
    deps: ["title"],
    debounce: 300,
  },
}),
```

All reactive handlers run server-side with access to `ctx.db`, `ctx.user`, `ctx.req`.

## Per-field components

A component is normally chosen by field **type**: the admin registry maps `text`
to one form component and one table cell, shared by every `f.text()`. To give a
single field its own components without declaring a new field type, name them in
`.admin({ components })`:

```ts
status: f.select(STATUSES).admin({
  components: { cell: "status-pill" },
}),
notes: f.textarea().admin({
  components: { field: "markdown-editor", cell: "truncated-text" },
}),
```

| Slot    | Replaces                      |
| ------- | ----------------------------- |
| `field` | the form input for this field |
| `cell`  | the table cell for this field |

The value is a **registry key**, not a component. `.admin()` is serialized from
the server through field introspection, so it cannot carry a function — the key
is resolved on the client against the admin component registry (`custom` first,
then registered field types). The object form `{ type: "status-pill", props: {} }`
is also accepted.

An unrecognised key falls back to the by-type component rather than rendering
nothing, so a typo degrades to the default instead of blanking the field.

Precedence for a cell, highest first: a `.list()` column `cell` (declared on the
view, most local) → this `components.cell` slot → the field type's registered
cell → the built-in default.
