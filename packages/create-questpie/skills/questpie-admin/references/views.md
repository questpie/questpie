---
name: questpie-admin/views
description: QUESTPIE admin views list-view table form-view sections sidebar dashboard widgets filters bulk-actions visibility history versioning sorting search
---

# QUESTPIE Admin Views

This skill builds on questpie-admin.

Views control how data appears in the QUESTPIE admin panel. They are configured **server-side** on collections and globals, then rendered by the admin client via registries.

```text
Server Config                     Admin UI
.list(({ v }) => v.collectionTable({}))   ->  Table with columns, sort, search
.form(({ v, f }) => v.collectionForm({})) ->  Form with sections, sidebar, tabs
sidebar({...})                 ->  Navigation sidebar
dashboard({...})               ->  Dashboard with widgets
```

## List Views

Configure table views with `.list()` on a collection.

### Basic Table

```ts
.list(({ v }) => v.collectionTable({}))
```

Shows all fields as columns with default rendering.

### Custom Columns and Search

```ts
.list(({ v, f }) =>
  v.collectionTable({
    columns: [f.name, f.email, f.isActive, f.createdAt],
    searchableFields: [f.name, f.email],
    defaultSort: { field: f.createdAt, direction: "desc" },
  }),
)
```

| Option             | Type                   | Description                    |
| ------------------ | ---------------------- | ------------------------------ |
| `columns`          | `Field[]`              | Fields to show as columns      |
| `searchableFields` | `Field[]`              | Fields included in text search |
| `defaultSort`      | `{ field, direction }` | Default sort order             |

## Form Views

Configure edit forms with `.form()`.

### Basic Form

```ts
.form(({ v, f }) => v.collectionForm({}))
```

Renders all fields in a single column.

### Sections

Group fields into labeled sections with optional grid layout:

```ts
.form(({ v, f }) =>
  v.collectionForm({
    fields: [
      {
        type: "section",
        label: { en: "Contact Information" },
        layout: "grid",
        columns: 2,
        fields: [f.name, f.email, f.phone],
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

| Option        | Type                | Description                          |
| ------------- | ------------------- | ------------------------------------ |
| `type`        | `"section"`         | Required                             |
| `label`       | `string \| i18n`    | Section heading                      |
| `description` | `string \| i18n`    | Section description                  |
| `layout`      | `"grid" \| "stack"` | Field layout                         |
| `columns`     | `number`            | Grid columns (with `layout: "grid"`) |
| `fields`      | `Field[]`           | Fields in this section               |

### Form Sidebar

Place fields in a right sidebar panel:

```ts
.form(({ v, f }) =>
  v.collectionForm({
    sidebar: {
      position: "right",
      fields: [f.isActive, f.avatar, f.status],
    },
    fields: [ /* main content sections */ ],
  }),
)
```

### Computed Fields

Auto-compute values from other fields:

```ts
{
  field: f.slug,
  compute: {
    handler: ({ data }) => {
      if (data.name && !data.slug?.trim()) {
        return slugify(data.name);
      }
      return undefined;
    },
    deps: ({ data }) => [data.name, data.slug],
    debounce: 300,
  },
}
```

| Option     | Type             | Description              |
| ---------- | ---------------- | ------------------------ |
| `handler`  | `(ctx) => value` | Compute function         |
| `deps`     | `(ctx) => any[]` | Reactive dependencies    |
| `debounce` | `number`         | Debounce in milliseconds |

### Conditional Visibility

Show or hide fields based on other field values:

```ts
{
  field: f.cancellationReason,
  hidden: ({ data }) => data.status !== "cancelled",
}
```

Read-only fields:

```ts
{
  field: f.customerName,
  readOnly: ({ data }) => !!data.customer,
}
```

Section-level visibility:

```ts
{
  type: "section",
  label: { en: "SEO" },
  hidden: ({ data }) => !data.isPublished,
  fields: [f.metaTitle, f.metaDescription],
}
```

## Dashboard

Configure in `config/admin.ts` under the `dashboard` key:

```ts title="config/admin.ts"
import { adminConfig } from "#questpie/factories";

export default adminConfig({
	dashboard: {
		title: { en: "Dashboard" },
		description: { en: "Overview of your app" },
		columns: 4,
		actions: [
			{
				id: "new-post",
				href: "/admin/collections/posts?create=true",
				label: { en: "New Post" },
				icon: { type: "icon", props: { name: "ph:plus" } },
				variant: "primary",
			},
		],
		sections: [
			{ id: "today", label: { en: "Today" }, layout: "grid", columns: 4 },
			{ id: "business", label: { en: "Business" }, layout: "grid", columns: 4 },
		],
		items: [
			/* widget items — see widget types below */
		],
	},
});
```

### Widget Types

**Stats** — count records with optional filter:

```ts
{
  sectionId: "today",
  id: "pending",
  type: "stats",
  collection: "appointments",
  label: { en: "Pending" },
  filter: { status: "pending" },
  span: 1,
}
```

**Value** — custom-loaded value with trend:

```ts
{
  sectionId: "business",
  id: "revenue",
  type: "value",
  span: 2,
  refreshInterval: 1000 * 60 * 5,
  loader: async ({ app }) => ({
    value: 42000,
    formatted: "42,000 EUR",
    label: { en: "Monthly Revenue" },
    trend: { value: "+12%" },
  }),
}
```

**Progress** — progress bar toward a goal:

```ts
{
  sectionId: "business",
  id: "goal",
  type: "progress",
  span: 1,
  showPercentage: true,
  label: { en: "Monthly Goal" },
  loader: async ({ app }) => ({ current: 350, target: 500 }),
}
```

**Chart** — chart from field values:

```ts
{
  sectionId: "business",
  id: "by-status",
  type: "chart",
  collection: "appointments",
  field: "status",
  chartType: "pie",
  label: { en: "By Status" },
  span: 1,
}
```

**Recent Items** — list recent records:

```ts
{
  sectionId: "ops",
  id: "recent",
  type: "recentItems",
  collection: "appointments",
  label: { en: "Recent" },
  limit: 6,
  dateField: "scheduledAt",
  span: 2,
}
```

**Timeline** — activity stream:

```ts
{
  sectionId: "ops",
  id: "activity",
  type: "timeline",
  label: { en: "Activity" },
  maxItems: 8,
  showTimestamps: true,
  timestampFormat: "relative",
  loader: async ({ app }) => {
    const res = await app.collections.appointments.find({
      limit: 8,
      orderBy: { updatedAt: "desc" },
    });
    return res.docs.map((apt) => ({
      id: apt.id,
      title: apt.displayTitle,
      description: `Status: ${apt.status}`,
      timestamp: apt.updatedAt,
      variant: apt.status === "completed" ? "success" : "warning",
      href: `/admin/collections/appointments/${apt.id}`,
    }));
  },
  span: 2,
}
```

## Sidebar

Configure in `config/admin.ts` under the `sidebar` key:

```ts title="config/admin.ts"
import { adminConfig } from "#questpie/factories";

export default adminConfig({
	sidebar: {
		sections: [
			{ id: "overview", title: { en: "Overview" } },
			{ id: "content", title: { en: "Content" } },
			{ id: "external", title: { en: "External" } },
		],
		items: [
			{
				sectionId: "overview",
				type: "link",
				label: { en: "Dashboard" },
				href: "/admin",
				icon: { type: "icon", props: { name: "ph:house" } },
			},
			{ sectionId: "overview", type: "global", global: "siteSettings" },
			{ sectionId: "content", type: "collection", collection: "posts" },
			{
				sectionId: "external",
				type: "link",
				label: { en: "Open Website" },
				href: "/",
				external: true,
				icon: { type: "icon", props: { name: "ph:arrow-square-out" } },
			},
		],
	},
});
```

Items appear in definition order within their section.

Modules contribute sidebar items automatically. `adminModule` adds "Administration" with user management. `auditModule` adds an audit log item.

## Filters & Saved Views

Filters are auto-generated from field definitions:

| Field Type          | Filter Operators                         |
| ------------------- | ---------------------------------------- |
| `text`              | Contains, equals, starts with, ends with |
| `number`            | Equals, greater than, less than, between |
| `boolean`           | Is true, is false                        |
| `select`            | Is, is not, in                           |
| `date` / `datetime` | Before, after, between                   |
| `relation`          | Is (picker)                              |

Users can save filter + sort + column combinations as named views.

## Bulk Actions

List views support multi-select. Check rows, then use the floating toolbar. Built-in: **Delete** (with confirmation). Soft-delete collections soft-delete instead of permanent removal.

## History & Versions

Click the clock icon in the form toolbar. Two tabs:

| Tab          | Shows                                          | Requires                      |
| ------------ | ---------------------------------------------- | ----------------------------- |
| **Activity** | Audit log (create, update, delete, transition) | `auditModule`                 |
| **Versions** | Full document snapshots with restore           | `.versioning()` on collection |

Enable versioning:

```ts
export const pages = collection("pages")
  .fields(({ f }) => ({ ... }))
  .options({ versioning: true });
```

Disable audit for a specific collection:

```ts
export const logs = collection("logs")
  .admin(() => ({ audit: false }))
  .fields(({ f }) => ({ ... }));
```

## Common Mistakes

1. **HIGH: Defining columns that don't match field names** — `columns: [f.name]` requires a `name` field in the collection's `.fields()`. Mismatches cause empty columns.

2. **MEDIUM: Not specifying `searchableFields`** — table search bar won't work unless you explicitly list which fields to search.

3. **MEDIUM: Forgetting sidebar section ordering** — items appear in definition order. If you want "Dashboard" at the top, define it first in the `items` array.

4. **MEDIUM: Missing `sectionId` on sidebar items** — every item must reference an existing section ID.

5. **LOW: Not setting `defaultSort`** — records appear in database insertion order which is usually not what users expect.

## Form Views and Live Preview

Form views connect to the Live Preview V2 system when the collection has `.preview()` configured. The form editor becomes the source of `postMessage` patches — every field change emits a patch through the bus, giving the preview iframe instant updates.

### Enabling Preview on a Collection

Add `.preview()` to the collection definition:

```ts
export const pages = collection("pages")
	.fields(({ f }) => ({
		title: f.text().required().localized(),
		slug: f.text().required(),
		content: f.blocks().localized(),
	}))
	.preview({
		enabled: true,
		position: "right",
		defaultWidth: 50,
		url: ({ record }) => `/${record.slug}?preview=true`,
	});
```

### How It Works

1. The form view detects `.preview()` config and opens a split-screen layout
2. Save/autosave sends a `PREVIEW_REFRESH` message to the preview iframe
3. The preview page handles refreshes through `useCollectionPreview({ initialData, onRefresh })`
4. `PreviewProvider` and `PreviewField` wire field focus and click-to-focus messages
