/**
 * Backend I18n Types
 *
 * Type definitions for server-side i18n support.
 * Used for translating error messages and system messages.
 */

import type { MessageValue, PluralMessages } from "./messages.js";

// ============================================================================
// Messages Shape (for .messages() builder method)
// ============================================================================

/**
 * Messages for a single locale
 */
export type LocaleMessagesShape = Record<string, MessageValue>;

/**
 * Messages object shape for .messages() builder method
 * Record<locale, Record<key, MessageValue>>
 *
 * @example
 * ```ts
 * const messages = {
 *   en: {
 *     "booking.created": "Booking created for {{date}}",
 *     "items.count": { one: "{{count}} item", other: "{{count}} items" },
 *   },
 *   sk: {
 *     "booking.created": "Rezervácia vytvorená na {{date}}",
 *     "items.count": { one: "{{count}} položka", other: "{{count}} položiek" },
 *   },
 * } as const;
 * ```
 */
export type MessagesShape = Record<string, LocaleMessagesShape>;

/**
 * Infer message keys from a messages object
 * Uses first locale's keys as reference
 *
 * @example
 * ```ts
 * const messages = {
 *   en: { "a.b": "x", "c.d": "y" },
 *   sk: { "a.b": "x" },
 * } as const;
 *
 * type Keys = InferMessageKeys<typeof messages>;
 * // Keys = "a.b" | "c.d"
 * ```
 */
export type InferMessageKeys<T extends MessagesShape> =
  T[keyof T] extends infer LocaleMessages
    ? LocaleMessages extends LocaleMessagesShape
      ? keyof LocaleMessages & string
      : never
    : never;

/**
 * Typed translator function with inferred keys
 *
 * @example
 * ```ts
 * const messages = { en: { "a": "A" } } as const;
 * type TFn = TypedTranslateFn<InferMessageKeys<typeof messages>>;
 * // TFn = (key: "a" | DefaultBackendMessageKey, params?, locale?) => string
 * ```
 */
export type TypedTranslateFn<TCustomKeys extends string = never> = (
  key: BackendMessageKey | TCustomKeys,
  params?: Record<string, unknown>,
  locale?: string,
) => string;

// ============================================================================
// Backend Message Registry (Deprecated - use .messages() instead)
// ============================================================================

/**
 * Backend Message Registry - DEPRECATED
 *
 * This interface is kept for backwards compatibility but is no longer
 * the recommended way to register message keys.
 *
 * Instead, use the `.messages()` method on the builder which provides
 * type-safe message keys through the builder chain:
 *
 * ```ts
 * const messages = {
 *   en: { "myModule.error": "Error occurred" },
 * } as const;
 *
 * const cms = questpie({ name: "app" })
 *   .use(starterModule) // Includes core messages
 *   .messages(messages) // Add custom messages
 *   .build({ ... });
 *
 * cms.t("myModule.error"); // Type-safe!
 * ```
 *
 * For legacy support, you can still extend this interface:
 * ```ts
 * declare module "questpie" {
 *   interface BackendMessageRegistry {
 *     "legacy.key": string;
 *   }
 * }
 * ```
 *
 * @deprecated Use .messages() on the builder instead
 */
// biome-ignore lint/suspicious/noEmptyInterface: Module augmentation target for backwards compatibility
export interface BackendMessageRegistry {
  // Empty - message keys now flow through builder chain via .messages()
  // Legacy keys can still be added via module augmentation
}

/**
 * Backend message key type.
 *
 * This type allows any string for maximum flexibility, while still
 * providing autocomplete for keys registered via module augmentation.
 *
 * For type-safe message keys, use the .messages() pattern on the builder
 * which infers keys at the instance level (cms.t()).
 */
export type BackendMessageKey = keyof BackendMessageRegistry | (string & {});

/**
 * Backend translate function signature
 *
 * Accepts typed message keys or any string for flexibility.
 * When using the new .messages() pattern, keys are inferred from the builder chain.
 * The (string & {}) allows arbitrary strings while still providing autocomplete
 * for known keys.
 */
export type BackendTranslateFn = (
  key: BackendMessageKey | (string & {}),
  params?: Record<string, unknown>,
  locale?: string,
) => string;

// ============================================================================
// Translations Config
// ============================================================================

/**
 * Translation messages for a single locale
 */
export type LocaleMessages = Record<string, string | PluralMessages>;

/**
 * Translation configuration for the builder
 */
export interface TranslationsConfig {
  /**
   * Messages keyed by locale
   * e.g. { en: { "error.notFound": "Not found" }, sk: { "error.notFound": "Nenájdené" } }
   */
  messages: Record<string, LocaleMessages>;

  /**
   * Fallback locale when translation not found
   * @default "en"
   */
  fallbackLocale?: string;
}
