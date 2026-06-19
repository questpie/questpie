---
name: questpie-admin/custom-ui
description: QUESTPIE custom-fields custom-views registries field-registry view-registry component-registry reactive-fields dynamic-options widgets field-renderer cell-renderer
---

# QUESTPIE Custom UI

This skill builds on questpie-admin.

Extend the QUESTPIE admin with custom field types, custom view types, custom components, and reactive field behaviors.

## Registries

Registries connect server-side schema to client-side rendering. When the admin encounters a field type, it looks up the renderer in the field registry.

```text
Server: f.text().required()
  |
Generated: { type: "text", options: {...} }
  |
Admin Client: fieldRegistry.get("text")
  |
React: <TextFieldRenderer value={...} onChange={...} />
```

### Built-in Field Registry

```
text       -> TextInput
textarea   -> TextareaInput
richText   -> RichTextEditor (TipTap)
number     -> NumberInput
boolean    -> Checkbox / Switch
date       -> DatePicker
datetime   -> DateTimePicker
select     -> SelectDropdown
relation   -> RelationPicker
upload     -> FileUpload
object     -> NestedForm
array      -> RepeatableItems
blocks     -> BlockEditor
json       -> JSONEditor
```

### Extending Registries

Place files in the admin directory. Codegen discovers them automatically:

```
questpie/admin/
  fields/
    color.tsx        # Custom color field renderer
    currency.tsx     # Custom currency field renderer
  views/
    kanban.tsx       # Custom kanban list view
```

These are merged with built-in defaults during codegen and exported in `.generated/client.ts`.

## Custom Fields

### Server-Side Registration

Register custom fields through modules:

```ts
const myModule = module({
	name: "custom-fields",
	fields: {
		color: colorField,
		currency: currencyField,
		phone: phoneField,
	},
});
```

Once registered and codegen runs, the field becomes available on the `f` builder:

```ts
.fields(({ f }) => ({
  brandColor: f.color().default("#000000"),
  price: f.currency({ currency: "USD" }),
}))
```

### Admin Field Renderer

Create a React component for the field's edit form:

```tsx title="admin/fields/color.tsx"
import { Icon } from "@iconify/react";

function ColorFieldRenderer({ value, onChange }) {
	return (
		<div className="flex items-center gap-2">
			<input
				type="color"
				value={value || "#000000"}
				onChange={(e) => onChange(e.target.value)}
				className="w-10 h-10 border border-border cursor-pointer"
			/>
			<span className="font-mono text-sm text-muted-foreground">
				{value || "#000000"}
			</span>
		</div>
	);
}
```

### Cell Renderer

For custom table column rendering, provide a `cell` component alongside the field renderer:

```tsx title="admin/fields/color.tsx"
// Cell component for list view table
export function ColorCell({ value }) {
	return (
		<div className="flex items-center gap-2">
			<div
				className="w-4 h-4 border border-border"
				style={{ backgroundColor: value || "transparent" }}
			/>
			<span className="text-xs font-mono">{value}</span>
		</div>
	);
}
```

## Custom Views

Create view types beyond built-in table and form, kanban boards, calendars, galleries.

### Server-Side Declaration

```ts
const myModule = module({
	name: "custom-views",
	views: {
		kanban: kanbanViewDefinition,
		calendar: calendarViewDefinition,
	},
});
```

### Usage in Collections

```ts
.list(({ v }) => v.kanban({
  columns: "status",
  cardTitle: "title",
}))
```

### Client Rendering

```tsx title="admin/views/kanban.tsx"
function KanbanView({ data, columns, onDrop }) {
	return (
		<div className="flex gap-4">
			{columns.map((col) => (
				<div key={col.id} className="flex-1">
					<h3 className="font-mono text-sm font-semibold mb-2">{col.label}</h3>
					{data
						.filter((item) => item.status === col.id)
						.map((item) => (
							<div
								key={item.id}
								className="border border-border bg-card p-3 mb-2"
							>
								{item.title}
							</div>
						))}
				</div>
			))}
		</div>
	);
}
```

## Reactive Field System

Conditional visibility (`hidden`), read-only (`readOnly`), and computed values (`compute`) are configured the same way on form views — see `references/views.md`. The one reactive behavior unique to custom fields is server-side dynamic options:

### Dynamic Options (Server-Side)

For select/relation fields with options that depend on other field values:

```ts
city: f.relation("cities").admin({
  options: {
    handler: async ({ data, search, ctx }) => {
      const cities = await ctx.db.query.cities.findMany({
        where: { countryId: data.country },
      });
      return {
        options: cities.map((c) => ({ value: c.id, label: c.name })),
      };
    },
    deps: ({ data }) => [data.country],
  },
}),
```

The `handler` runs **server-side** with full access to `ctx.db`, `ctx.user`, `ctx.req`. It re-executes when any value in `deps` changes.

## UI Component Reference

Icons (`@iconify/react`, `ph:` prefix), toasts (`sonner`), and base-ui `render`-vs-`asChild` usage are covered in the questpie-admin skill's Tech Stack and Common Mistakes (SKILL.md). Two admin-specific specifics:

### Icon weights

```tsx
<Icon icon="ph:caret-down-bold" width={16} height={16} />  // bold
<Icon icon="ph:heart-fill" width={16} height={16} />        // fill
```

### Responsive Components

- `ResponsivePopover`, Popover on desktop, Drawer on mobile
- `ResponsiveDialog`, Dialog on desktop, fullscreen Drawer on mobile
- Hooks: `useIsMobile()`, `useIsDesktop()`, `useMediaQuery()`

## Common Mistakes

1. **HIGH: Not registering custom field in the field registry**, if codegen doesn't discover the field renderer file, the admin will render nothing for that field type. Place it in `questpie/admin/fields/<name>.tsx`.

2. **HIGH: Missing `cell` component for custom fields**, without a cell component, the list view table shows raw values for your custom field instead of a formatted display.

3. **MEDIUM: Reactive field handlers running client-side**, `options.handler`, `compute.handler`, and other reactive handlers run **SERVER-SIDE** with access to `ctx.db`, `ctx.user`. Do not import client-side modules or use browser APIs in them.

4. **MEDIUM: Using `onChange` wrong in field components**, the field renderer receives `onChange` that expects the **value directly**, not a DOM event.

   ```tsx
   // WRONG
   onChange={(e) => onChange(e)}
   // CORRECT
   onChange={(e) => onChange(e.target.value)}
   // Or for non-DOM values:
   onChange={newValue}
   ```

5. **MEDIUM: Radix imports, wrong icons, raw HTML elements**, see the questpie-admin skill's Common Mistakes (SKILL.md): use `@base-ui/react` (not `@radix-ui/*`), `@iconify/react` with `ph:` (not `@phosphor-icons/react`/`lucide-react`), and shadcn components (not raw HTML).
