# Admin Branding & Theming — Research & Design Decisions

> Pre-implementation research for the @questpie/admin whitelabel/theming redesign.
> Written before any code change so reviewers can see the reasoning. Move to
> `docs/branding-design.md` after the feature lands or delete.

## TL;DR

- **Programmatic config (server → client → store) only for *content*:** `name`, `logo`,
  `tagline`, `favicon`. These are tenant-specific text/URLs the app reads at runtime
  and renders inside React components.
- **CSS for *presentation*:** colors, radii, shadows, motion, fonts. The user
  overrides them in their app's `admin.css` after `@import "@questpie/admin/client/styles/base.css"`.
  No programmatic theme tokens, no `<style>` injection helper, no font-import
  whitelist, no CSP nonce dance.
- **One new branch, one pass.** No PR splitting.

## The meta-question — programmatic theme override or not?

The brief originally proposed a `branding.theme.{light,dark}` config + `branding.fonts`
config that the server would inject as a `<style>` tag in the SSR head, complete with
sanitization regex, OKLCH validation, font-import whitelist, and CSP nonce
propagation. After inventorying the codebase the answer is **no — it's
speculative complexity**:

1. **It already works without it.** `base.css` defines every visual token as a CSS
   custom property. A user writing `:root { --primary: oklch(0.65 0.20 25); }` in
   their `admin.css` after the base import overrides it cleanly via cascade.
   Components consume tokens via `var(--primary)` or Tailwind's `bg-primary`,
   so the override propagates everywhere automatically.
2. **The complexity isn't free.** A programmatic theme path means:
   - A whitelist regex to keep `</style><script>`, `url(javascript:)`, malicious
     `@import`, etc. out of the injected CSS.
   - A separate font-import URL whitelist + per-deployment configuration.
   - CSP nonce wiring through every adapter.
   - A `BrandTokens` interface that must stay in lockstep with `base.css` (a
     disciplinary test enforces it, but every new token is now a multi-file diff).
   - SSR plumbing in every adapter that wants zero-FOUC.
3. **No real use case in the repo.** Both example apps and the template are
   single-tenant; nobody is loading a brand from a database row at request time.
   Multi-tenant runtime theme swap is a hypothetical the codebase doesn't have.
   YAGNI.
4. **Designers prefer CSS anyway.** Hot-reload, full Tailwind utility access,
   `@layer`, `color-mix(in oklch, …)` — all richer than what a key/value config
   could express.

If a real multi-tenant runtime-theme use case shows up, we add a tiny SSR
helper at that point — it's an additive change that doesn't reshape the API.

What stays programmatic:

| Field      | Why programmatic                                                       |
|------------|------------------------------------------------------------------------|
| `name`     | Already programmatic; rendered in sidebar, document title, auth pages. |
| `logo`     | Image URL or component reference; rendered in `<img>` / SVG.           |
| `tagline`  | Replaces the hardcoded "Built with QUESTPIE" footer; rendered as text. |
| `favicon`  | URL; injected as `<link rel=icon>` via SSR head.                       |

What moves to CSS:

- All color tokens (`--primary`, `--background`, `--sidebar*`, `--surface*`, …)
- All structural tokens (`--radius`, `--control-radius`, `--surface-radius`, …)
- All typography tokens (`--font-sans`, `--font-mono`, `--font-chrome`, **new** `--font-heading`)
- All motion/shadow tokens

## Token inventory (CSS — source of truth: `base.css`)

This is the full list a user can override in their `admin.css`. The redesign
adds only `--font-heading`; everything else is pre-existing.

### Surfaces & content
`--background`, `--foreground`, `--foreground-muted`, `--foreground-subtle`,
`--foreground-disabled`, `--surface`, `--surface-low`, `--surface-mid`,
`--surface-high`, `--surface-highest`, `--card`, `--card-foreground`,
`--popover`, `--popover-foreground`, `--input`, `--muted`, `--muted-foreground`,
`--accent`, `--accent-foreground`, `--selection`

### Brand & semantic
`--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`,
`--destructive`, `--destructive-foreground`, `--success`, `--success-foreground`,
`--warning`, `--warning-foreground`, `--info`, `--info-foreground`

### Structure
`--border`, `--border-subtle`, `--border-strong`, `--ring`

### Sidebar
`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`,
`--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`,
`--sidebar-border`, `--sidebar-ring`, `--sidebar-active-background`,
`--sidebar-active-foreground`, `--sidebar-active-indicator`, `--sidebar-submenu`

### Charts
`--chart-1`, `--chart-2`, `--chart-3`, `--chart-4`, `--chart-5`

### Controls & layout
`--control-height`, `--control-radius`, `--control-radius-inner`,
`--control-background`, `--control-border`, `--control-shadow`,
`--surface-radius`, `--surface-shadow`, `--floating-radius`, `--floating-shadow`

### Spacing
`--spacing-section`, `--spacing-card`, `--spacing-input`, `--spacing-shell-gap`,
`--spacing-shell-padding`, `--spacing-panel`

### Motion
`--motion-duration-fast`, `--motion-duration-base`, `--motion-duration-slow`,
`--motion-ease-enter`, `--motion-ease-move`, `--motion-ease-standard`,
`--motion-scale-enter`

### Typography
`--font-sans`, `--font-mono`, `--font-chrome`, **`--font-heading` (new)**

> Most colors today are HEX. The high-contrast block at the bottom uses OKLCH.
> Nothing in this design forces a color space — the user types whatever
> CSS color value the browser accepts. OKLCH is recommended in docs because
> `color-mix(in oklch, …)` is already used in `base.css` and gives consistent
> perceptual lightness for derived hover/focus states.

## Hardcoded strings to remove

Confirmed via grep on `packages/admin/src/`:

| File:Line                                     | String                              | Action                                         |
|-----------------------------------------------|-------------------------------------|------------------------------------------------|
| `auth-layout.tsx:59`                          | `aria-label="QUESTPIE"`             | Decorative SVG; replace with brand name.       |
| `auth-layout.tsx:105`                         | `<AuthDefaultLogo brandName="QUESTPIE" />` | Replace with `useBrand().name`.         |
| `auth-layout.tsx:123`                         | `Built with QUESTPIE` (desktop)     | Render `useBrand().tagline` only if set.       |
| `auth-layout.tsx:146`                         | `Built with QUESTPIE` (mobile)      | Same.                                          |
| `admin-sidebar.tsx:1255`                      | `<QuestpieSymbol />` (built-in)     | Render `<BrandLogoMark>` with `QuestpieSymbol` fallback. |
| `admin-sidebar.tsx:477`                       | `<title>QUESTPIE</title>` in SVG    | Stays — internal to default `QuestpieSymbol` fallback. |
| 8× auth pages (login/setup/forgot/reset/invite/accept-invite) | `logo={logo ?? <AuthDefaultLogo brandName={brandName} />}` | Drop entirely; `AuthLayout` resolves from `useBrand()`. |

## Server → client config flow (current state)

1. **Server augmentation** — `packages/admin/src/server/augmentation/dashboard.ts` defines
   `ServerBrandingConfig` with `name?: I18nText` and `logo?: unknown` (untyped).
2. **DTO** — `packages/admin/src/server/modules/admin/dto/admin-config.dto.ts` declares
   `BrandingConfigDTO { name, logo }` but the Zod schema is
   `branding: z.record(z.string(), z.any()).optional()` — no validation.
3. **Route** — `packages/admin/src/server/modules/admin/routes/admin-config.ts` passes
   `adminCfg.branding` through to the DTO response without transforming.
4. **Client types** — `packages/admin/src/client/types/admin-config.ts` declares
   `branding?: { name?: I18nText; logo?: any }` (B1 — `any`).
5. **Client fetch** — `packages/admin/src/client/runtime/provider.tsx` `BrandingSync`
   runs in `useEffect`, fetches via `client.routes.getAdminConfig()`, extracts
   only `branding.name`, writes to `store.brandName`. Logo/tagline/favicon are
   ignored.

> **No SSR fetch path exists today.** The brand name flickers from "Admin"
> placeholder to its real value on first paint. This redesign adds an SSR-safe
> path for content (TanStack Start route loader → store hydration) but keeps
> client-side fetch as backward-compat fallback. Examples will demonstrate the
> SSR path; consumers who don't update get the existing flicker (no breakage).

## Adapter SSR head injection

- **TanStack Start** (primary, used by both examples + template): the admin
  shell route can either expose `head()` from the route definition, or render
  `<HeadContent>` from inside the shell component. Either places `<link>` and
  inline strings into the SSR-rendered `<head>`. We use this to inject
  `<link rel="icon">` when `branding.favicon` is set.
- **Hono raw mount**: documented but not used in examples. Hono apps own their
  own HTML shell; favicon injection is the consumer's responsibility. Document
  it; don't ship a helper.

## Existing whitelabel mechanisms (preserve, don't break)

File-convention component overrides at `questpie/admin/components/`:
- `admin-sidebar-brand.tsx` (props: `name`, `collapsed`)
- `admin-sidebar-nav-item.tsx` (props: `item`, `isActive`, `collapsed`)
- `admin-auth-layout.tsx` (props: full `AuthLayoutProps`)

**Precedence (preserved):** runtime prop > file-convention > built-in (now config-aware).

## Files to be touched

### New
- `packages/admin/BRANDING_RESEARCH.md` (this doc — phase 0)
- `packages/admin/src/client/components/brand-logo.tsx`
- `packages/admin/src/client/hooks/use-brand.ts`

### Modified
- `packages/admin/src/server/augmentation/dashboard.ts`
- `packages/admin/src/server/modules/admin/dto/admin-config.dto.ts`
- `packages/admin/src/client/types/admin-config.ts`
- `packages/admin/src/client/runtime/provider.tsx`
- `packages/admin/src/client/views/layout/admin-sidebar.tsx`
- `packages/admin/src/client/views/auth/auth-layout.tsx`
- `packages/admin/src/client/views/pages/login-page.tsx`
- `packages/admin/src/client/views/pages/setup-page.tsx`
- `packages/admin/src/client/views/pages/forgot-password-page.tsx`
- `packages/admin/src/client/views/pages/reset-password-page.tsx`
- `packages/admin/src/client/views/pages/invite-page.tsx`
- `packages/admin/src/client/views/pages/accept-invite-page.tsx`
- `packages/admin/src/client/styles/base.css` (add `--font-heading`)
- `packages/admin/README.md` (whitelabel + theming docs)
- `examples/tanstack-barbershop/src/admin.css` (smoke test override)
- `examples/tanstack-barbershop/src/questpie/server/admin.ts` (smoke test config)

## Backward-compat invariants

- Zero-config admin (no `branding` set) renders identically to before.
- Existing `admin.css` token overrides keep working — source order unchanged.
- File-convention overrides take precedence over the new config-aware defaults.
- No public export's signature changes in a breaking way; `AuthDefaultLogo` and
  `QuestpieSymbol` continue to be exported for users who reach for them directly.

## Quality bar

- Type safety: no `any` in the branding path.
- No FOUC for favicon (SSR `<link rel=icon>`).
- Brand name/logo/tagline still flickers from default unless the consumer wires
  the route loader; documented as the recommended pattern.
- Bundle: `<BrandLogoMark>` + `useBrand` together must stay under 1 KB minified
  (they're tiny — no helpers, no validators).
- Smoke test: `examples/tanstack-barbershop/` displays a custom logo, brand name,
  tagline, favicon via config alone, and a custom primary color + heading font
  via `admin.css` alone. No React component written by the user.
