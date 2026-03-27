# @questpie/vite-plugin-iconify

Vite plugin that **automatically bundles only the Iconify icons you actually use**. Zero config, zero flash, zero API calls.

## How it works

1. **Scans** your source files for icon references like `"ph:check"`, `"mdi:home"`, `"tabler:star"`
2. **Extracts** only those icons from `@iconify/json` (200k+ icons from 150+ sets)
3. **Generates** a virtual module that calls `addCollection()` to preload them
4. **HMR** — add a new icon, save, it's bundled automatically

Result: `@iconify/react` renders inline SVGs instantly. No API calls, no layout shift, no flash of missing icons.

## Setup

```bash
bun add -d @questpie/vite-plugin-iconify @iconify/json
```

```ts
// vite.config.ts
import { iconifyPreload } from "@questpie/vite-plugin-iconify";

export default defineConfig({
  plugins: [
    iconifyPreload(),
    // ... other plugins
  ],
});
```

```ts
// app.tsx or entry point
import "virtual:iconify-preload";
```

That's it. Use `@iconify/react` as normal:

```tsx
import { Icon } from "@iconify/react";

<Icon icon="ph:check" width={16} height={16} />
<Icon icon="mdi:home" />
<Icon icon="tabler:star-filled" />
```

## Options

```ts
iconifyPreload({
  // Glob patterns for files to scan (default: src/**/*.{ts,tsx,js,jsx})
  scan: ["src/**/*.{ts,tsx}", "packages/admin/src/**/*.{ts,tsx}"],

  // Always include these icons (for truly dynamic icon names)
  include: ["ph:spinner", "ph:spinner-gap"],
})
```

## How icon detection works

The plugin scans for string literals matching the pattern `"prefix:icon-name"` in your source files. This covers:

- `<Icon icon="ph:check" />` — JSX props
- `icon: "ph:article"` — object literals (e.g. server config)
- `c.icon("ph:layout")` — function arguments
- `"mdi:home"` — any string literal

**Won't detect:** dynamically constructed names like `` `ph:${variable}` ``. Use the `include` option for those.

## Why not unplugin-icons?

`unplugin-icons` requires changing your icon syntax to component imports:

```tsx
// unplugin-icons — requires import per icon
import IconCheck from "~icons/ph/check";
<IconCheck />
```

This plugin keeps the standard `@iconify/react` string-based API:

```tsx
// @questpie/vite-plugin-iconify — string-based, no imports
<Icon icon="ph:check" />
```

String-based icon names are essential when icons come from server config, database fields, or any runtime source. This just gives us option to preload the icons we know we'll use, while still allowing dynamic usage when needed.
