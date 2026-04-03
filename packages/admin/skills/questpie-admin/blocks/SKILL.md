---
name: questpie-admin/blocks
description: QUESTPIE blocks content-blocks page-builder block-definition fields prefetch renderers block-picker categories nested-blocks upload relation
type: skill
---

# QUESTPIE Blocks

This skill builds on questpie-admin.

Blocks are reusable content components for page builders. Define them server-side with fields and admin metadata, then render them client-side with React components.

```text
Server: block("hero")           Client: HeroRenderer
  .fields({ title, image })  ->    Receives { values, data }
  .admin({ label, icon })         Returns JSX
  .prefetch({ with: {...} })
```

## Defining Blocks

Blocks are defined in `blocks/` using the `block()` factory:

```ts title="blocks/hero.ts"
import { block } from "#questpie";

export const heroBlock = block("hero")
	.admin(({ c }) => ({
		label: { en: "Hero Section", sk: "Hero sekcia" },
		icon: c.icon("ph:image"),
		category: "sections",
	}))
	.fields(({ f }) => ({
		title: f.text({ localized: true, required: true }),
		subtitle: f.textarea({ localized: true }),
		backgroundImage: f.upload({ to: "assets" }),
		overlayOpacity: f.number({ defaultValue: 60 }),
		alignment: f.select({
			options: ["left", "center", "right"],
			defaultValue: "center",
		}),
		ctaText: f.text({ localized: true }),
		ctaLink: f.text(),
	}))
	.prefetch({ with: { backgroundImage: true } });
```

### Admin Metadata

```ts
.admin(({ c }) => ({
  label: { en: "Hero Section" },      // Display name in block picker
  icon: c.icon("ph:image"),           // Icon in block picker (Phosphor set)
  category: "sections",               // Group in block picker
}))
```

### Multiple Blocks Per File

Export multiple named blocks from one file:

```ts title="blocks/layout.ts"
import { block } from "#questpie";

export const twoColumnBlock = block("twoColumn")
	.admin(({ c }) => ({
		label: { en: "Two Columns" },
		icon: c.icon("ph:columns"),
		category: "layout",
	}))
	.fields(({ f }) => ({
		left: f.blocks(),
		right: f.blocks(),
	}));

export const spacerBlock = block("spacer")
	.admin(({ c }) => ({
		label: { en: "Spacer" },
		icon: c.icon("ph:arrows-out-line-vertical"),
		category: "layout",
	}))
	.fields(({ f }) => ({
		height: f.select({
			options: ["sm", "md", "lg", "xl"],
			defaultValue: "md",
		}),
	}));
```

## Using Blocks in Collections

Add a `blocks` field to any collection:

```ts title="collections/pages.ts"
import { collection } from "#questpie";

export const pages = collection("pages").fields(({ f }) => ({
	title: f.text({ required: true, localized: true }),
	slug: f.text({ required: true }),
	content: f.blocks({ localized: true }),
}));
```

The admin renders a visual block editor for this field.

## Prefetch

Blocks often reference related data (images, linked records). Use `.prefetch()` to load them alongside block values.

### Declarative Prefetch

```ts
.prefetch({
  with: {
    backgroundImage: true,  // Load the full image record
  },
})
```

### Nested Prefetch

```ts
.prefetch({
  with: {
    featuredBarber: {
      with: {
        avatar: true,
        services: true,
      },
    },
  },
})
```

### Functional Prefetch

For complex queries, use a function. The `ctx` parameter provides fully typed `collections` and `globals` via `AppContext` augmentation — no imports needed:

```ts title="blocks/featured.ts"
import { block } from "#questpie";

export const featuredBlock = block("featured")
	.fields(({ f }) => ({
		heading: f.text({ required: true }),
	}))
	.prefetch(async ({ values, ctx }) => {
		return {
			posts: (await ctx.collections.posts.find({ limit: 5 })).docs,
		};
	});
```

### Using Prefetched Data in Renderers

```tsx
function HeroRenderer({ values, data }: BlockProps<"hero">) {
	// values.backgroundImage = "asset-id-123" (just the ID)
	// data.backgroundImage = { url: "/api/assets/...", filename: "hero.jpg", ... }

	return (
		<section>
			{data?.backgroundImage?.url && (
				<img src={data.backgroundImage.url} alt="" />
			)}
			<h1>{values.title}</h1>
		</section>
	);
}
```

## Block Renderers

React components that receive block data and return JSX.

### Defining a Renderer

```tsx title="admin/blocks/hero.tsx"
import type { BlockProps } from "@questpie/admin/client";

export function HeroRenderer({ values, data }: BlockProps<"hero">) {
	return (
		<section
			className="relative flex items-center justify-center"
			style={{ minHeight: "60vh" }}
		>
			{data?.backgroundImage?.url && (
				<img
					src={data.backgroundImage.url}
					alt=""
					className="absolute inset-0 w-full h-full object-cover"
				/>
			)}
			<div className="relative text-center">
				<h1 className="text-5xl font-bold">{values.title}</h1>
				{values.subtitle && <p className="text-xl mt-4">{values.subtitle}</p>}
				{values.ctaText && (
					<a href={values.ctaLink} className="mt-6 inline-block btn">
						{values.ctaText}
					</a>
				)}
			</div>
		</section>
	);
}
```

### BlockProps

| Property   | Type        | Description                                        |
| ---------- | ----------- | -------------------------------------------------- |
| `values`   | `object`    | Block field values (title, subtitle, etc.)         |
| `data`     | `object`    | Prefetched relation data (images, related records) |
| `children` | `ReactNode` | Nested block content                               |

### Registering Renderers

```tsx title="admin/blocks/index.tsx"
import { HeroRenderer } from "./hero";
import { GalleryRenderer } from "./gallery";
import { CTARenderer } from "./cta";

export const renderers = {
	hero: HeroRenderer,
	gallery: GalleryRenderer,
	cta: CTARenderer,
};
```

### Frontend Rendering

Use block renderers on the public frontend:

```tsx title="components/page-renderer.tsx"
import { renderers } from "@/questpie/admin/blocks";

function PageRenderer({ page }) {
	return (
		<div>
			{page.content?.map((block, i) => {
				const Renderer = renderers[block.type];
				if (!Renderer) return null;
				return <Renderer key={i} values={block.values} data={block.data} />;
			})}
		</div>
	);
}
```

## Common Mistakes

1. **HIGH: Not using `ctx.collections.*` in functional prefetch** — use the context-injected collections directly. Do NOT import `app` from `#questpie` inside block files (causes circular dependencies).

   ```ts
   // WRONG — importing app creates circular dependency
   import { app } from "#questpie";
   .prefetch(async ({ values, ctx }) => {
     const posts = await app.collections.posts.find({});
   })

   // CORRECT — use ctx.collections directly
   .prefetch(async ({ values, ctx }) => {
     const posts = await ctx.collections.posts.find({});
   })
   ```

2. **HIGH: Importing from `.generated/` inside block files** — block files are imported BY `.generated/index.ts`, so importing from it back creates circular dependencies. Use the `ctx` parameter instead.

3. **MEDIUM: Block renderer not exported as default or named export** — codegen discovers named exports from block renderer files. Ensure the component is exported.

4. **MEDIUM: Using `{ with: { field: true } }` prefetch for complex queries** — declarative prefetch only loads related records by ID. For filtered/sorted/limited queries, use functional prefetch instead.

5. **MEDIUM: Forgetting `.prefetch()` for upload fields** — without prefetch, `values.backgroundImage` is just an ID string. Add `{ with: { backgroundImage: true } }` to get the full asset record with `url`.

6. **LOW: Missing `category` in `.admin()`** — blocks without a category won't be grouped in the block picker, making it harder to find them.

## Blocks in Live Preview

When a collection has `.preview()` configured, blocks participate in the live preview patch bus.

### PreviewBlock Wrapper

Use `<PreviewBlock>` in your frontend to mark block regions for live preview focus and patch targeting:

```tsx
import { PreviewBlock } from "@questpie/admin/client";

function PageRenderer({ blocks, previewData }) {
	return blocks.map((block) => {
		const Renderer = renderers[block.type];
		return (
			<PreviewBlock key={block.id} id={block.id}>
				<Renderer values={block.values} data={block.data} />
			</PreviewBlock>
		);
	});
}
```

When the editor focuses a block, `<PreviewBlock>` highlights it in the preview. Patches target individual blocks by ID for granular updates.

### Block Prefetch and Server Reconcile

In `"hybrid"` preview strategy, blocks with functional `.prefetch()` trigger a server reconcile when their field values change. For example, a "featured posts" block with a `limit` field will re-run its prefetch handler on the server to fetch updated data, while simple field changes (title, subtitle) apply instantly via the local patch bus.

Blocks with declarative prefetch (`{ with: { image: true } }`) resolve relations during reconcile — the preview shows the image URL immediately after the server round-trip completes, not just the asset ID.
