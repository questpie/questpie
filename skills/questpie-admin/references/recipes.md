---
name: questpie-admin/recipes
description: QUESTPIE admin recipes BE field vs FE field server field type from() module fields client renderer field() custom field end to end custom page page() chat experience in admin custom view kanban display widget how to make and render
---

# QUESTPIE Admin Recipes

This skill builds on questpie-admin.

Task-oriented recipes for extending the admin. Every recipe is **declarative**: add definition files, run `questpie generate`, codegen wires them - you never edit `.generated/`. Primitive reference (factories + component props) is in `references/custom-ui.md`.

## BE field vs FE field

A custom field has **two independent halves** that connect by name:

| | BE field (server) | FE field (admin client) |
| --- | --- | --- |
| What | the **field type** - adds `f.color()` to the builder | the **renderer** - how that type looks in the admin |
| Owns | storage column, Zod validation, operators, options/metadata | the edit control + the table cell |
| Factory | `from()` / `field()` / `fieldType()` (from `questpie/builders`) | `field("color", { component, cell })` (from `@questpie/admin/client`) |
| Lives in | a module's `fields` (questpie skill `references/extend.md`) | `src/questpie/admin/fields/color.tsx` |
| Without the other | works headless, no admin needed | a default control is used if you ship none |

They never import each other. The server type emits introspection metadata under its type name; the admin looks up the renderer by the **same name** and feeds it the resolved options as props. So options are declared once (server) and *read* off props (client) - never duplicated.

## Recipe: a custom field, end to end

A `color` field stored as a hex string, with its own admin control + table cell.

**1. BE - the field type** (server):

```ts title="src/questpie/server/fields/color.ts"
import { from } from "questpie/builders";
import { varchar } from "questpie/drizzle-pg-core";
import { z } from "zod";

export const color = (def = "#000000") =>
	from(varchar("", { length: 7 }), z.string().regex(/^#[0-9a-fA-F]{6}$/)).default(def);
```

Register it on a module so it appears on `f`, then use it (options live here, on the server):

```ts title="src/questpie/server/modules.ts"
import { module } from "questpie/app";
import { color } from "./fields/color";

export default [module({ name: "app-fields", fields: { color } })] as const;
```

```ts
.fields(({ f }) => ({ brandColor: f.color().required().label({ en: "Brand color" }) }))
```

**2. FE - the renderer** (admin client):

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

**3.** Run `questpie generate`. The `label` / `required` set on the server arrive as props - the renderer never re-declares them.

## Recipe: a custom experience in the admin (e.g. a chat page)

For a full custom screen - a chat UI, an analytics board, a bulk importer - use a **page**: `page("name", { component, path, showInNav, label, icon? })` from `@questpie/admin/client`, in `src/questpie/admin/pages/`. The component is free-form React mounted at an admin route; `showInNav: true` adds a sidebar entry automatically.

```tsx title="src/questpie/admin/pages/chat.tsx"
import { page } from "@questpie/admin/client";
import { useState } from "react";
import { client } from "@/lib/client"; // the app's typed client SDK

function ChatPage() {
	const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);

	async function send(text: string) {
		setMessages((m) => [...m, { role: "user", text }]);
		// call a normal QUESTPIE route via the typed client (routes/chat.ts)
		const reply = await client.routes.chat({ text });
		setMessages((m) => [...m, { role: "assistant", text: reply.text }]);
	}

	return (
		<div className="flex h-full flex-col">
			{/* render `messages`, then a composer that calls send() */}
		</div>
	);
}

export default page("chat", {
	component: ChatPage,
	path: "/chat",
	showInNav: true,
	label: { en: "Chat" },
});
```

The backend is just normal QUESTPIE - a `route()` (plus `job()` / `service()` / a collection for history) in the server tree (questpie skill `references/business-logic.md`); the page calls it through the typed client and renders the result. Nothing about the page is special-cased - it is a declaration discovered from `admin/pages/`. (To place it under a specific sidebar section instead of auto-nav, omit `showInNav` and add a `type: "page"` item referencing it in `adminConfig.sidebar`.)

## Recipe: a custom view (display)

To change how a collection's list (or form) renders - kanban, calendar, gallery - ship a `view("name", { kind, component })` in `src/questpie/admin/views/`, then select it declaratively on the collection.

```tsx title="src/questpie/admin/views/kanban.tsx"
import { view, type CollectionListViewProps } from "@questpie/admin/client";

function KanbanView(props: CollectionListViewProps) {
	// props carries the list context: rows, columns, sort, selection, pagination
	return <div className="flex gap-4">{/* group props.data by a status column */}</div>;
}

export default view("kanban", { kind: "list", component: KanbanView });
```

```ts title="src/questpie/server/collections/tasks.ts"
.list(({ v }) => v.kanban({ columns: "status" })) // view config lives here, arrives as props
```

For a smaller, cell-level display (a badge, a sparkline in a table column) you usually only need the `cell` of an FE field renderer - see the field recipe - not a whole view.
