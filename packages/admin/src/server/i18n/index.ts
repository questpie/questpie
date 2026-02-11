/**
 * Server-Side Admin i18n Messages
 *
 * These messages are served to the admin client via the getAdminTranslations RPC function.
 * The client fetches translations for its current UI locale.
 *
 * @example
 * ```ts
 * // Server: messages are stored here
 * // Client: fetches via client.functions.getAdminTranslations({ locale: "sk" })
 * ```
 */

import { messages } from "./messages/index.js";

// Re-export messages
export { messages } from "./messages/index.js";

// Export individual locale messages for direct access
export const adminMessagesEN = messages.en;
export const adminMessagesSK = messages.sk;
export const adminMessagesCS = messages.cs;
export const adminMessagesDE = messages.de;
export const adminMessagesFR = messages.fr;
export const adminMessagesES = messages.es;
export const adminMessagesPT = messages.pt;
export const adminMessagesPL = messages.pl;

/**
 * Message value type - string or plural form
 */
export type MessageValue = string | { one: string; other: string };

/**
 * Messages record type
 */
export type AdminMessages = Record<string, MessageValue>;

/**
 * All admin messages indexed by locale code.
 * Used by getAdminTranslations to serve messages for requested locale.
 */
export const allAdminMessages: Record<string, AdminMessages> = messages;

/**
 * Get admin messages for a specific locale.
 * Falls back to English if locale not found.
 *
 * @param locale - Locale code (e.g., "en", "sk")
 * @returns Messages for the locale
 */
export function getAdminMessagesForLocale(locale: string): AdminMessages {
	return messages[locale as keyof typeof messages] ?? messages.en ?? {};
}

/**
 * Get list of supported admin UI locales.
 * These are locales that have message files.
 */
export function getSupportedAdminLocales(): string[] {
	return Object.keys(messages);
}
