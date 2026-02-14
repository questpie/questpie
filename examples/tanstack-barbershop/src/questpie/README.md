# QuestPie Configuration

This directory contains the QuestPie CMS configuration for the Barbershop example.

## Structure

```
questpie/
  server/              # Backend CMS (q builder)
    cms.ts             # Main CMS instance + module augmentation
    collections/       # Collection definitions
      barbers.ts
      services.ts
      appointments.ts
      reviews.ts
    jobs/              # Background jobs
      index.ts
    functions/         # RPC functions
      index.ts

  admin/               # Admin UI (qa builder)
    builder.ts         # Main admin builder with module augmentation
    collections/       # Collection UI configs
      barbers.ts
      services.ts
      appointments.ts
      reviews.ts
```

## Module Augmentation Pattern

Both server and admin use module augmentation for type-safe access throughout the app.

### Server (`/server/cms.ts`)

```typescript
import { q } from "questpie";
import { adminModule } from "@questpie/admin/server";

export const cms = q({ name: "barbershop" })
  .use(adminModule)
  .collections({ barbers, services, appointments, reviews })
  .build({ ... });

export type AppCMS = typeof cms;

// Module augmentation for type-safe hooks, functions, jobs
declare module "questpie" {
  interface QuestpieContext {
    app: typeof baseInstance.$inferCms;
  }
}
```

### Admin (`/admin/builder.ts`)

```typescript
import { qa, adminModule } from "@questpie/admin/client";
import type { AppCMS } from "../server/cms";

export const admin = qa<AppCMS>().use(adminModule);

// Module augmentation for type-safe hooks
declare module "@questpie/admin/client" {
  interface AdminTypeRegistry {
    cms: AppCMS;
    admin: typeof admin;
  }
}
```

## Benefits

### Before (explicit generics)

```typescript
// Every hook needed explicit type parameters
const { data } = useCollectionList<AppCMS, "barbers">("barbers");
const { client } = useAdminContext<AppCMS>();
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

- Backend headless CMS using `q()` builder
- Drizzle schema definitions
- Validation schemas (Zod)
- Hooks, jobs, auth, etc.
- Example: `q.collection("barbers").fields({ ... })`

**Admin (`/admin`):**

- Frontend admin UI using `qa()` builder
- UI-specific config (labels, icons, layout)
- Field rendering, views, widgets
- Example: `qa.collection("barbers").fields(({ r }) => ({ ... }))`

## Key Patterns

### Server Collection (Backend)

```typescript
// server/collections/barbers.ts
import { q } from "questpie";
import { varchar, text, boolean } from "drizzle-orm/pg-core";

export const barbers = q.collection("barbers").fields({
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  bio: text("bio"),
  isActive: boolean("is_active").default(true),
});
```

### Admin Collection (UI)

```typescript
// admin/collections/barbers.ts
import { qa } from "@/questpie/builder";

export const barbersAdmin = qa
  .collection("barbers")
  .meta({
    label: "Barbers",
    icon: UsersIcon,
  })
  .fields(({ r }) => ({
    // r = field registry with autocomplete
    name: r.text({ label: "Full Name", maxLength: 255 }),
    email: r.email({ label: "Email Address" }),
    bio: r.textarea({ label: "Biography" }),
    isActive: r.switch({ label: "Active" }),
  }))
  .list(({ v, f }) =>
    // v = view registry, f = field proxy
    v.table({
      columns: [f.name, f.email, f.isActive], // Autocomplete!
    }),
  )
  .form(({ v, f }) =>
    v.form({
      fields: [f.name, f.email, f.bio, f.isActive],
    }),
  );
```

### Shared Builder (`/builder.ts`)

```typescript
// builder.ts - Single source for typed qa namespace
import type { AppCMS } from "@/questpie/server/cms";
import { qa as originalQa, adminModule } from "@questpie/admin/client";

// Pre-configured qa with CMS types and admin module
export const qa = originalQa<AppCMS>().use(adminModule).toNamespace();
```

## API Features

### 1. No `.build()` Method

Builder state IS the final config:

```typescript
const admin = qa().collections({ ... });
// Use admin directly - admin.state contains config
```

### 2. Scoped Helpers with Builder Pattern

```typescript
// Create a builder with module - this is the recommended pattern
const builder = qa<AppCMS>().use(adminModule);
const barbers = builder.collection("barbers").fields(({ r }) => ({ ... }));
```

### 3. Proxy Pattern for Autocomplete

```typescript
.fields(({ r }) => ({
  // r = FieldRegistryProxy - autocomplete for all fields
  name: r.text({ ... }),
}))

.list(({ v, f }) => v.table({
  // v = ViewRegistryProxy - autocomplete for views
  // f = FieldProxy - autocomplete for field names
  columns: [f.name, f.email], // Full autocomplete!
}))
```

### 4. Type-Safe Relations

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
import { admin } from "~/questpie/admin/builder";
import { client } from "~/lib/cms-client";

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

QuestPie supports full i18n for both backend messages and admin UI.

### Backend Messages (`/server/cms.ts`)

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

export const cms = q({ name: "barbershop" })
  .use(adminModule)
  // Configure content locales
  .locale({
    locales: [
      { code: "en", label: "English", fallback: true },
      { code: "sk", label: "Slovenčina" },
    ],
    defaultLocale: "en",
  })
  // Add custom messages
  .messages(backendMessages)
  .build({ ... });

// Use in handlers:
// cms.t("appointment.created", { date: "2024-01-20" }, "sk")
// => "Rezervácia vytvorená na 2024-01-20"
```

### Admin UI Messages

Admin UI translations are configured server-side via `.adminLocale()` and fetched by the client:

```typescript
// server/cms.ts
export const cms = q({ name: "barbershop" })
  .use(adminModule)
  .adminLocale({
    default: "en",
    supported: ["en", "sk"],
  })
  .build({ ... });
```

The client automatically fetches these translations via RPC (`useServerTranslations` prop on `AdminLayoutProvider`).

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

QuestPie separates two types of locales:

- **UI Locale** (`uiLocale`) - Admin interface language
- **Content Locale** (`contentLocale`) - CMS content language (for `_i18n` tables)

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
