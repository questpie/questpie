# @questpie/admin

Server-driven admin UI for QUESTPIE. Reads your server schema via introspection and generates a complete admin panel — dashboard, table views, form editors, sidebar navigation, block editor — all from the definitions you already wrote on the server.

## How It Works

QUESTPIE follows a **server-first** architecture. All schema, layout, and behavior is defined on the server with the `questpie` core package. The admin UI consumes this via introspection — no duplicate config needed on the client.

| Layer      | Package                               | Defines                                                           |
| ---------- | ------------------------------------- | ----------------------------------------------------------------- |
| **Server** | `questpie` + `@questpie/admin/server` | Schema, fields, access, hooks, sidebar, dashboard, branding name  |
| **Client** | `@questpie/admin/client`              | Field renderers, view renderers, component registry, UI overrides |

## Installation

```bash
bun add @questpie/admin questpie @questpie/tanstack-query @tanstack/react-query
```

## Server Setup

Add the admin module to `modules.ts`:

```ts
// questpie.config.ts
import { runtimeConfig } from "questpie";

export default runtimeConfig({
	app: { url: process.env.APP_URL! },
	db: { url: process.env.DATABASE_URL! },
	secret: process.env.AUTH_SECRET!,
});
```

```ts
// modules.ts
import { adminModule } from "@questpie/admin/server";

export default [adminModule] as const;
```

Branding name, sidebar, dashboard, and admin locale are configured via `config/admin.ts`:

```ts
// config/admin.ts
import { adminConfig } from "#questpie/factories";

export default adminConfig({
	branding: {
		name: "My Admin",
		// Optional — see "Whitelabeling" below
		logo: "/brand/logo.svg",
		tagline: "Powered by My Co.",
		favicon: "/brand/favicon.ico",
	},
	sidebar: {
		sections: [
			{
				id: "main",
				title: "Content",
				items: [{ type: "collection", collection: "posts" }],
			},
		],
	},
});
```

Collections, globals, routes, and jobs are auto-discovered via file convention. Codegen produces a `.generated/index.ts` with the fully-typed `App` and runtime `app` instance.

### Collection Admin Config

Admin metadata, list views, and form views are defined on the collection itself:

```ts
const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required().label("Title"),
		content: f.richText().label("Content"),
		status: f
			.select([
				{ value: "draft", label: "Draft" },
				{ value: "published", label: "Published" },
			])
			.label("Status"),
		cover: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
		publishedAt: f.date(),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Blog Posts" },
		icon: c.icon("ph:article"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.title, f.status, f.publishedAt],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			layout: "with-sidebar",
			sidebar: {
				position: "right",
				fields: [f.status, f.publishedAt, f.cover],
			},
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
.form(({ v, f }) => v.collectionForm({
  fields: [
    { type: "section", label: "Basic Info", layout: "grid", columns: 2,
      fields: [f.name, f.email, f.phone, f.city] },
    { type: "section", label: "Content", fields: [f.body] },
  ],
}))

// Sidebar layout
.form(({ v, f }) => v.collectionForm({
  layout: "with-sidebar",
  sidebar: { position: "right", fields: [f.status, f.image] },
  fields: [f.title, f.content],
}))

// Tabs
.form(({ v, f }) => v.collectionForm({
  tabs: [
    { id: "content", label: "Content", fields: [f.title, f.body] },
    { id: "meta", label: "Metadata", fields: [f.seoTitle, f.seoDescription] },
  ],
}))
```

### Reactive Fields

Server-evaluated reactive behaviors in form config:

```ts
.form(({ v, f }) => v.collectionForm({
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
export default adminConfig({
	dashboard: {
		title: "Dashboard",
		items: [
			{
				id: "posts",
				type: "stats",
				collection: "posts",
				label: "Posts",
			},
			{
				id: "quick-actions",
				type: "quickActions",
				label: "Quick Actions",
				actions: [
					{
						label: "New Post",
						action: { type: "create", collection: "posts" },
					},
					{
						label: "Open Site",
						action: { type: "link", href: "/" },
					},
				],
			},
		],
	},
});
```

## Client Setup

Codegen creates a typed admin config from the client module registry and the server projection:

### 1. Admin Client Modules

```ts
// questpie/admin/modules.ts
export { default } from "@questpie/admin/client-module";
```

```ts
// questpie/admin/admin.ts
export { default as admin } from "./.generated/client";
```

### 2. Typed Hooks

```ts
// questpie/admin/hooks.ts
import { createTypedHooks } from "@questpie/admin/client";
import type { App } from "#questpie";

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
import { admin } from "@/questpie/admin/admin";
import { appClient } from "@/lib/client";
import { queryClient } from "@/lib/query-client";

export default function AdminRoute() {
	return (
		<AdminRouter
			admin={admin}
			client={appClient}
			queryClient={queryClient}
			basePath="/admin"
		/>
	);
}
```

### 4. Tailwind CSS

Import the admin base stylesheet and scan the admin package:

```css
@import "tailwindcss";
@import "@questpie/admin/client/styles/index.css";

@source "../node_modules/@questpie/admin/dist";
```

`index.css` is an alias for `base.css`; import `base.css` directly when you want explicit control.

## Whitelabeling

There are two layers, deliberately separated:

| Layer       | Configured in                                     | Covers                                |
| ----------- | ------------------------------------------------- | ------------------------------------- |
| **Content** | `config/admin.ts` → `branding`                    | Name, logo, tagline, favicon          |
| **Theme**   | Your app's `admin.css`                            | Colors, fonts, radii, shadows, motion |
| **Chrome**  | Files in `questpie/admin/components/` (see below) | Sidebar brand, nav item, auth layout  |

### Branding (config-driven)

```ts
// config/admin.ts
export default adminConfig({
	branding: {
		name: "Acme Studio",
		// String, or { src, srcDark } for separate light/dark images,
		// or a server ComponentReference for an inline SVG.
		logo: { src: "/brand/logo-light.svg", srcDark: "/brand/logo-dark.svg" },
		// Replaces the "Built with QUESTPIE" footer on auth pages.
		// Omit to render no footer text at all.
		tagline: "Studio admin",
		favicon: "/brand/favicon.ico",
	},
});
```

The logo also accepts an `I18nText` for `name`/`tagline` (`{ en: "...", sk: "..." }`)
and the same locale-map / translation-key shape used elsewhere in the admin.

### Theming (CSS override)

The admin exposes every visual token as a CSS custom property in `base.css`. To
rebrand colors, fonts, or shape, override them in your app's `admin.css`
**after** the base import — source order ensures your overrides win:

```css
/* admin.css */
@import "tailwindcss";
@import "@questpie/admin/client/styles/base.css";

/* Optional: load a brand font */
@import url("https://fonts.googleapis.com/css2?family=Caveat+Brush&display=swap");

:root,
.light {
	--primary: oklch(0.65 0.2 25);
	--ring: oklch(0.65 0.2 25);
	--font-heading: "Caveat Brush", system-ui, sans-serif;
	--surface-radius: 0.5rem;
}

.dark {
	--primary: oklch(0.78 0.18 25); /* lifted L for dark surfaces */
	--ring: oklch(0.78 0.18 25);
}
```

`OKLCH` is recommended because the admin's derived hover/focus states use
`color-mix(in oklch, …)` — values stay perceptually consistent. HEX and `rgb()`
work too; `hsl()` is discouraged (no P3 gamut). See the full token list in
`@questpie/admin/client/styles/base.css`; common knobs:

- Colors: `--primary`, `--background`, `--foreground`, `--surface`, `--border`,
  `--ring`, `--accent`, `--destructive`, `--success`, …
- Sidebar: `--sidebar`, `--sidebar-accent`, `--sidebar-active-background`, …
- Typography: `--font-sans`, `--font-mono`, `--font-chrome`, `--font-heading`
- Shape: `--control-radius`, `--surface-radius`, `--floating-radius`

### Zero-FOUC favicon (optional, TanStack Start)

By default the favicon is applied client-side after the admin config loads.
For SSR-clean favicons, fetch your config in the route loader and add a link
yourself:

```tsx
// routes/admin.tsx
export const Route = createFileRoute("/admin")({
	loader: async ({ context }) => ({
		config: await context.client.routes.getAdminConfig(),
	}),
	head: ({ loaderData }) => ({
		links: [
			{ rel: "stylesheet", href: adminCss },
			...(loaderData?.config?.branding?.favicon
				? [{ rel: "icon", href: loaderData.config.branding.favicon }]
				: []),
		],
	}),
	component: AdminLayout,
});
```

## Chrome Overrides (File-First)

Place component files in `questpie/admin/components/` to override specific UI chrome without changing your app shell:

| File                         | What it overrides                      |
| ---------------------------- | -------------------------------------- |
| `admin-sidebar-brand.tsx`    | Sidebar logo + name area               |
| `admin-sidebar-nav-item.tsx` | Each navigation item row               |
| `admin-auth-layout.tsx`      | Auth page wrapper (login, reset, etc.) |

```tsx title="questpie/admin/components/admin-sidebar-brand.tsx"
import type { AdminSidebarBrandProps } from "@questpie/admin/client";

export default function MyBrand({ name, collapsed }: AdminSidebarBrandProps) {
	return (
		<div className="flex items-center gap-2">
			<img src="/logo.svg" alt={name} className="size-6 shrink-0" />
			{!collapsed && <span className="font-bold">{name}</span>}
		</div>
	);
}
```

These files are discovered by codegen exactly like any other component file — no factory call needed, just a default export.

For these reserved override files, default-export a React component (sync or `React.lazy(...)`). Do **not** default-export a raw `() => import("...")` loader function.

## Block Editor

The admin includes a full drag-and-drop block editor. Blocks are defined server-side:

```ts
const heroBlock = block("hero")
	.admin(({ c }) => ({
		label: { en: "Hero Section" },
		icon: c.icon("ph:image"),
		category: { label: "Sections", icon: c.icon("ph:layout") },
	}))
	.fields(({ f }) => ({
		title: f.text().required(),
		subtitle: f.textarea(),
		backgroundImage: f.upload({ to: "assets", mimeTypes: ["image/*"] }),
	}))
	.prefetch({ with: { backgroundImage: true } });
```

Render blocks on the client with `BlockRenderer`:

```tsx
import { BlockRenderer } from "@questpie/admin/client";

const renderers = {
	hero: ({ values }) => (
		<section>
			<h1>{values.title}</h1>
			<p>{values.subtitle}</p>
		</section>
	),
};

function Page({ content }) {
	return <BlockRenderer content={content} renderers={renderers} />;
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
.list(({ v }) => v.collectionTable({ realtime: false }))
```

## Live Preview

Two preview modes ship out of the box:

- **`collection-form` (default)** — the standard split-screen iframe view. Toggle with the eye icon in the form header (or `?preview=true`). Full reload on save / autosave.
- **`visual-edit-form` (opt-in)** — the **Visual Edit Workspace**: a 2-pane layout with a contextual right inspector and patch-based iframe updates. Click any field in the canvas to open it in the inspector; edits land in the iframe without a save round-trip; saves / reverts / stage transitions sync via `COMMIT` / `FULL_RESYNC` messages. Per-field `visualEdit.group` / `order` / `inspector` / `patchStrategy` / `hidden` metadata tunes how each field appears.

```ts
// Opt a collection into the workspace
.preview({ url: ({ record }) => `/${record.slug}` })
.form(({ v }) => v.visualEditForm({
  fields: [/* ... */],
}))
```

See [Live Preview docs](https://questpie.com/docs/workspace/live-preview) for the full guide, [Visual Edit Workspace](https://questpie.com/docs/workspace/live-preview/visual-edit) for the workspace-specific flow, and [Protocol & Reliability](https://questpie.com/docs/workspace/live-preview/protocol) for the wire format.

## URL-Synced Panels

Admin keeps major panel states in URL search params so links are shareable and browser navigation works as expected.

- `sidebar=view-options` - collection list view options sheet
- `sidebar=history` - version history sidebar (collection/global forms)
- `sidebar=block-library` - block editor library sidebar
- `preview=true` - live preview mode (collection form)

Older params (`history`, `viewOptions`, and `sidebar=preview`) are still read for backward compatibility.

## Package Exports

```ts
// Client (React components, generated admin config, hooks)
import {
	AdminRouter,
	createTypedHooks,
	BlockRenderer,
	// Live preview (frontend integration)
	useCollectionPreview,
	PreviewField,
	PreviewProvider,
	BlockScopeProvider,
	// Visual Edit Workspace (admin-side primitives)
	VisualEditFormHost,
	VisualEditWorkspace,
	VisualInspectorPanel,
	useVisualEdit,
	useVisualEditPreviewBridge,
	useFormToPreviewPatcher,
	// Patch protocol helpers
	diffSnapshot,
	applyPatchBatch,
} from "@questpie/admin/client";

// Server (admin module + server factories/config)
import { adminModule, auditModule } from "@questpie/admin/server";

// Styles
import "@questpie/admin/client/styles/index.css";
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
