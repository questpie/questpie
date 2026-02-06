/**
 * Internationalized Text Types
 *
 * These types support three formats for i18n text values:
 * 1. Simple string (no translation, same for all locales)
 * 2. Translation key (resolved via i18n adapter)
 * 3. Inline locale map (recommended for collection/field labels)
 */

/**
 * Locale-to-string mapping for inline translations.
 * Keys are locale codes (e.g., "en", "sk", "de").
 */
export type I18nLocaleMap = {
  [locale: string]: string;
};

/**
 * Translation key reference with optional fallback and params.
 */
export interface I18nTranslationKey {
  key: string;
  fallback?: string;
  params?: Record<string, unknown>;
}

/**
 * Internationalized text value.
 * Used for labels, descriptions, and other user-facing strings.
 *
 * Supports three formats:
 *
 * 1. **Simple string** (no translation, same for all locales):
 *    ```ts
 *    label: "Posts"
 *    ```
 *
 * 2. **Translation key** (resolved via i18n adapter):
 *    ```ts
 *    label: { key: "collections.posts.label" }
 *    label: { key: "collections.posts.label", fallback: "Posts" }
 *    label: { key: "greeting", params: { name: "John" } }
 *    ```
 *
 * 3. **Inline locale map** (recommended for collection/field labels):
 *    ```ts
 *    label: { en: "Posts", sk: "Príspevky", de: "Beiträge" }
 *    ```
 *
 * All formats are serializable for API transport and introspection.
 */
export type I18nText = string | I18nTranslationKey | I18nLocaleMap;

/**
 * Type guard to check if value is a translation key object.
 */
export function isI18nTranslationKey(
  value: I18nText,
): value is I18nTranslationKey {
  return typeof value === "object" && value !== null && "key" in value;
}

/**
 * Type guard to check if value is a locale map.
 */
export function isI18nLocaleMap(value: I18nText): value is I18nLocaleMap {
  return typeof value === "object" && value !== null && !("key" in value);
}

/**
 * Resolve I18nText to string for given locale.
 *
 * @param value - The i18n text value to resolve
 * @param locale - Target locale code
 * @param t - Optional translation function for key-based translations
 * @returns Resolved string value
 */
export function resolveI18nText(
  value: I18nText,
  locale: string,
  t?: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (typeof value === "string") {
    return value;
  }

  if (isI18nTranslationKey(value)) {
    // Translation key - use t() function or fallback
    if (t) {
      return t(value.key, value.params);
    }
    return value.fallback ?? value.key;
  }

  // Locale map - get value for locale or first available
  return value[locale] ?? value["en"] ?? Object.values(value)[0] ?? "";
}
