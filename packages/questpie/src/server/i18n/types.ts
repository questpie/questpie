/**
 * Backend I18n Types
 *
 * Type definitions for server-side i18n support.
 * Used for translating error messages and system messages.
 */

import type { MessageValue, PluralMessages } from "./messages.js";

// ============================================================================
// Messages Shape (for module and file-convention messages)
// ============================================================================

/**
 * Messages for a single locale
 */
export type LocaleMessagesShape = Record<string, MessageValue>;

/**
 * Messages object shape for module and file-convention messages.
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
// Backend Message Registry (Deprecated - use file-convention messages instead)
// ============================================================================

/**
 * Backend Message Registry - DEPRECATED
 *
 * This interface is kept for backwards compatibility but is no longer
 * the recommended way to register message keys.
 *
 * Instead, define messages through module contributions or the
 * `questpie/server/messages/<locale>.ts` file convention. Codegen includes
 * those keys in the generated app type.
 *
 * ```ts title="questpie/server/messages/en.ts"
 * export default { "myModule.error": "Error occurred" } as const;
 * ```
 *
 * ```ts
 * app.t("myModule.error"); // Type-safe!
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
 * @deprecated Use file-convention messages instead.
 */
export interface BackendMessageRegistry {
	// Empty - message keys now flow through codegen.
	// Legacy keys can still be added via module augmentation
}

/**
 * Backend message key type.
 *
 * This type allows any string for maximum flexibility, while still
 * providing autocomplete for keys registered via module augmentation.
 *
 * Type-safe project message keys come from codegen-discovered messages.
 */
export type BackendMessageKey = keyof BackendMessageRegistry | (string & {});

/**
 * Backend translate function signature
 *
 * Accepts typed message keys or any string for flexibility.
 * When using codegen-discovered messages, keys are inferred on the generated app.
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
