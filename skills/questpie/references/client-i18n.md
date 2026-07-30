---
name: questpie-client/client-i18n
description:
  QUESTPIE client i18n React createSimpleI18n I18nProvider useTranslation useI18n useSafeI18n locale messages catalog plural formatDate formatNumber RTL setLocale adapter
  - questpie-core
---

# Client i18n

UI message translation in the browser. Distinct from two other things that share
the word "localization":

| Concern                        | Where it lives                    | Surface                        |
| ------------------------------ | --------------------------------- | ------------------------------ |
| Localized **content** per row  | `f.text().localized()`, i18n table | `references/data-modeling.md`  |
| **Server** message translation | `ctx.t(key, params, locale)`       | `references/app-context.md`    |
| **Client** UI messages         | this file                          | `questpie/client-react`        |

## Build an adapter, put it in a provider

```tsx
import { createSimpleI18n } from "questpie/client";
import { I18nProvider, useTranslation } from "questpie/client-react";

const i18n = createSimpleI18n({
	locales: ["en", "sk"],
	locale: "en",
	fallbackLocale: "en",
	messages: {
		en: { greeting: "Hello {{name}}", items: { one: "1 item", other: "{{count}} items" } },
		sk: { greeting: "Ahoj {{name}}", items: { one: "1 položka", other: "{{count}} položiek" } },
	},
});

<I18nProvider adapter={i18n}>
	<App />
</I18nProvider>;
```

```tsx
function Greeting() {
	const { t, locale, setLocale, formatDate, isRTL } = useTranslation();
	return <p dir={isRTL ? "rtl" : "ltr"}>{t("greeting", { name: "Ada" })}</p>;
}
```

## Catalogs are checked at compile time

`createSimpleI18n` rejects catalogs whose locales disagree on their key set —
**as a type error, before it is a runtime error**. Adding `checkout.title` to
`en` and forgetting `sk` fails the build rather than shipping an English string
into a Slovak page. The same check runs at construction time and throws.

It also rejects a `locale` or `fallbackLocale` that is not in `locales`, and
duplicate entries in `locales`.

`t()` is typed to the union of keys across the catalogs, so a typo'd key is a
type error too.

## Placeholders and plurals

`{{param}}` is substituted from the second argument; `{{ param }}` with spaces
works identically. A placeholder with no matching param is echoed back as
`{{key}}` rather than becoming `undefined`, so a missing value is visible
instead of corrupting the sentence.

A message may be a plural object instead of a string. Selection uses
`Intl.PluralRules` for the active locale, so a locale with `few`/`many`
categories gets them:

```ts
items: { one: "1 item", few: "{{count}} items", other: "{{count}} items" }
```

`one` and `other` are required; `zero`, `two`, `few`, `many` are optional and
fall back to `other`. Pass the count as a param — `t("items", { count: 5 })`.

## The three hooks

| Hook              | Returns                                                                                    | Outside a provider |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| `useTranslation()` | `{ locale, locales, t, setLocale, formatDate, formatNumber, getLocaleName, isRTL }` | throws             |
| `useI18n()`        | the raw `I18nAdapter`                                                                        | throws             |
| `useSafeI18n()`    | the raw `I18nAdapter` or `null`                                                              | returns `null`     |

`useTranslation` is the one to reach for. `isRTL` is already resolved to a
boolean there, where the adapter exposes it as a method.

Use `useSafeI18n` in a component that must render both inside and outside the
provider — a shared design-system component, or one mounted during boot before
the provider exists. Everywhere else the throw is what you want: it turns a
silently untranslated screen into a stack trace.

## Locale changes re-render

The provider subscribes through `useSyncExternalStore`, so `setLocale()`
re-renders consumers without any extra wiring, and SSR gets a stable initial
snapshot. `setLocale` may be async — an adapter that lazy-loads catalogs
returns a promise.

## Bring your own adapter

`I18nProvider` takes any `I18nAdapter`; `createSimpleI18n` is one
implementation, not the only one. Implement the interface to wrap
`react-i18next`, `next-intl`, or a server-driven catalog:

```ts
interface I18nAdapter<TLocale extends string, TMessageKey extends string> {
	readonly locale: TLocale;
	readonly locales: readonly TLocale[];
	t(key: TMessageKey, params?: Readonly<Record<string, unknown>>): string;
	setLocale(locale: TLocale): void | Promise<void>;
	onLocaleChange(callback: (locale: TLocale) => void): () => void;
	formatDate(date: Date | number, options?: Intl.DateTimeFormatOptions): string;
	formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
	formatRelative?(date: Date | number): string;
	getLocaleName(locale: string): string;
	isRTL(): boolean;
}
```

`onLocaleChange` must return an unsubscribe function — the provider calls it on
unmount.

## Checklist

- Catalogs share one key set, enforced by the type checker; do not silence it with a cast
- Count goes in as a param (`{ count }`), not baked into the key
- `useTranslation` unless the component must survive having no provider
- Content localization is a field concern (`.localized()`), not this
- Server-side messages go through `ctx.t`, which shares the same `{{param}}` substitution
