---
"@questpie/tokens": minor
---

New package: the QUESTPIE design tokens, published so marketing, docs, the admin
UI and the product read one palette instead of four drifting copies.

Ships `styles.css` as the entry and the individual layers under `tokens/`:
colours (both themes, shadcn naming plus extensions), typography, geometry,
elevation, syntax, motion, a base reset, and the Tailwind v4 bridge.
`tokens/mesh.css` is deliberately outside the entry — it is the marketing
atmosphere, not a foundation, and only the landing loads it.

```css
@import "tailwindcss";
@import "@questpie/tokens/styles.css";
```

Import order is load-bearing: Tailwind first, then this. The bridge uses
`@theme inline`, so every entry resolves at the use site and a consumer override
in any later rule wins with no rebuild — set `--primary` once and every
`bg-primary`, `ring-primary` and `text-primary` follows in both themes.

The three faces are self-hosted through `@fontsource-variable` rather than
fetched from Google Fonts, so a page load makes no third-party request. Only the
weight axis ships.

Nothing consumes this yet. `@questpie/admin` and the docs app still render the
previous palette; moving them over is a separate change.
