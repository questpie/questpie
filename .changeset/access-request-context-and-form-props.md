---
"questpie": patch
"@questpie/admin": patch
---

Access functions receive `request`, no-op field writes are allowed, global forms auto-expand M:N, and form layout gains a `props` escape hatch.

**`questpie` — access control:**

- `AccessContext` now carries `request?: Request`. The HTTP adapter pipes the incoming `Request` through `app.createContext` into both collection and global CRUD evaluation, so collection/global `.access()` rules can branch on URL or headers (e.g. distinguish admin panel calls at `/admin/api/...` from public frontend calls at `/api/...`). Bound automatically — opt-in by destructuring `request` in your access function:

  ```ts
  read: ({ session, request }) => {
  	const fromAdmin = request?.url.includes("/admin/api/");
  	if (fromAdmin && isAdmin(session?.user)) return true;
  	return { createdById: session?.user?.id };
  };
  ```

- `validateFieldsWriteAccess` now skips fields whose value is unchanged on update. Forms (especially the admin's auto-generated form) re-submit `readOnly` fields with their original value; previously every save failed with `Cannot write field 'X': access denied` even though nothing changed. The check runs only when `existingRow` is available and uses `Object.is` for identity comparison.

**`@questpie/admin`:**

- `GlobalFormView` now auto-detects M:N relations via `detectManyToManyRelations` (parity with `CollectionFormView`) and requests them via `useGlobal(name, { with: ... })`. Upload-through and `relation().multiple()` fields on globals are now visible in the form instead of silently empty. Loaded relation arrays of objects are normalized to arrays of ids before the form resets, matching collection-form behavior.

- New `createAdminClient<TApp>()` factory exported from `@questpie/admin/client` — wraps `createClient` and auto-injects an `X-Questpie-Admin: 1` request header on every outbound call. Use this for the client passed to `<AdminLayoutProvider client={...}>`; keep the public/frontend client as plain `createClient` (it must not inject the admin header).

  ```ts
  import { createAdminClient } from "@questpie/admin/client";
  import type { AppConfig } from "#questpie";

  export const adminCmsClient = createAdminClient<AppConfig>({
    baseURL: typeof window !== "undefined" ? window.location.origin : process.env.APP_URL!,
    basePath: "/api",
  });
  ```

- New shared exports `isAdminRequest(request)`, `ADMIN_REQUEST_HEADER`, `ADMIN_API_PREFIX`, and `withAdminRequestHeader(fetch?)` from `@questpie/admin/shared`. `isAdminRequest` is the canonical access-rule guard — it checks the `X-Questpie-Admin` header first (set by `createAdminClient`), then falls back to the legacy `/admin/api/` URL prefix for back-compat:

  ```ts
  import { isAdminRequest } from "@questpie/admin/shared";

  read: ({ session, request }) => {
  	if (isAdminRequest(request) && isAdmin(session?.user)) return true;
  	return { createdById: session?.user?.id };
  };
  ```

- `FormFieldLayoutItem` (server augmentation) and `FieldLayoutItemWithReactive` (client builder) gain `props?: Record<string, any>` — an escape hatch for component-specific configuration that doesn't have a dedicated layout key. Forwarded as extra props to the field component via the new `extraProps` slot on `FieldRenderer`. Use it for things like the relation field's `filter`:

  ```ts
  { field: f.counselorId, props: { filter: () => ({ role: "admin" }) } }
  ```

No breaking changes: existing access functions ignore the new `request` field; layout items without `props` behave exactly as before.

**Config-driven branding (name, logo, tagline, favicon) and admin.css-driven theming.**

- `ServerBrandingConfig` now declares typed `logo` (`string | { src, srcDark, alt, width, height } | ComponentReference`), `tagline`, and `favicon` alongside the existing `name`. The DTO and Zod schema match — the previous `z.record(z.string(), z.any())` hole is closed and `branding.logo: any` becomes a real type.
- `BrandingSync` hydrates all four fields into the admin store and applies the configured favicon to a managed `<link rel="icon">`. New `useBrand()` / `useBrandSnapshotRef()` hooks read the snapshot (safe outside `<AdminProvider>`).
- New `<BrandLogoMark>` renders any of the three logo shapes with `.dark`-aware source switching. Sidebar and auth-page built-in fallbacks now render the configured logo, falling back to the legacy mark only when nothing is configured.
- Auth pages: removed the hardcoded `brandName="QUESTPIE"` and the two `Built with QUESTPIE` strings; the auth tagline now renders the configured `tagline` (or nothing). Deduped the `logo={logo ?? <AuthDefaultLogo .../>}` fallback across 8 auth pages — `AuthLayout` resolves the default from the store.
- New `--font-heading` CSS token (defaults to `var(--font-sans)`) applied to `h1`–`h6`, so apps can restyle headings without touching body type.
- README: new "Whitelabeling" section with the two-layer model (config for content, `admin.css` for theme), OKLCH-first guidance, and the SSR-clean favicon recipe for TanStack Start.

Backward-compat: file-convention overrides (`adminSidebarBrand`, `adminAuthLayout`) keep precedence over the new config-aware defaults; `AuthDefaultLogo`, `QuestpieSymbol`, and `selectBrandName` stay exported. Zero-config admin renders identically to before.
