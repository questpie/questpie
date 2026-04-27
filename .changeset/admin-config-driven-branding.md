---
"@questpie/admin": minor
---

Config-driven branding (name, logo, tagline, favicon) and admin.css-driven theming.

- `ServerBrandingConfig` now declares typed `logo` (`string | { src, srcDark, alt, width, height } | ComponentReference`), `tagline`, and `favicon` alongside the existing `name`. The DTO and Zod schema match — the previous `z.record(z.string(), z.any())` hole is closed and `branding.logo: any` becomes a real type.
- `BrandingSync` hydrates all four fields into the admin store and applies the configured favicon to a managed `<link rel="icon">`. New `useBrand()` / `useBrandSnapshotRef()` hooks read the snapshot (safe outside `<AdminProvider>`).
- New `<BrandLogoMark>` renders any of the three logo shapes with `.dark`-aware source switching. Sidebar and auth-page built-in fallbacks now render the configured logo, falling back to the legacy mark only when nothing is configured.
- Auth pages: removed the hardcoded `brandName="QUESTPIE"` and the two `Built with QUESTPIE` strings; the auth tagline now renders the configured `tagline` (or nothing). Deduped the `logo={logo ?? <AuthDefaultLogo .../>}` fallback across 8 auth pages — `AuthLayout` resolves the default from the store.
- New `--font-heading` CSS token (defaults to `var(--font-sans)`) applied to `h1`–`h6`, so apps can restyle headings without touching body type.
- README: new "Whitelabeling" section with the two-layer model (config for content, `admin.css` for theme), OKLCH-first guidance, and the SSR-clean favicon recipe for TanStack Start.

Backward-compat: file-convention overrides (`adminSidebarBrand`, `adminAuthLayout`) keep precedence over the new config-aware defaults; `AuthDefaultLogo`, `QuestpieSymbol`, and `selectBrandName` stay exported. Zero-config admin renders identically to before.
