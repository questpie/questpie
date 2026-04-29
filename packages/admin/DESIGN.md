# QUESTPIE Neutral Design System

This document is the source of truth for the default QUESTPIE product UI:
`@questpie/admin`, documentation, and marketing surfaces should all feel like the
same system. App-level overrides may change the final look, but package
primitives and official sites must follow this spec.

The system is intentionally neutral, flat, and functional. It should feel like a
professional workspace: quiet surfaces, clear hierarchy, dense-but-readable
information, strong light/dark support, and restrained brand color.

## Design Principles

- Design changes happen in tokens and primitives first, not one-off component
  overrides.
- Interfaces are built from flat surfaces, not decorative cards, heavy shadows,
  gradients, or ornamental backgrounds.
- Purple `#b700ff` is a brand accent reserved for solid primary CTAs, brand
  marks, links in prose, and rare active emphasis. Navigation, focus rings,
  selected rows, table states, form focus, tabs, and badges are neutral.
- Light mode should feel flat and crisp. Do not add persistent drop shadows to
  normal inputs, table rows, toolbar containers, cards, field shells, docs
  callouts, or landing sections.
- Dark mode should preserve the same hierarchy as light mode. Do not create
  separate dark-mode-only color logic unless a token cannot express it.
- Floating layers may use a subtle tokenized shadow only when they detach from
  the page: dropdowns, popovers, dialogs, sheets, command menus, tooltips.
- Every repeated pattern should be composable: controls, item rows, cards,
  panels, floating layers, navigation items, and code blocks all use shared
  primitives or shared token families.
- Information density is a feature. Prefer compact, scannable UI over marketing
  whitespace in work surfaces.
- Typography should be calm. Use Geist for UI and prose. Use JetBrains Mono only
  for code, file paths, keyboard shortcuts, IDs, and compact metadata where a
  technical label is intentional.

## Token Model

QUESTPIE uses semantic CSS variables, mapped into Tailwind through
`@theme inline`. New surfaces should use semantic utilities (`bg-card`,
`bg-surface-high`, `border-border-subtle`) rather than raw hex values.

### Color Roles

| Token                   | Role                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `--background`          | Main app/document background.                                    |
| `--foreground`          | Primary readable text.                                           |
| `--foreground-muted`    | Secondary text, helper copy, table metadata.                     |
| `--foreground-subtle`   | Tertiary text and low-priority chrome.                           |
| `--foreground-disabled` | Disabled text/icons.                                             |
| `--surface`             | Base neutral surface above background.                           |
| `--surface-low`         | Lowest raised/section surface.                                   |
| `--surface-mid`         | Hover and low-emphasis grouped surface.                          |
| `--surface-high`        | Active neutral state, selected neutral state, stronger hover.    |
| `--surface-highest`     | Strongest neutral fill before using foreground/primary.          |
| `--card`                | Persistent panels, cards, field groups, docs blocks.             |
| `--popover`             | Detached overlays and floating content.                          |
| `--input`               | Input/control edge or filled control surface.                    |
| `--muted`               | Subtle backgrounds such as table headers and secondary controls. |
| `--accent`              | Interactive hover background.                                    |
| `--primary`             | QUESTPIE brand CTA and prose links.                              |
| `--border-subtle`       | Hairline structure and quiet panel boundaries.                   |
| `--border`              | Default structural border.                                       |
| `--border-strong`       | Active neutral edge, keyboard focus edge, selected edge.         |
| `--ring`                | Neutral focus ring.                                              |

### Current Default Palette

Dark is the default system baseline. Light mode mirrors the same hierarchy.

| Role          | Dark      | Light     |
| ------------- | --------- | --------- |
| Background    | `#121212` | `#fafafa` |
| Foreground    | `#ececec` | `#1c1c1c` |
| Card          | `#1b1b1b` | `#ffffff` |
| Surface high  | `#2a2a2a` | `#e8e8e8` |
| Border        | `#343434` | `#e2e2e2` |
| Border subtle | `#262626` | `#ebebeb` |
| Brand primary | `#b700ff` | `#b700ff` |

### Brand Color Usage

Use primary purple for:

- Primary CTA buttons.
- QUESTPIE marks and brand identity.
- Prose links and docs links.
- Rare semantic emphasis where the user is being directed to a primary action.

Do not use primary purple for:

- Form focus rings.
- Sidebar active items.
- Table row selection.
- Generic badges.
- Tabs.
- Routine hover states.
- Warning/info status fills.

## Surface System

Surfaces define hierarchy. Pick the lowest surface that communicates the
structure.

| Pattern            | Preferred Treatment                                                          |
| ------------------ | ---------------------------------------------------------------------------- |
| Page shell         | `bg-background`, no shadow.                                                  |
| Sidebar            | `bg-sidebar`, subtle border or shaped edge.                                  |
| Main content inset | `bg-background`, optional large corner where it meets sidebar.               |
| Card/panel         | `bg-card`, `border-border-subtle`, `--surface-radius`, no persistent shadow. |
| Toolbar            | Flat `bg-card` or `bg-surface-low`, subtle border.                           |
| Table header       | `bg-muted`, muted text, no shadow.                                           |
| Item row           | Transparent by default, `bg-surface-high` on active/hover when needed.       |
| Code block         | `bg-card`, subtle border, header strip if titled.                            |
| Floating layer     | `bg-popover`, `border-border-subtle`, `--floating-shadow`.                   |

Use borders for structure and shadows only for detached layers. If a persistent
surface needs more separation, prefer background contrast or a subtle border
over shadow.

## Radius System

QUESTPIE uses soft neutral geometry, not brutalist square corners and not
pill-heavy SaaS shapes.

| Token                    | Default | Use                                                             |
| ------------------------ | ------- | --------------------------------------------------------------- |
| `--control-radius-inner` | `8px`   | Icon buttons/actions nested inside controls.                    |
| `--control-radius`       | `12px`  | Inputs, selects, buttons, compact controls.                     |
| `--surface-radius`       | `14px`  | Cards, panels, grouped fields, docs blocks.                     |
| `--floating-radius`      | `14px`  | Menus, popovers, dialogs, command panels.                       |
| `--radius-xl` and above  | `20px+` | Large auth panels, landing hero mockups, rare large containers. |

Nested radius must be concentric: inner radius should be smaller than outer
radius by roughly the padding between them. Do not put equal radii on nested
surfaces.

## Shadows

- `--control-shadow`: `none`.
- `--surface-shadow`: `none`.
- `--floating-shadow`: subtle black-alpha shadow for detached layers only.

Avoid `shadow-md`, `shadow-xl`, and decorative drop shadows on normal page
content. If Tailwind shadow utilities are needed, they should map to the token
scale in `@theme inline`.

## Typography

| Token           | Use                                                         |
| --------------- | ----------------------------------------------------------- |
| `--font-sans`   | Body, prose, headings, labels, navigation.                  |
| `--font-chrome` | Buttons, badges, tabs, compact UI labels. Defaults to sans. |
| `--font-mono`   | Code, file paths, commands, IDs, kbd, technical metadata.   |

Rules:

- Apply font smoothing at the root.
- Headings use `text-wrap: balance`.
- Body/prose text uses comfortable line-height and `text-wrap: pretty` where
  practical.
- Dynamic numbers use tabular numerals.
- Avoid global uppercase styling. Use uppercase only for compact metadata labels
  where it improves scanning.
- Avoid negative letter spacing except large marketing headings where optical
  tightening is intentional and tested.

## Spacing And Density

| Token               | Default | Use                               |
| ------------------- | ------- | --------------------------------- |
| `--control-height`  | `40px`  | Default one-line controls.        |
| `--spacing-input`   | `12px`  | Horizontal input/control padding. |
| `--spacing-card`    | `16px`  | Small panel/card padding.         |
| `--spacing-panel`   | `20px`  | Larger panel interiors.           |
| `--spacing-section` | `24px`  | App section gaps.                 |

Admin and docs UI should be compact. Landing pages may use larger section
spacing, but should still use the same surface, radius, and typography system.

## Motion

Motion should make the interface feel responsive, not theatrical.

| Token                    | Default                          | Use                              |
| ------------------------ | -------------------------------- | -------------------------------- |
| `--motion-duration-fast` | `100ms`                          | Tiny hover/floating transitions. |
| `--motion-duration-base` | `150ms`                          | Normal interactive transitions.  |
| `--motion-duration-slow` | `200ms`                          | Sheets, larger panel movement.   |
| `--motion-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)`     | Default transitions.             |
| `--motion-ease-enter`    | `cubic-bezier(0.22, 1, 0.36, 1)` | Floating content enter.          |
| `--motion-ease-move`     | `cubic-bezier(0.25, 1, 0.5, 1)`  | Larger movement.                 |

Rules:

- Use property-specific transitions. Do not use `transition-all`.
- Buttons and clickable item rows may use `active:scale-[0.96]`.
- Floating content should animate opacity and small scale/translate only.
- Respect `prefers-reduced-motion`.
- Stagger landing/demo reveals by semantic chunks, roughly 80-120ms apart.
- Use `will-change` sparingly and only for `transform`, `opacity`, or `filter`.

## Controls

- Inputs, textareas, selects, date/time inputs, relation selects, searchable
  selects, and buttons use the same control token family.
- Default control height is `40px`; compact variants may be `32px` only when a
  primitive explicitly documents that density.
- Focus uses `--border-strong` and neutral `--ring`, never primary purple.
- Select, datepicker, and popover-backed controls keep the same focus treatment
  while open.
- Normal controls do not cast shadows in light mode.
- Inline action buttons inside controls use `--control-radius-inner` and neutral
  hover surfaces.
- Interactive hit areas should be at least `40px` unless the control is inside a
  dense table/editor where a compact variant is documented.

## Navigation

- Sidebar active state is neutral: `--sidebar-active-background`,
  `--sidebar-active-foreground`, `--sidebar-active-indicator`.
- Navigation hover states are neutral surface changes, not brand-color text.
- Topbars are flat and functional. Use backdrop blur only when content scrolls
  beneath them and readability improves.
- Breadcrumbs use muted text and current-page foreground emphasis.
- Theme switching belongs in the sidebar user dropdown for admin. Public docs
  and landing may expose a compact top-level toggle.

## Tables And Data Views

- Table rows remain dense by default.
- Headers use muted/chrome treatment, not heavy fills.
- Row hover is neutral and subtle.
- Selected rows use neutral `surface-high`, not primary purple.
- Relationship and block cells must not force row height growth; chips truncate
  horizontally before wrapping.
- Pagination and bulk action controls use standard controls and tabular
  numerals.
- Table containers do not use persistent light-mode shadows.

## Forms And Field Shells

- Field components compose reusable primitives: `Input`, `Textarea`,
  `InputGroup`, `SelectSingle`, `SelectMulti`, `DateInput`, upload/dropzone, and
  rich text shell primitives.
- Field groups are surfaces only when grouping improves comprehension; avoid
  nested cards.
- Validation uses semantic error text and neutral focus style. Do not turn every
  invalid control into a large red block.
- Rich text editors are field surfaces, not cards. Their shell uses control
  border/radius and no persistent shadow.
- Rich text toolbars use a flat surface and subtle separators instead of raised
  card shadows.

## Status And Feedback

- Color is not the only status signal. Use label text, icon shape, or placement
  alongside color.
- Destructive actions use the destructive button variant for the final confirm
  action. Dialog alert icons remain neutral unless color improves clarity.
- Warning and info in admin chrome are neutral surfaces by default. Use semantic
  copy and placement to communicate importance.
- Success can use green for brief confirmations and toasts; do not turn normal
  navigation or selection into green states.

## Docs And Prose Surfaces

Official docs should use the same neutral system, with prose readability layered
on top.

- Fumadocs tokens must be bridged to QUESTPIE semantic tokens instead of
  hardcoded one-off colors.
- Docs sidebars use neutral active items.
- Prose links may use primary purple.
- Code blocks use `bg-card`, `border-border-subtle`, and `--surface-radius`.
- Callouts are flat panels with subtle borders or a small semantic edge. Avoid
  heavy colored fills.
- Tables in prose use the same table density rules as admin, with enough spacing
  for reading.
- Do not use global radius/shadow reset rules for docs. They break the shared
  component system.

## Landing And Marketing Surfaces

Landing pages can be more spacious and expressive, but must stay aligned with
QUESTPIE Neutral.

- The first viewport should show the product: code, schema, admin projection,
  generated outputs, or real UI mockups.
- Avoid decorative gradient blobs, bokeh, or purely atmospheric visuals.
- Use product proof sections: schema-to-output maps, admin mockups, adapter
  picker, generated types, file convention flows.
- Cards remain individual repeated items. Do not make every page section a
  floating card.
- CTA buttons use the same button primitive and primary usage rules.
- Marketing copy should explain outcomes first and features second.

## Component Standards

### Buttons

- Use shared `Button`.
- Primary button is reserved for the main action.
- Secondary/outline/ghost actions are neutral.
- Icons use `data-icon="inline-start"` or `data-icon="inline-end"` where the
  primitive supports it.
- Press feedback uses `scale(0.96)` unless disabled by a `static` prop or
  reduced motion.

### Cards And Panels

- Use shared `Card` for repeated content items and framed tools.
- Use `panel-surface` for custom panels that are not semantic cards.
- Do not put UI cards inside UI cards unless the inner element is a genuine
  repeated item with its own affordance.

### Badges

- Default badges are neutral.
- Use primary only for brand/product emphasis, not generic status.
- Badges use tabular numerals when they contain numbers.

### Menus And Popovers

- Use `floating-surface`.
- Floating content uses `--floating-radius` and `--floating-shadow`.
- Menu items use neutral hover/active states.

### Images And Media

- Product images and screenshots use a subtle outline:
  `rgba(0, 0, 0, 0.1)` in light mode and `rgba(255, 255, 255, 0.1)` in dark
  mode.
- Avoid tinted outlines that read as dirty edges.

## Accessibility

- Keyboard focus must be visible in both light and dark mode.
- Use semantic HTML and accessible names for icon-only controls.
- Dialogs, sheets, and drawers require titles.
- Motion respects reduced-motion settings.
- High-contrast mode should increase border and muted text contrast through
  tokens.
- Do not rely on color alone for destructive, warning, success, or selected
  states.

## Theme Switching

- Admin supports `light`, `dark`, and `system` without requiring an app-level
  theme provider.
- If an app provides `theme` and `setTheme`, admin uses them.
- The root element receives `.dark` or `.light` and `color-scheme` is updated.
- Docs and landing should use the same class model so screenshots and shared
  components render consistently.

## Implementation Checklist

- Does the change use semantic tokens instead of raw colors?
- Does it preserve both `.dark` and `.light` hierarchy?
- Are persistent surfaces flat, with shadows only on detached layers?
- Are controls using `--control-height`, `--control-radius`, and neutral focus?
- Are nested radii concentric?
- Are typography choices intentional: sans for UI/prose, mono for code/meta?
- Are dynamic numbers tabular?
- Are transitions property-specific and reduced-motion aware?
- Are interactive hit areas large enough?
- Is primary purple reserved for brand/CTA/prose-link emphasis?
- Does the component work in admin density and public docs/landing contexts?
