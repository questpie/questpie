# I18N Architecture Specification

> **Status:** Implemented
> **Author:** AI Assistant
> **Last Updated:** 2026-01-21

## Overview

This document describes the i18n (internationalization) architecture for QUESTPIE CMS, covering:

1. **UI Locale** - Language for admin interface (buttons, labels, messages)
2. **Content Locale** - Language for CMS content (localized fields)
3. **Message Files** - Translated strings organized by language

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                        Admin UI                              │
├─────────────────────────────────────────────────────────────┤
│  UI Locale (uiLocale)           │  Content Locale            │
│  - Jazyk admin rozhrania        │  - Jazyk CMS obsahu        │
│  - "Uložiť", "Vytvoriť"...      │  - Lokalizované polia      │
│  - Uložené v cookie             │  - Accept-Language header  │
│  - setUiLocale()                │  - setContentLocale()      │
└─────────────────────────────────────────────────────────────┘
```

---

## Message Files Structure

### Flat File Pattern (en.ts, sk.ts)

All messages are organized in flat files per language - no nested folders:

```
packages/admin/src/client/i18n/messages/
├── en.ts      # adminMessagesEN (252 keys)
├── sk.ts      # adminMessagesSK (252 keys)
└── index.ts   # Re-exports

packages/questpie/src/shared/i18n/messages/
├── en.ts      # validationMessagesEN (40 keys)
├── sk.ts      # validationMessagesSK (40 keys)
└── index.ts   # Re-exports

packages/questpie/src/server/i18n/messages/
├── en.ts      # backendMessagesEN (40 keys)
├── sk.ts      # backendMessagesSK (40 keys)
└── index.ts   # Re-exports
```

### Importing Messages

```typescript
// Admin UI messages
import { adminMessagesEN, adminMessagesSK } from "@questpie/admin/client";

// Shared validation messages (Zod errors)
import { validationMessagesEN, validationMessagesSK } from "questpie/shared";

// Backend error messages
import { backendMessagesEN, backendMessagesSK } from "questpie/server";
```

---

## Admin Configuration

### Basic Setup

```typescript
// src/questpie/server/cms.ts
import { q } from "questpie";
import { adminModule } from "@questpie/admin/server";
import { adminMessagesSK } from "@questpie/admin/client";

const cms = q({ name: "my-app" })
  .use(adminModule)
  .adminLocale({
    locales: ["en", "sk"],
    defaultLocale: "en",
  })
  .messages({
    en: {
      // Custom app-specific messages
      "app.welcome": "Welcome to My App",
    },
    sk: {
      // Merge official SK translations + custom messages
      ...adminMessagesSK,
      "app.welcome": "Vitajte v mojej aplikácii",
    },
  })
  .build();
```

### Inline Translations in Collections

Labels, descriptions, and other text in collection configs support multiple formats:

```typescript
import { collection, field } from "@questpie/admin/client";

const barbersAdmin = collection("barbers")
  // 1. Plain string (no translation)
  .label("Barbers")

  // 2. Inline translations (recommended for collection config)
  .label({ en: "Barbers", sk: "Holiči", cz: "Holiči" })

  // 3. Translation key lookup
  .label({ key: "collection.barbers.title", fallback: "Barbers" })

  // 4. Dynamic function
  .label((ctx) => ctx.t("collection.barbers.title"))

  .fields({
    name: field("name")
      .label({ en: "Name", sk: "Meno" })
      .description({ en: "Full name", sk: "Celé meno" }),
  })
  .build();
```

---

## Runtime Behavior

### Store State

```typescript
// AdminState in packages/admin/src/client/runtime/provider.tsx
interface AdminState {
  // UI locale (admin interface language)
  uiLocale: string;
  setUiLocale: (locale: string) => void;

  // Content locale (CMS content language)
  contentLocale: string;
  setContentLocale: (locale: string) => void;

  // Deprecated aliases for backwards compatibility
  locale: string; // = contentLocale
  setLocale: () => void; // = setContentLocale
}
```

### Locale Sync

When locales change, they automatically sync:

1. **UI Locale → i18n Adapter**: Updates translations in UI
2. **Content Locale → API Client**: Sets `Accept-Language` header

```typescript
// In AdminProvider
const uiLocale = useStore(storeRef.current, (s) => s.uiLocale);
useEffect(() => {
  if (i18nAdapterRef.current && uiLocale) {
    i18nAdapterRef.current.setLocale(uiLocale);
  }
}, [uiLocale]);

const contentLocale = useStore(storeRef.current, (s) => s.contentLocale);
useEffect(() => {
  if (client && contentLocale && "setLocale" in client) {
    (client as any).setLocale(contentLocale);
  }
}, [client, contentLocale]);
```

### Cookies

Locales are persisted in cookies:

- `questpie_ui_locale` - UI language preference
- `questpie_content_locale` - Content language preference

---

## Components

### Language Switcher (UI Locale)

Located in user dropdown menu in sidebar footer. Uses dropdown submenu with radio items:

```typescript
// packages/admin/src/client/views/layout/admin-sidebar.tsx
<DropdownMenuSub>
  <DropdownMenuSubTrigger>
    <Globe className="mr-2 size-3.5" />
    {t("locale.language")}
    <span className="ml-auto text-[10px] uppercase text-muted-foreground">
      {uiLocale}
    </span>
  </DropdownMenuSubTrigger>
  <DropdownMenuPortal>
    <DropdownMenuSubContent>
      <DropdownMenuRadioGroup value={uiLocale} onValueChange={setUiLocale}>
        {uiLocales.map((code) => (
          <DropdownMenuRadioItem key={code} value={code}>
            <span className="uppercase font-medium">{code}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuSubContent>
  </DropdownMenuPortal>
</DropdownMenuSub>
```

### Content Locale Switcher

Located in topbar for switching content language:

```typescript
// packages/admin/src/client/views/common/locale-switcher.tsx
export function LocaleSwitcher() {
  const contentLocale = useAdminStore(selectContentLocale);
  const setContentLocale = useAdminStore(selectSetContentLocale);
  // ...
}
```

---

## Using Translations

### In Components

```typescript
import { useTranslation } from "@questpie/admin/client";

function MyComponent() {
  const { t, locale, formatDate } = useTranslation();

  return (
    <div>
      <h1>{t("dashboard.title")}</h1>
      <button>{t("common.save")}</button>
      <p>{t("collection.itemCount", { count: 5 })}</p>
    </div>
  );
}
```

### I18nText Type

For config values that need translation:

```typescript
type I18nText =
  | string // Plain string
  | { key: string; fallback?: string } // Translation key
  | { [locale: string]: string } // Inline translations
  | ((ctx: I18nContext) => string); // Dynamic function
```

---

## Message Keys Reference

### Common (common.\*)

- `common.save`, `common.cancel`, `common.delete`, `common.edit`
- `common.create`, `common.add`, `common.remove`, `common.close`
- `common.search`, `common.filter`, `common.refresh`, `common.loading`
- etc.

### Auth (auth.\*)

- `auth.login`, `auth.logout`, `auth.email`, `auth.password`
- `auth.signIn`, `auth.signUp`, `auth.forgotPassword`
- `auth.myAccount`, `auth.profile`
- etc.

### Collection (collection.\*)

- `collection.create`, `collection.edit`, `collection.delete`
- `collection.noItems`, `collection.itemCount`
- `collection.bulkDelete`, `collection.bulkDeleteSuccess`
- etc.

### Form (form.\*)

- `form.required`, `form.invalid`, `form.saveChanges`
- `form.createSuccess`, `form.updateSuccess`, `form.deleteSuccess`
- etc.

### Toast (toast.\*)

- `toast.success`, `toast.error`, `toast.warning`
- `toast.saveSuccess`, `toast.saveFailed`
- etc.

### Error (error.\*)

- `error.notFound`, `error.serverError`, `error.networkError`
- `error.unauthorized`, `error.forbidden`
- etc.

---

## Adding a New Language

1. Create message file:

```typescript
// packages/admin/src/client/i18n/messages/de.ts
export const adminMessagesDE = {
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  // ... all keys
} as const;
```

2. Export from index:

```typescript
// packages/admin/src/client/i18n/messages/index.ts
export { adminMessagesEN } from "./en.js";
export { adminMessagesSK } from "./sk.js";
export { adminMessagesDE } from "./de.js"; // NEW
```

3. Use in app:

```typescript
import { q } from "questpie";
import { adminModule } from "@questpie/admin/server";
import { adminMessagesDE } from "@questpie/admin/client";

const cms = q({ name: "my-app" })
  .use(adminModule)
  .adminLocale({ locales: ["en", "sk", "de"], defaultLocale: "en" })
  .messages({
    de: adminMessagesDE,
  })
  .build();
```

---

## Plural Forms

Slovak and other Slavic languages need `few` form:

```typescript
// English (one/other)
"collection.itemCount": {
  one: "{{count}} item",
  other: "{{count}} items"
}

// Slovak (one/few/other)
"collection.itemCount": {
  one: "{{count}} položka",      // 1
  few: "{{count}} položky",      // 2-4
  other: "{{count}} položiek"    // 5+
}
```

Uses `Intl.PluralRules` for correct plural selection.

---

## Backend Integration

### Locale in API Requests

Content locale is sent via `Accept-Language` header:

```typescript
// questpie client
client.setLocale("sk"); // Sets Accept-Language: sk
```

### Backend Message Translation

```typescript
// In custom function handler
const cms = context.cms;
const locale = context.locale ?? "en";

throw new ApiError({
  code: "BAD_REQUEST",
  message: cms.t("booking.slotNotAvailable", {}, locale),
});
```

---

## Files Reference

| File                                                         | Description                    |
| ------------------------------------------------------------ | ------------------------------ |
| `packages/admin/src/client/i18n/messages/en.ts`              | English admin messages         |
| `packages/admin/src/client/i18n/messages/sk.ts`              | Slovak admin messages          |
| `packages/admin/src/client/i18n/hooks.tsx`                   | useTranslation hook            |
| `packages/admin/src/client/i18n/simple.ts`                   | Simple i18n adapter            |
| `packages/admin/src/client/i18n/types.ts`                    | I18nText, I18nContext types    |
| `packages/admin/src/client/runtime/provider.tsx`             | AdminProvider with locale sync |
| `packages/admin/src/client/views/layout/admin-sidebar.tsx`   | UI language switcher           |
| `packages/admin/src/client/views/common/locale-switcher.tsx` | Content locale switcher        |
| `packages/questpie/src/shared/i18n/messages/*.ts`            | Validation messages            |
| `packages/questpie/src/server/i18n/messages/*.ts`            | Backend messages               |
