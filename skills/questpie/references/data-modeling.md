---
name: questpie-core/data-modeling
---

This skill builds on questpie-core. It covers collections, globals, fields, relations, and localization -- the data modeling layer of QUESTPIE.

## Contents

- [Imports](#imports)
- [Collections](#collections), including [Record Lifecycle](#record-lifecycle): timestamps, softDelete, versioning, workflow
- [Globals](#globals)
- [Fields](#fields)
- [Relations](#relations)
- [Localization](#localization)
- [Nested Objects and Reusable Patterns](#nested-objects-and-reusable-patterns)
- [Form Layout](#form-layout)
- [Common Mistakes](#common-mistakes)

## Imports

Data model files import generated factories from the `#questpie/factories` alias:

```ts
import { collection, global } from "#questpie/factories";
```

Drizzle index helpers come from `questpie/drizzle-pg-core`:

```ts
import { uniqueIndex, index } from "questpie/drizzle-pg-core";
```

## Collections

A collection is a database-backed data model. Each collection file exports a builder chain:

```ts title="collections/posts.ts"
import { collection } from "#questpie/factories";

export default collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required(),
		body: f.richText().localized(),
		cover: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
		status: f
			.select([
				{ value: "draft", label: "Draft" },
				{ value: "published", label: "Published" },
			])
			.default("draft"),
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

| Method                                          | Purpose                                 |
| ----------------------------------------------- | --------------------------------------- |
| `.fields(({ f }) => ({...}))`                   | Define data fields                      |
| `.title(({ f }) => f.name)`                     | Record display title                    |
| `.admin(({ c }) => ({...}))`                    | Admin UI metadata (label, icon, hidden) |
| `.indexes(({ table }) => [...])`                | Database indexes                        |
| `.list(({ v, f }) => v.collectionTable({...}))` | List view config                        |
| `.form(({ v, f }) => v.collectionForm({...}))`  | Form view config                        |
| `.hooks({...})`                                 | Lifecycle hooks                         |
| `.access({...})`                                | Access control rules                    |
| `.preview({...})`                               | Live preview config                     |
| `.options({...})`                               | Timestamps, versioning, soft delete     |
| `.searchable({...})`                            | Search indexing config (see below)      |
| `.merge(other)`                                 | Extend a same-name builder (see below)  |

### Extending Collections, `.merge()`

To extend a collection a module already provides, merge its builder, never redefine the collection from scratch (same-key registration replaces the module's collection wholesale):

```ts
import { starterModule } from "questpie/app";
import { collection } from "#questpie/factories";

export default collection("user")
	.merge(starterModule.collections.user)
	.fields(({ f }) => ({
		internalNotes: f.textarea(),
	}));
```

Fields/options/extension keys combine by key (merged-in side wins), hooks concatenate, and `.fields()` after `.merge()` is cumulative, it never wipes merged fields. The result stays fully typed.

### Record Lifecycle

Four options that all sound alike and do different jobs. Pick by the job, not by
the name, because adopting the wrong one is silent: nothing errors, you simply
do not get the guarantee you assumed.

| You need                                          | Use                   | QUESTPIE provides it |
| ------------------------------------------------- | --------------------- | -------------------- |
| When a row was created/changed                    | `timestamps: true`    | Yes                  |
| Recover a deleted row / keep referential history  | `softDelete: true`    | Yes                  |
| The history of past states, and revert to one     | `versioning: true`    | Yes                  |
| Legal stage transitions (draft to review to live) | `versioning.workflow` | Yes                  |
| Reject a write made against a stale read          | optimistic locking    | **No, build it**     |
| Who did what, for accountability                  | audit                 | Separate concern     |

```ts
.options({
  timestamps: true,
  softDelete: true,
  versioning: { maxVersions: 50, workflow: { stages: ["draft", "published"] } },
})
```

#### timestamps

Adds `createdAt` and `updatedAt`, maintained by the framework.

#### softDelete

`delete()` marks the row instead of removing it. Reads exclude soft-deleted rows
unless you pass `includeDeleted: true`.

#### versioning

`versioning: true` (or `{ maxVersions }`) creates a `<collection>_versions`
table alongside the collection, and a `<collection>_i18n_versions` table when the
collection is localized.

Columns: `versionId` (uuid primary key), `id` (the record, typed to match the
parent id column), `versionNumber`, `versionOperation` (`create` / `update` /
`delete`), `versionStage`, `versionFromStage`, `versionUserId`,
`versionCreatedAt`.

A row is written on **create, update and delete** (both soft and hard). History
is **per record**: `versionNumber` counts up per `id`, and pruning to
`maxVersions` (default 50) applies per record, not per collection.

Read it back with:

```ts
const history = await ctx.collections.posts.findVersions({ id, limit: 20 });
const restored = await ctx.collections.posts.revertToVersion({
	id,
	versionNumber: 3,
});
```

**What versioning does NOT do: it is not optimistic locking.** There is no
`expectedVersion` parameter anywhere in the API. The server never compares a
client-supplied version against the stored one and never rejects a stale write.
Two concurrent updates both succeed, both write a version row, and the second
silently wins. If you need compare-and-set, you build it yourself, and today that
means a column of your own plus `updateMany({ where: { id, version: expected } })`
with a `count !== 1` check. `versionNumber` is history, written after the fact.

#### Workflow stages

Workflow lives **under** versioning because stage transitions are stored as
version snapshots. Enabling workflow with versioning disabled throws at build
time: `"Collection X enables workflow but versioning is disabled"`.

```ts
.options({
  versioning: {
    workflow: {
      stages: {
        draft:     { transitions: ["review"] },
        review:    { transitions: ["draft", "published"] },
        published: { transitions: ["draft"] },
      },
      initialStage: "draft",
    },
  },
})
```

`workflow: true` is shorthand for stages `["draft", "published"]`. `stages` also
accepts a plain `string[]`. A stage with no `transitions` key is unrestricted:
any configured stage may be targeted from it. `initialStage` defaults to the
first configured stage.

Transition through the CRUD API, not by writing a field:

```ts
await ctx.collections.posts.transitionStage({ id, stage: "published" });
// or schedule it
await ctx.collections.posts.transitionStage({
	id,
	stage: "published",
	scheduledAt: futureDate,
});
```

`transitionStage` performs **no data mutation**. It creates a version snapshot at
the target stage. Read a specific stage back with `find({ stage: "published" })`.

Validated at **config time**: stage names, `initialStage` existing, and every
transition target naming a configured stage. Validated at **call time**: that the
transition from the record's current stage to the requested one is in the table.

Enabling workflow also adds `versionStage` / `versionFromStage` columns,
`beforeTransition` / `afterTransition` hooks, and an `access.transition` rule.

**What workflow does NOT do: the stage table carries no condition.** A stage
option is `{ label, description, transitions }` and nothing else, so the table
is static shape only. There is no guard or predicate on a transition, and no way
to express "legal only when `reviewRequired` is false" in the config.

Put the condition in a `beforeTransition` hook, which aborts the transition when
it throws, or in `access.transition` when the rule is about who may move the
record rather than about its data:

```ts
.hooks({
  beforeTransition: async ({ data, to }) => {
    if (to === "published" && data.reviewRequired) {
      throw new Error("cannot publish while review is pending");
    }
  },
})
```

### Indexes

```ts
import { uniqueIndex } from "questpie/drizzle-pg-core";

.indexes(({ table }) => [
  uniqueIndex("posts_slug_unique").on(table.slug),
])
```

### Search Indexing, `.searchable()`

`.searchable()` takes a config object whose keys map a record to indexable text/metadata/embeddings, NOT a string array. There is no `.search()` method.

```ts
.searchable({
  content: (record) => extractTextFromJson(record.body),
  metadata: (record) => ({ status: record.status }),
  embeddings: async (record, ctx) => ctx.app.embeddings.generate(record.title),
})
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

Live Preview uses the existing admin `FormView`, Preview button, `LivePreviewMode`, and iframe. Do not introduce a separate visual-edit form API, a second default form view, or parallel preview API names.

When workflow is the publication source for pages, public reads use `stage: "published"` and preview/draft-mode reads can load the working stage for authorized editors. Do not add duplicate publication booleans for the same concern.

### Access Control

```ts
.access({
  read: true,
  create: ({ session }) => session?.user?.role === "admin",
  update: ({ session }) => session?.user?.role === "admin",
  delete: ({ session }) => session?.user?.role === "admin",
})
```

All access kinds and when each is checked:

| Kind         | Gates                                                    |
| ------------ | -------------------------------------------------------- |
| `read`       | Listing and fetching records                             |
| `create`     | Creating records                                         |
| `update`     | Updating records                                         |
| `delete`     | Deleting records                                         |
| `transition` | Workflow stage transitions (falls back to `update`)      |
| `serve`      | Upload file bytes by key (`GET /:collection/files/:key`) |
| `introspect` | Schema/meta routes (`GET /:collection/{schema,meta}`)    |

Resolution chain for every kind: collection `.access()` → app `defaultAccess`
(from `appConfig({ access })`) → require session. No hidden framework grants, deny-all `defaultAccess` really closes the whole REST surface. Two kinds have
specialized fallbacks:

- `serve`: `serve` → explicit collection `read` (row-aware, `ctx.data` = upload
  row) → `defaultAccess.serve` → allow. `visibility: "public"` means bytes are
  servable by key; it never makes rows listable. Private files additionally
  always require the signed token.
- `introspect`: `introspect` → `defaultAccess.introspect` → visible iff at
  least one CRUD operation is allowed (so `create: true` form collections keep
  their validation schema readable; deny-all apps expose no schemas).

Upload population: `f.upload()` fields populate through the PARENT row's read
decision, a public gallery (`read: true`) shows its assets (with `url`) to
anonymous readers even when the assets collection itself is unlistable.
Field-level read rules on the upload collection still apply inside population.
Hand-written `f.relation()` fields keep normal target-collection access.

### CRUD Operations (Server-Side)

Server and client CRUD vocabulary, full options, return shapes, atomic/conditional updates, and transactions: `references/crud-api.md`.

## Globals

A global is a singleton -- one record, no list view. Use for site-wide settings:

```ts title="globals/site-settings.ts"
import { global } from "#questpie/factories";

export const siteSettings = global("siteSettings")
	.fields(({ f }) => ({
		shopName: f.text().required().default("My App"),
		tagline: f.text().localized(),
		logo: f.upload({ to: "assets" }),
		contactEmail: f.email().required(),
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

| Method                                     | Purpose                    |
| ------------------------------------------ | -------------------------- |
| `.fields(({ f }) => ({...}))`              | Define data fields         |
| `.admin(({ c }) => ({...}))`               | Admin label and icon       |
| `.form(({ v, f }) => v.globalForm({...}))` | Form layout                |
| `.hooks({...})`                            | Lifecycle hooks            |
| `.access({...})`                           | Read/update access control |
| `.options({...})`                          | Timestamps, versioning     |

### Global API

Globals expose `get()` / `update()` (plus versioning methods when enabled), server- and client-side. Full signatures: `references/crud-api.md`.

## Fields

Fields are defined inside `.fields()` using the `f` builder. Each field drives the database column, API validation, query operators, client types, and admin UI.

### Field Types Overview

| Field          | DB Type               | Use Case                        |
| -------------- | --------------------- | ------------------------------- |
| `f.text()`     | `varchar` / `text`    | Short strings, titles, slugs    |
| `f.textarea()` | `text`                | Long text, descriptions         |
| `f.richText()` | `jsonb` (TipTap)      | Rich formatted content          |
| `f.email()`    | `varchar`             | Email addresses (validated)     |
| `f.url()`      | `varchar`             | URLs (validated)                |
| `f.number()`   | `integer` / `numeric` | Counts, prices, quantities      |
| `f.boolean()`  | `boolean`             | Flags, toggles                  |
| `f.date()`     | `date`                | Calendar dates                  |
| `f.time()`     | `time`                | Time of day                     |
| `f.datetime()` | `timestamp`           | Date + time                     |
| `f.select()`   | `varchar`             | Single choice from list         |
| `f.relation()` | FK column             | Reference to another collection |
| `f.upload()`   | FK column             | File upload linked to storage   |
| `f.object()`   | `jsonb`               | Nested structured data          |
| `.array()`     | `jsonb`               | Repeatable items                |
| `f.blocks()`   | `jsonb`               | Page builder content blocks     |
| `f.json()`     | `jsonb`               | Raw JSON                        |

See `references/field-types.md` for complete config options per field type.

### Common Field Methods

Fields take a positional constructor argument (e.g. `f.text(255)`, `f.select([...])`), then a fluent chain. There is NO constructor-options object. Common chain methods on every field:

| Method               | Description                              |
| -------------------- | ---------------------------------------- |
| `.required()`        | Field must have a value                  |
| `.default(value)`    | Default value                            |
| `.label(text)`       | Display label (supports i18n)            |
| `.description(text)` | Help text (supports i18n)                |
| `.localized()`       | Enable per-locale values                 |
| `.inputOptional()`   | Optional in API input but required in DB |
| `.outputFalse()`     | Exclude from output, write-only field    |
| `.array()`           | Wrap as a repeatable array               |
| `.admin(config)`     | Admin UI rendering hints                 |
| `.virtual(sql)`      | SQL expression for computed fields       |

```ts
title: f.text(255).required(),
slug: f.text(255).required().inputOptional(),
passwordHash: f.text().outputFalse(),  // accepted on input, never returned
```

See `references/field-types.md` for the full per-field constructor args and type-specific methods.

### Virtual (Computed) Fields

```ts
import { sql } from "questpie/builders";
displayTitle: f.text().virtual(sql<string>`(
    SELECT COALESCE(name, 'Unknown') || ' - ' ||
    TO_CHAR("scheduledAt", 'YYYY-MM-DD HH24:MI')
    FROM appointments WHERE id = appointments.id
  )`),
```

Virtual fields are read-only -- they appear in queries but cannot be written to.

## Relations

All relations are defined via `f.relation()` inside `.fields()`.

### Belongs-To (Single)

The target is positional: a collection-name string, or a lazy `() => collection` ref (use the ref to avoid import cycles between mutually-referencing collections).

```ts
author: f.relation("user").required(),
barber: f.relation("barbers").required().onDelete("cascade"),
```

Lazy ref (import-cycle-safe):

```ts
import { barbers } from "@/questpie/server/collections/barbers";
barber: f.relation(() => barbers).required().onDelete("cascade"),
```

Creates a foreign key column pointing to the target collection's `id`.

### Multiple (Inline Array of FKs)

`.multiple()` stores an array of foreign-key IDs inline as JSONB, no junction table:

```ts
gallery: f.relation("assets").multiple(),
```

### Has-Many (Reverse)

`.hasMany({ foreignKey })` is a virtual reverse relation, the FK lives on the TARGET collection, nothing is stored on this row:

```ts
posts: f.relation("posts").hasMany({ foreignKey: "authorId" }),
```

### Many-to-Many (Through Junction)

Requires a junction collection plus `through`, `sourceField`, and `targetField`:

```ts title="collections/barber-services.ts"
import { collection } from "#questpie/factories";

// Junction table
export default collection("barberServices")
	.fields(({ f }) => ({
		barber: f.relation("barbers").required().onDelete("cascade"),
		service: f.relation("services").required().onDelete("cascade"),
	}))
	.admin(({ c }) => ({ hidden: true }));
```

```ts title="collections/barbers.ts (inside .fields())"
services: f.relation("services").manyToMany({
  through: "barberServices",
  sourceField: "barber",   // FK in junction pointing to THIS collection
  targetField: "service",  // FK in junction pointing to TARGET collection
}),
```

```ts title="collections/services.ts (inside .fields())"
barbers: f.relation("barbers").manyToMany({
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

```ts title="config/app.ts"
import { appConfig } from "questpie/app";
export default appConfig({
	locale: {
		locales: [
			{ code: "en", label: "English", fallback: true, flagCountryCode: "us" },
			{ code: "sk", label: "Slovencina" },
			{ code: "de", label: "Deutsch" },
		],
		defaultLocale: "en",
	},
});
```

### Localizing Fields

Chain `.localized()` on any field that needs per-locale content:

```ts
name: f.text().required().localized(),
description: f.textarea().localized(),
price: f.number().required(),  // NOT localized -- same in all locales
```

Localizable types: `text`, `textarea`, `richText`, `select`, `array`, `blocks`.
Typically NOT localized: `number`, `boolean`, `date`, `relation`.

### Localized Arrays

Arrays can be localized as a whole -- each locale gets its own array:

```ts
navigation: f.object({
	label: f.text().required(),
	href: f.text().required(),
}).array().localized(),
```

### Querying Localized Content

```ts
// Server-side -- locale comes from request context
const services = await collections.services.find({ where: { isActive: true } });

// Client-side -- set locale explicitly
client.setLocale("sk");
const services = await client.collections.services.find({
	where: { isActive: true },
});
```

### Admin UI Locale (Separate)

The admin panel has its own locale config for the interface language:

```ts title="config/admin.ts"
import { adminConfig } from "#questpie/factories";

export default adminConfig({
	locale: {
		locales: ["en", "sk"],
		defaultLocale: "en",
	},
});
```

This controls the admin interface language, NOT content locales.

## Nested Objects and Reusable Patterns

Use helper functions to avoid repetition in object fields:

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
      wednesday: f.object(daySchedule()),
    }),
  };
})
```

`f.object()` takes the nested field record **directly**, there is no `{ fields }` wrapper and no function form.

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
collection("posts").relations({ author: belongsTo("users") });

// CORRECT -- use f.relation() inside .fields()
collection("posts").fields(({ f }) => ({
	author: f.relation("user"),
}));
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

### HIGH: manyToMany without junction table config

A many-to-many relation MUST specify `through`, `sourceField`, and `targetField`. Use `.hasMany({ foreignKey })` for a plain one-to-many reverse relation.

```ts
// WRONG -- missing through/sourceField/targetField
services: f.relation("services").manyToMany({});

// CORRECT
services: f.relation("services").manyToMany({
	through: "barberServices",
	sourceField: "barber",
	targetField: "service",
});
```

### MEDIUM: Forgetting `.localized()`

If content should vary by locale but the field does not chain `.localized()`, queries with different locales will return the same value.

### MEDIUM: Wrapping object fields in `{ fields }`

`f.object()` takes the nested field record directly. There is no `{ fields }` wrapper.

```ts
// WRONG -- no { fields } wrapper exists
address: f.object({ fields: { street: f.text() } });

// CORRECT
address: f.object({ street: f.text() });
```

Reuse shapes with a plain helper that returns a field record, then spread or pass it: `f.object(daySchedule())`.
