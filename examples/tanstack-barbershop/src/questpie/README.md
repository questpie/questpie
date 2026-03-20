# QUESTPIE Configuration

This directory contains the QUESTPIE app configuration for the Barbershop example.

## Structure

```
questpie/
  questpie.config.ts   # Main config (runtimeConfig + plugins)
  modules.ts           # Module registrations ([adminModule, ...] as const)
  collections/         # Collection definitions (standalone factories)
    barbers.collection.ts
    services.collection.ts
    appointments.collection.ts
    reviews.collection.ts
  jobs/                # Background jobs
    index.ts
  routes/              # Standalone routes (auto-discovered)
    index.ts
  .generated/          # Auto-generated app instance (codegen)
    index.ts

  admin/               # Admin UI (generated config)
    admin.ts           # Re-exports generated admin config
    hooks.ts           # Typed hooks (useQPAdmin, etc.)
    collections/       # Collection UI configs
      barbers.ts
      services.ts
      appointments.ts
      reviews.ts
    .generated/        # Auto-generated admin client config (codegen)
      client.ts
```

## Codegen-Driven Setup

Both server and admin are fully code-generated from file conventions. No manual wiring needed.

### Server (`questpie.config.ts` + `modules.ts` + `.generated/index.ts`)

```typescript
// questpie.config.ts
import { runtimeConfig } from "questpie";
import { adminPlugin } from "@questpie/admin/plugin";

export default runtimeConfig({
	plugins: [adminPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
});
```

```typescript
// modules.ts
import { adminModule } from "@questpie/admin/server";

export default [adminModule] as const;
```

```typescript
// Collections are auto-discovered from collections/*.collection.ts
// The codegen generates .generated/index.ts with the typed app instance:
//   import { app } from "#questpie";
//   export type App = typeof app;
```

### Admin (`/admin/.generated/client.ts`)

The admin client config is **auto-generated** by codegen from discovered files in
the `admin/` directory. The generated file merges built-in defaults with user
files (blocks, views, components, etc.) and exports a plain config object.

```typescript
// admin/admin.ts — re-exports the generated config
export { default as admin } from "./.generated/client";

// admin/hooks.ts — typed hooks with module augmentation
import type { App } from "#questpie";
import type { admin } from "./admin";

declare module "@questpie/admin/client" {
	interface AdminTypeRegistry {
		app: App;
		admin: typeof admin;
	}
}
```

## Benefits

### Before (explicit generics)

```typescript
// Every hook needed explicit type parameters
const { data } = useCollectionList<App, "barbers">("barbers");
const { client } = useAdminContext<App>();
```

### After (module augmentation)

```typescript
// Types are automatically inferred!
const { data } = useCollectionList("barbers");
const { client } = useAdminContext();
// client.collections.barbers.find() - fully typed!
```

## Server vs Admin

**Server (`/server`):**

- Backend application framework using standalone factories + `runtimeConfig()`
- Drizzle schema definitions
- Validation schemas (Zod)
- Hooks, jobs, auth, etc.
- Example: `collection("barbers").fields(({ f }) => ({ ... }))`

**Admin (`/admin`):**

- Frontend admin UI config (auto-generated from file conventions)
- UI-specific config (labels, icons, layout)
- Field rendering, views, widgets
- Files discovered by codegen from `admin/blocks/`, `admin/views/`, `admin/components/`, etc.

## Key Patterns

### Server Collection (Backend)

```typescript
// collections/barbers.collection.ts
import { collection } from "questpie";

export default collection("barbers").fields(({ f }) => ({
	name: f.text({ label: "Name", required: true }),
	email: f.email({ label: "Email", required: true }),
	bio: f.textarea({ label: "Bio" }),
	isActive: f.boolean({ label: "Active", default: true }),
}));
```

### Admin Collection (UI)

Admin collection configs are auto-discovered from `admin/collections/`:

```typescript
// admin/collections/barbers.ts
export default {
	label: "Barbers",
	icon: "ph:users",
	// Field renderers, list/form view config, etc.
};
```

## API Features

### 1. `runtimeConfig()` + `modules.ts` + Codegen

Server configuration uses the top-level `runtimeConfig()` factory. Modules are registered in a separate `modules.ts` file. Collections, routes, and jobs are auto-discovered by codegen from file conventions — no need to manually wire them:

```typescript
// questpie.config.ts
import { runtimeConfig } from "questpie";
import { adminPlugin } from "@questpie/admin/plugin";

export default runtimeConfig({
	plugins: [adminPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
});
```

```typescript
// modules.ts
import { adminModule } from "@questpie/admin/server";

export default [adminModule] as const;
// Codegen generates .generated/index.ts with the typed app instance
```

### 2. Type-Safe Relations

```typescript
.fields(({ r }) => ({
  author: r.relation({
    targetCollection: "users", // Autocompletes backend collections!
    type: "single",
  }),
}))
```

## Using Admin in Routes

```typescript
// routes/admin.tsx
import { AdminLayoutProvider } from "@questpie/admin/client";
import { admin } from "@/questpie/admin/admin";
import { client } from "@/lib/client";

function AdminLayout() {
  return (
    <AdminLayoutProvider
      admin={admin}
      client={client}
      basePath="/admin"
    >
      <Outlet />
    </AdminLayoutProvider>
  );
}
```

## Using Hooks (Type-Safe!)

```typescript
// Any component inside AdminProvider
import { useCollectionList, useAdminContext } from "@questpie/admin/client";

function BarbersList() {
  // No generics needed - types inferred from module augmentation!
  const { data } = useCollectionList("barbers"); // "barbers" is autocompleted
  const { client } = useAdminContext();

  // client.collections.barbers.find() - fully typed!
  return (
    <ul>
      {data?.docs.map((barber) => (
        <li key={barber.id}>{barber.name}</li> // barber.name is typed!
      ))}
    </ul>
  );
}
```

## I18n (Internationalization)

QUESTPIE supports full i18n for both backend messages and admin UI.

### Backend Messages (`questpie.config.ts`)

Add custom translated messages for API responses and validation:

```typescript
const backendMessages = {
	en: {
		"appointment.created": "Appointment booked for {{date}}",
		"appointment.slotNotAvailable": "This time slot is no longer available",
	},
	sk: {
		"appointment.created": "Rezervácia vytvorená na {{date}}",
		"appointment.slotNotAvailable": "Tento termín už nie je dostupný",
	},
} as const;

export default runtimeConfig({
	plugins: [adminPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
	// Configure content locales
	locale: {
		locales: [
			{ code: "en", label: "English", fallback: true },
			{ code: "sk", label: "Slovenčina" },
		],
		defaultLocale: "en",
	},
	// Add custom messages
	messages: backendMessages,
});

// Use in handlers:
// app.t("appointment.created", { date: "2024-01-20" }, "sk")
// => "Rezervácia vytvorená na 2024-01-20"
```

### Admin UI Messages

Admin UI translations are configured server-side via `.adminLocale()` and fetched by the client:

```typescript
// questpie.config.ts
import { runtimeConfig } from "questpie";
import { adminPlugin } from "@questpie/admin/plugin";

export default runtimeConfig({
	plugins: [adminPlugin()],
	db: { url: process.env.DATABASE_URL! },
	app: { url: process.env.APP_URL! },
	adminLocale: {
		default: "en",
		supported: ["en", "sk"],
	},
});
```

The client automatically fetches these translations via server routes (`useServerTranslations` prop on `AdminLayoutProvider`).

### Using Translations in Components

```typescript
import { useTranslation, useContentLocales } from "@questpie/admin/client";

function WelcomeBanner() {
  const { t, locale, setLocale } = useTranslation();
  const { locales, isLocalized } = useContentLocales();

  return (
    <div>
      <h1>{t("barbershop.welcome")}</h1>

      {/* UI Language Switcher */}
      {isLocalized && (
        <select value={locale} onChange={(e) => setLocale(e.target.value)}>
          {locales.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
```

### Locale Separation

QUESTPIE separates two types of locales:

- **UI Locale** (`uiLocale`) - Admin interface language
- **Content Locale** (`contentLocale`) - QUESTPIE content language (for `_i18n` tables)

```typescript
import { useAdminStore, selectUiLocale, selectContentLocale } from "@questpie/admin/client";

function LocaleInfo() {
  const uiLocale = useAdminStore(selectUiLocale);
  const contentLocale = useAdminStore(selectContentLocale);

  return (
    <div>
      <p>UI Language: {uiLocale}</p>
      <p>Content Language: {contentLocale}</p>
    </div>
  );
}
```
