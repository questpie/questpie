# QUESTPIE Design System — Rules

> Single source of truth for the QUESTPIE neutral design system. Pair this file
> with `tokens.css`, `primitives.jsx` and `components/ui/button.tsx` (shadcn).
> Drop this whole file into your project as `DESIGN.md` so AI assistants can
> read it before generating UI.

---

## 0. The five non-negotiables

1. **Neutral first.** Surfaces, hover, focus, badges, tabs, navigation — all
   stay neutral. Primary purple `#b700ff` is reserved for brand CTAs, brand
   marks and prose links only.
2. **Hairline structure.** Borders carry hierarchy. Shadows are reserved for
   buttons (raised), inputs (inset), CTAs / hero panels, popovers, dialogs.
3. **Information density.** Compact, scannable UI beats marketing whitespace
   inside product surfaces. Use density only as much as the surface needs.
4. **Soft neutral geometry.** Radii `8 / 12 / 14 px`. No brutalist square
   corners. No pill-heavy SaaS shapes. Nested radii must be concentric.
5. **Server defines WHAT, client defines HOW.** UI is server-driven via
   registries. The framework ships contracts, not visual lock-in.

---

## 1. Tokens

All tokens live in `tokens.css` as CSS custom properties and are bridged into
Tailwind v4 via `@theme inline`. No `tailwind.config.ts`.

### Color roles (semantic)

```
--background           — page background
--foreground           — primary readable text
--foreground-muted     — secondary text, helper copy
--foreground-subtle    — tertiary text, low-priority chrome
--foreground-disabled  — disabled text + icons

--surface              — base raised surface
--surface-low          — section-level raised surface
--surface-mid          — hover background, grouped fill
--surface-high         — active / selected background
--surface-highest      — strongest neutral fill

--card                 — persistent panels, cards, field groups
--popover              — detached overlays, floating layers
--muted                — table headers, secondary controls
--accent               — interactive hover background

--primary              — #b700ff (brand)
--primary-foreground   — text on primary
--destructive          — destructive button + error border
--success              — success badges + check marks

--border-subtle        — hairline structure
--border               — default structural border
--border-strong        — active edge, focus border
--ring                 — neutral focus ring

--pillar-cloud         — #60a5fa (Cloud accent)
--pillar-autopilot     — #4ade80 (Autopilot accent)
```

### Radii

| Token                    | Value | Use                                             |
| ------------------------ | ----- | ----------------------------------------------- |
| `--radius-control-inner` | 8 px  | Icon buttons / actions nested inside controls.  |
| `--radius-control`       | 12 px | Inputs, selects, buttons, compact controls.     |
| `--radius-surface`       | 14 px | Cards, panels, grouped fields, docs blocks.     |
| `--radius-floating`      | 14 px | Menus, popovers, dialogs, command panels.       |
| `20–28 px`               | —     | Large auth panels, landing hero mockups (rare). |

Nested radii must be concentric: inner radius < outer radius by roughly the
padding between them. Never equal radii on nested surfaces.

### Spacing & density

| Token                 | Default | Use                               |
| --------------------- | ------- | --------------------------------- |
| `--control-height`    | 40 px   | Default one-line controls.        |
| `--control-height-sm` | 32 px   | Compact controls (badges, chips). |
| `--spacing-input`     | 12 px   | Horizontal input padding.         |
| `--spacing-card`      | 16 px   | Small panel / card padding.       |
| `--spacing-panel`     | 20 px   | Larger panel interiors.           |
| `--spacing-section`   | 24 px   | App section gaps.                 |

### Motion

```
--motion-fast   100ms
--motion-base   150ms
--motion-slow   200ms
--ease-standard cubic-bezier(0.2, 0, 0, 1)
--ease-enter    cubic-bezier(0.22, 1, 0.36, 1)
```

Rules:

- Use property-specific transitions. **Never** `transition: all`.
- Buttons use `translateY(1px)` on press (matches depth recipe).
- Floating content animates opacity + small scale/translate.
- Respect `prefers-reduced-motion`.

---

## 2. Typography

| Token         | Use                                                       |
| ------------- | --------------------------------------------------------- |
| `--font-sans` | Body, prose, headings, labels, navigation. Geist.         |
| `--font-mono` | Code, file paths, commands, IDs, kbd, technical metadata. |

- Apply font smoothing at root (`-webkit-font-smoothing: antialiased`).
- Headings use `text-wrap: balance`.
- Body uses `text-wrap: pretty`.
- Dynamic numbers use `font-variant-numeric: tabular-nums`.
- **No global uppercase.** Use uppercase only on compact metadata labels
  (eyebrows) where it improves scanning.
- Avoid negative letter spacing except large marketing headings.

### Scale

| Element       | Size       | Line / Letter             |
| ------------- | ---------- | ------------------------- |
| Display H1    | 40–60 px   | 1.0 / -0.025em / 600      |
| Section H2    | 28–42 px   | 1.1 / -0.015em / 600      |
| Subsection H3 | 18–22 px   | 1.2 / 600                 |
| Lede          | 16–17 px   | 1.55–1.6 / 400 / max ~580 |
| Body          | 14 px      | 1.5 / 400                 |
| Eyebrow       | 11 px mono | 0.04em / 500 / uppercase  |

---

## 3. Surfaces

Pick the lowest surface that communicates the structure.

| Pattern           | Treatment                                                         |
| ----------------- | ----------------------------------------------------------------- |
| Page shell        | `bg-background`, no shadow.                                       |
| Sidebar           | `bg-sidebar`, subtle border.                                      |
| Card / panel      | `bg-card`, `border-border-subtle`, `--radius-surface`, no shadow. |
| Toolbar           | `bg-card` or `bg-surface-low`, subtle border.                     |
| Table header      | `bg-muted`, muted text, no shadow.                                |
| Item row          | Transparent default, `bg-surface-high` on active/hover.           |
| Code block        | `bg-card`, subtle border, header strip if titled.                 |
| Floating layer    | `bg-popover`, `border-border-subtle`, `--floating-shadow`.        |
| **Depth surface** | Elevated CTA / hero panel — see §4 shadow recipe.                 |
| **Control depth** | Inputs / selects / textareas — see §4 inset recipe.               |

Borders structure. Shadows elevate.

---

## 4. Shadow recipes

The system has **three** shadow recipes. Anything else is decorative AI tell.

### 4a. Button depth (raised)

Primary CTA + brand-emphasis buttons:

```css
.btn-primary {
	background: linear-gradient(
		to bottom,
		color-mix(in srgb, var(--primary) 100%, white 4%),
		var(--primary)
	);
	box-shadow:
		inset 0 1px 0 0 color-mix(in srgb, white 22%, transparent),
		inset 0 -1px 0 0 color-mix(in srgb, black 18%, transparent),
		0 1px 2px -1px color-mix(in srgb, var(--primary) 60%, transparent),
		0 2px 6px -2px rgba(0, 0, 0, 0.35);
}
```

Recipe: **inset top highlight** (4–22% white) + **inset bottom shade**
(8–18% black) + **outer 2–6 px glow tinted to the button background**. Press
state swaps to inset shadow + `translateY(1px)`.

Secondary uses the same recipe at lower intensity (~6% highlight + 18%
outer drop).

### 4b. Control depth (inset / pressed-in)

Inputs, textareas, selects:

```css
.control-depth {
	background: var(--surface-low);
	border: 1px solid var(--border-subtle);
	box-shadow:
		inset 0 1px 2px 0 color-mix(in srgb, black 14%, transparent),
		inset 0 0 0 1px color-mix(in srgb, var(--foreground) 2%, transparent);
}
```

Inputs feel "pressed in" — opposite direction to buttons. Focus adds
`0 0 0 2px color-mix(--ring 38% transparent)` neutral ring.

### 4c. Floating shadow (detached layers only)

```css
--floating-shadow: 0 18px 40px -28px rgba(0, 0, 0, 0.72);
```

For popovers, dropdowns, dialogs, command palettes. Persistent surfaces
do not cast shadows.

### Forbidden

- Persistent drop shadows on cards, tables, rows, toolbars, docs callouts.
- `shadow-md` / `shadow-xl` / decorative drops on resting state.
- Multi-color rainbow shadows.
- Tinted outline that reads as a dirty edge.

---

## 5. Buttons

Three variants only.

| Variant         | Use                                             | Treatment                                    |
| --------------- | ----------------------------------------------- | -------------------------------------------- |
| `btn-primary`   | Brand CTA, main action on a page                | Depth recipe 4a, gradient, brand glow        |
| `btn-secondary` | Quiet action, side-by-side with primary         | Depth recipe 4a at lower intensity, hairline |
| `btn-ghost`     | Tertiary action, inline links inside dense rows | Flat, surface-mid tint on hover              |

Rules:

- Default height `40 px`. Compact `32 px` only when documented.
- Press feedback: `translateY(1px)` (buttons) — never `scale(0.92)`.
- Icons use `inline-start` / `inline-end` slots.
- Focus uses `2px outline-ring 38%` neutral. Never primary purple.
- Hit area minimum `40 × 40 px` outside dense tables.

---

## 6. Forms & inputs

| Pattern       | Treatment                                                   |
| ------------- | ----------------------------------------------------------- |
| Text input    | Recipe 4b. Height `40 px`, radius `12 px`.                  |
| Textarea      | Same recipe, `min-height 92 px`, `resize: vertical`.        |
| Single select | Control-depth shell + popover with hairline border.         |
| Multi select  | Control-depth shell + inline chips.                         |
| Combobox      | Floating recipe (4c) + ⌘K hint + autocomplete list.         |
| Toggle        | 36×20 pill. On = primary, off = surface-high.               |
| Checkbox      | 16×16 with 4 px radius. On = primary.                       |
| Validation    | Border + helper text in `--destructive`. No big red blocks. |
| Disabled      | `surface-mid` background, `foreground-disabled` text.       |

Focus uses `--border-strong` border + neutral ring. **Never** primary purple.

---

## 7. Status & badges

Tones:

| Tone        | Color reference      | Use                          |
| ----------- | -------------------- | ---------------------------- |
| neutral     | `surface-mid`        | Generic counts, metadata     |
| live        | `--success`          | "Available now", current run |
| soon        | `--pillar-cloud`     | "Q3 26", upcoming, beta      |
| beta        | `--pillar-autopilot` | Early access, in-review      |
| destructive | `--destructive`      | Errors, dangerous actions    |

Rules:

- Badges use tabular numerals when they contain numbers.
- Status is never communicated by color alone — use label, icon, or position.
- Live status badges may use a pulsing dot (`0 0 0 3px tone 25% transparent`).

---

## 8. Issue / row status icons

From `apps/autopilot/src/.../collections/tasks.ts`:

| Internal    | Label       | Icon                 | Color                 |
| ----------- | ----------- | -------------------- | --------------------- |
| backlog     | Backlog     | dashed circle        | `--foreground-subtle` |
| todo        | Todo        | empty circle         | `--foreground-muted`  |
| in_progress | In progress | half-fill circle     | `#eab308` (yellow)    |
| in_review   | In review   | check circle outline | `#22c55e` (green)     |
| done        | Done        | filled check         | `#818cf8` (indigo)    |
| cancelled   | Cancelled   | filled x             | `--foreground-subtle` |

These icons are the canonical issue-status visualization across the product.

---

## 9. Navigation

- **Top nav**: flat by default, backdrop blur only when content scrolls under.
- **Sidebar active state**: neutral `surface-high` background, neutral
  foreground, neutral indicator. **Never** primary purple.
- **Breadcrumbs**: muted text, current page in foreground.
- **Tabs**: neutral hover, neutral active. No primary purple.

---

## 10. Tables / data views

- Dense rows by default.
- Headers use muted/chrome treatment, no heavy fills.
- Row hover: neutral and subtle (`surface-mid`).
- Selected rows: neutral `surface-high`. Never primary purple.
- Pagination + bulk action controls use standard control primitives.
- Dynamic numbers tabular.
- No persistent shadows on table containers.

---

## 11. Code & technical surfaces

- Code blocks use `bg-card` + hairline border + radius `14 px`.
- Header strip (if titled) uses `bg-surface-low`.
- Copy button is icon-only, neutral, top-right.
- Syntax tokens use restrained palette:
  - keyword: `#c79bff` (brand-tinted)
  - function: `#8fc8ff` (cool blue)
  - string: `#7ddf9e` (acid green)
  - number: `#f2ca72` (warm amber)
  - type: `#aeb8ff` (lavender)
  - comment: `--foreground-subtle`
- File-paths, IDs, shortcuts → mono font.
- Terminal mocks: dark `#0a0a0a` background, traffic-light dots, tab title.

---

## 12. Tone & copy

- Technical confidence. Zero hype.
- Product-builder language, not enterprise brochure.
- **No em-dashes in prose.** Use `.`, `,`, `:` instead. (em-dashes are the
  biggest AI tell. Acceptable only as a UI placeholder for "no value" cells.)
- Avoid filler words: "just", "simply", "easily", "powerful".
- Headlines: max 6 words, balanced wrap. Lede: 1–3 sentences, max ~58 chars/line.
- Use eyebrows (`mono / uppercase / 11 px`) for section context. Compact metadata.

---

## 13. AI tells to avoid

Anti-patterns that scream "AI generated this":

- Em-dashes `—` in prose.
- Cards with rounded corners + colored left-border accent strip.
- Rainbow gradient backgrounds, bokeh blobs, ambient cosmic glows.
- Hand-drawn SVG icons / illustrations of people / emojis used as bullets.
- Triple-redundant section headings: "Powerful · Easy · Fast".
- "Built for production" badges with no detail.
- Marketing stat blocks with invented numbers ("10x faster", "99.99% love").
- Floating CTAs with massive drop shadows + bright glows.
- "Limited time" or "Early bird" urgency without grounding.

If something feels generated, run it past the **five non-negotiables** in §0.

---

## 14. Implementation checklist

For any new surface or component, verify:

- [ ] Uses semantic tokens, not raw hex values.
- [ ] Preserves both `.dark` and `.light` hierarchy.
- [ ] Persistent surfaces are flat. Shadows only via approved recipes.
- [ ] Controls use `--control-height`, `--control-radius`, neutral focus.
- [ ] Nested radii are concentric.
- [ ] Typography intentional: sans for UI/prose, mono for code/meta.
- [ ] Dynamic numbers use tabular numerals.
- [ ] Transitions are property-specific, reduced-motion aware.
- [ ] Hit areas are at least `40 × 40 px`.
- [ ] Primary purple reserved for brand / CTA / prose links.
- [ ] Component works in admin density and public docs / landing.
- [ ] No em-dashes in copy.
- [ ] No colored left-border accent strips on cards.
- [ ] Eyebrow used for section context where appropriate.

---

## 15. File-level handoff

Drop these into a fresh app to inherit QUESTPIE design:

1. `design-system/tokens.css` — token block + Tailwind v4 `@theme inline` bridge.
2. `design-system/components/ui/button.tsx` — shadcn Button with depth-shadow primary.
3. `design-system/primitives.jsx` — shared React primitives (Icon, StatusBadge, CodeBlock, SectionHeading).
4. `DESIGN.md` — this file, alongside the `design-system/` folder.

Tailwind v4 is CSS-first — no `tailwind.config.ts` needed.

shadcn token aliases (paste under your token block in `design-system/tokens.css`):

```css
:root,
.dark,
.light {
	--background: var(--background);
	--foreground: var(--foreground);
	--card: var(--card);
	--card-foreground: var(--foreground);
	--popover: var(--popover);
	--popover-foreground: var(--foreground);
	--primary: var(--primary);
	--primary-foreground: var(--primary-foreground);
	--secondary: var(--surface-mid);
	--secondary-foreground: var(--foreground);
	--muted: var(--muted);
	--muted-foreground: var(--foreground-muted);
	--accent: var(--surface-high);
	--accent-foreground: var(--foreground);
	--destructive: var(--destructive);
	--destructive-foreground: #ffffff;
	--border: var(--border-subtle);
	--input: var(--border-subtle);
	--ring: var(--ring);
	--radius: 0.75rem;
}
```

---

## 16. References

- `design-system/tokens.css` — runtime token values.
- `design-system/primitives.jsx` — `<Icon>`, `<Mark>`, `<StatusBadge>`, `<CodeBlock>`, `<SectionHeading>`.
- `design-system/components/ui/button.tsx` — shadcn Button with depth-shadow primary.
- `design-system/showcase/design-system.html` — interactive showcase, open in a browser.
- `packages/admin/DESIGN.md` — admin-specific deep dive.
- `apps/autopilot/PRODUCT_PLAN.md` — product model (Issues, Workflows, Schedules, Knowledge, Projects).

When in doubt, open the showcase and copy a recipe.
