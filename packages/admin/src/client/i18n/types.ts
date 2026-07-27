/**
 * I18n Types
 *
 * Minimal type definitions for i18n integration.
 * Designed to work with any i18n library.
 */

import type { I18nAdapter as GenericI18nAdapter } from "questpie/client";

export type {
	I18nProviderProps,
	UseTranslationResult,
} from "questpie/client-react";

// ============================================================================
// Message Registry (Type-Safe Translation Keys)
// ============================================================================

/**
 * Message Registry for type-safe translation keys.
 *
 * This is an augmentation target - users can extend it for type-safe keys.
 * By default, the `t` function accepts any string key.
 *
 * @example
 * ```ts
 * // Optional: Augment for type-safe keys
 * declare module "@questpie/admin" {
 *   interface MessageRegistry {
 *     messages: typeof myMessages;
 *   }
 * }
 * ```
 */
interface MessageRegistry {
	// Augment this interface to provide type-safe message keys:
	// declare module "@questpie/admin" {
	//   interface MessageRegistry {
	//     messages: typeof adminMessagesEN;
	//   }
	// }
}

/**
 * Extract message keys from MessageRegistry if augmented, otherwise string.
 */
type MessageKey = MessageRegistry extends { messages: infer T }
	? keyof T & string
	: string;

// ============================================================================
// Core Adapter Interface
// ============================================================================

export type I18nAdapter = GenericI18nAdapter<string, MessageKey>;

// ============================================================================
// I18nText - For Config Values
// ============================================================================

/**
 * Inline translations object - maps locale codes to translated strings
 *
 * @example
 * ```ts
 * { en: "Barbers", sk: "Holiči", cz: "Holiči" }
 * ```
 */
export type I18nLocaleMap = {
	[locale: string]: string;
};

/**
 * I18nText - A value that can be translated
 *
 * Used in admin config for labels, descriptions, etc.
 * Supports multiple formats for flexibility.
 *
 * @example
 * ```ts
 * // Simple string (no translation)
 * label: "Posts"
 *
 * // Translation key
 * label: { key: "nav.posts" }
 *
 * // Translation key with fallback
 * label: { key: "nav.posts", fallback: "Posts" }
 *
 * // Inline translations (recommended for collection/global labels)
 * label: { en: "Barbers", sk: "Holiči", cz: "Holiči" }
 *
 * // Dynamic function
 * label: (ctx) => ctx.t("nav.posts")
 * ```
 */
export type I18nText =
	| string
	| { key: string; fallback?: string; params?: Record<string, unknown> }
	| I18nLocaleMap
	| ((ctx: I18nContext) => string);

/**
 * Context passed to I18nText functions
 */
export interface I18nContext {
	locale: string;
	t: I18nAdapter["t"];
	formatDate: I18nAdapter["formatDate"];
	formatNumber: I18nAdapter["formatNumber"];
}
