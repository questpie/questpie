---
name: questpie-admin/custom-ui
description: QUESTPIE custom admin UI field() view() widget() definitions discovered by codegen FieldComponentProps BaseFieldProps WidgetComponentProps CollectionListViewProps cell renderer component props never edit .generated declarative reactive fields dynamic options
---

# QUESTPIE Custom UI

This skill builds on questpie-admin.

Custom admin UI - field renderers, custom views, dashboard widgets - is **declarative**, exactly like the rest of QUESTPIE. You write a *definition* with a factory (`field()`, `view()`, `widget()` from `@questpie/admin/client`), default-export it from a convention directory, and `questpie generate` discovers it and wires it into `admin/.generated/client.ts`.

There is **no imperative wiring**: you never call a registry, never register a renderer in `modules.ts`, and **never edit anything under `.generated/`** (it is codegen output). A definition is a plain frozen `name → component` object - and all field *options* (label, required, validation, placeholder, …) come from **server introspection at runtime**, so a component reads them off its props; it does not declare them.

## Where definitions live

Drop a default-exported definition in the admin client root (`src/questpie/admin/`); codegen merges it with the built-ins:

| Directory | Factory | Renders |
| --- | --- | --- |
| `fields/` | `field()` | a field type's edit control + table cell |
| `views/` | `view()` | a custom list/form/… view |
| `widgets/` | `widget()` | a dashboard widget |
| `pages/` | `page()` | a full custom admin screen / route |
| `blocks/` | (block renderer) | a block - see `references/blocks.md` |
| `components/` | server-driven components | components referenced from server config |

Scaffold one with `questpie add field|view|widget|block <name>` (creates the file in the right directory), then run `questpie generate`.

## Component prop types

When you author a custom component, import its prop type so props are typed. Everything comes from `@questpie/admin/client` **except** `BlockProps`, which is generated per-app:

| Component | Prop type | Import from |
| --- | --- | --- |
| field `component` | `FieldComponentProps<TValue>` (extends `BaseFieldProps`) | `@questpie/admin/client` |
| field `cell` | none - type inline as `{ value }: { value: unknown }` | - |
| view, `kind: "list"` | `CollectionListViewProps` | `@questpie/admin/client` |
| view, `kind: "form"` (collection) | `CollectionFormViewProps` | `@questpie/admin/client` |
| view, `kind: "form"` (global) | `GlobalFormViewProps` | `@questpie/admin/client` |
| widget `component` | `WidgetComponentProps<TData>` | `@questpie/admin/client` |
| page `component` | none - a plain route component; fetch via the typed client | - |
| block renderer | `BlockProps<"name">` (typed per block name) | `../.generated/client` (relative) |

```tsx
// every admin prop type is a named import from the package:
import { field, type FieldComponentProps } from "@questpie/admin/client";
// blocks are the exception - typed per block from YOUR generated client:
import type { BlockProps } from "../.generated/client";
```

## Custom field renderer

A field renderer is `field("typeName", { component, cell? })`. `typeName` matches the server field type; `component` is the edit control, `cell` is the list-table column. Each may be a component or a lazy `() => import(...)`.

```tsx title="src/questpie/admin/fields/color.tsx"
import { field, type FieldComponentProps } from "@questpie/admin/client";

function ColorField({ value, onChange, onBlur, disabled, error }: FieldComponentProps<string>) {
	return (
		<input
			type="color"
			value={value ?? "#000000"}
			disabled={disabled}
			aria-invalid={!!error}
			onChange={(e) => onChange?.(e.target.value)}
			onBlur={onBlur}
		/>
	);
}

function ColorCell({ value }: { value: unknown }) {
	return <span className="font-mono">{String(value ?? "")}</span>;
}

export default field("color", { component: ColorField, cell: ColorCell });
```

That is the whole wiring - no registry call, nothing added to `modules.ts`. (Creating the *server* field type that adds `f.color()` to the builder is separate: see the questpie skill's `references/extend.md` and `references/field-types.md`. The client side only maps a type name to a component.)

### Field component props

The `component` receives `FieldComponentProps<TValue>` (the typed superset of `BaseFieldProps`, which is what `questpie add field` scaffolds):

| Prop | Type | Meaning |
| --- | --- | --- |
| `value` | `TValue` | current value (typed) |
| `onChange?` | `(value: TValue) => void` | commit a new value - **pass the value, not a DOM event**; omitted in read-only/preview |
| `onBlur` | `() => void` | mark touched / trigger validation |
| `config?` | `FieldUIConfig` | resolved UI config from server introspection |
| `name` | `string` | field name |
| `disabled` / `readOnly` | `boolean` | disabled or read-only |
| `error` | `string` | validation message to display |
| `label` / `description` / `placeholder` | `string` | already resolved (i18n applied) |
| `required` | `boolean` | required field |
| `localized` / `locale` | `boolean` / `string` | localized field + current content locale |
| `hideLabel` | `boolean` | render the control without its own label (compact rows) |
| `className` | `string` | class to apply to the control |

Read options off these props - don't re-declare them; they flow from the server `f.xxx()` definition via introspection. A `cell` component receives just `{ value }` (the column value).

## Custom view

A view is `view("name", { kind, component })`. `kind` is the view kind it satisfies (`list`, `form`, …); the component receives that kind's context - e.g. a `list` view gets `CollectionListViewProps` (rows, columns, pagination, selection).

```tsx title="src/questpie/admin/views/kanban.tsx"
import { view, type CollectionListViewProps } from "@questpie/admin/client";

function KanbanView(props: CollectionListViewProps) {
	// props carries the list context (data, columns, sort, selection, …)
	return <div className="flex gap-4">{/* render columns from props */}</div>;
}

export default view("kanban", { kind: "list", component: KanbanView });
```

Use it declaratively on a collection: `.list(({ v }) => v.kanban({ columns: "status" }))`. The view's config comes from that `.list()` declaration via introspection, not from the client definition.

## Widget

A widget is `widget("name", { component })`; the component receives `WidgetComponentProps<TData>`:

| Prop | Type | Meaning |
| --- | --- | --- |
| `config` | `WidgetConfig \| Record<string, any>` | widget config from the dashboard declaration |
| `data?` | `TData` | data from the widget's data source |
| `isLoading?` | `boolean` | loading state |

```tsx title="src/questpie/admin/widgets/sales.tsx"
import { widget, type WidgetComponentProps } from "@questpie/admin/client";

function SalesWidget({ data, isLoading }: WidgetComponentProps<{ total: number }>) {
	if (isLoading) return null;
	return <div className="text-2xl font-mono">{data?.total ?? 0}</div>;
}

export default widget("sales", { component: SalesWidget });
```

## Custom page

A page is a full custom admin screen: `page("name", { component, path, showInNav?, label?, icon?, group?, order? })` in `pages/`. The component is free-form React mounted at an admin route; `showInNav: true` adds a sidebar entry. Use it for experiences that aren't a collection/global - dashboards, importers, a chat UI. End-to-end example: `references/recipes.md`.

```tsx title="src/questpie/admin/pages/reports.tsx"
import { page } from "@questpie/admin/client";

function ReportsPage() {
	return <div>{/* free-form React; call the backend via the typed client */}</div>;
}

export default page("reports", {
	component: ReportsPage,
	path: "/reports",
	showInNav: true,
	label: { en: "Reports" },
});
```

## Built-in field renderers

For reference, the built-in field types render as:

| Type | Renderer | Type | Renderer |
| --- | --- | --- | --- |
| `text` | text input | `relation` | relation picker |
| `textarea` | textarea | `upload` | file upload |
| `richText` | TipTap editor | `object` | nested form |
| `number` | number input | `array` | repeatable items |
| `boolean` | checkbox / switch | `blocks` | block editor |
| `date` / `datetime` | date picker | `json` | JSON editor |
| `select` | select dropdown | | |

## Reactive Field System

Conditional visibility (`hidden`), read-only (`readOnly`), and computed values (`compute`) are configured the same way on form views - see `references/views.md`. The one reactive behavior unique to custom fields is server-side dynamic options:

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

1. **CRITICAL: Editing `.generated/` or expecting manual registration**, custom UI is wired by codegen from your default-exported `field()`/`view()`/`widget()` definition files. Never edit `admin/.generated/client.ts`. If a renderer doesn't appear, the definition file is missing/misplaced or you forgot `questpie generate`, place it in `src/questpie/admin/{fields,views,widgets}/<name>.tsx`.

2. **HIGH: Re-declaring field options in the client renderer**, label/required/validation/placeholder come from the server `f.xxx()` definition via introspection. Read them off props; do not hardcode them in the component.

3. **HIGH: Missing `cell` component for custom fields**, without a `cell`, the list-view table shows the raw value instead of a formatted display.

4. **MEDIUM: Reactive field handlers running client-side**, `options.handler`, `compute.handler`, and other reactive handlers run **SERVER-SIDE** with access to `ctx.db`, `ctx.user`. Do not import client-side modules or use browser APIs in them.

5. **MEDIUM: Using `onChange` wrong in field components**, the renderer's `onChange` expects the **value directly**, not a DOM event.

   ```tsx
   // WRONG
   onChange={(e) => onChange(e)}
   // CORRECT
   onChange={(e) => onChange(e.target.value)}
   // Or for non-DOM values:
   onChange={newValue}
   ```

6. **MEDIUM: Radix imports, wrong icons, raw HTML elements**, see the questpie-admin skill's Common Mistakes (SKILL.md): use `@base-ui/react` (not `@radix-ui/*`), `@iconify/react` with `ph:` (not `@phosphor-icons/react`/`lucide-react`), and shadcn components (not raw HTML).
