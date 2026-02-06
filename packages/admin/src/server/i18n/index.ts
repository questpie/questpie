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

// Re-export all message files
export { adminMessagesCS } from "./messages/cs.js";
export { adminMessagesDE } from "./messages/de.js";
export { adminMessagesEN } from "./messages/en.js";
export { adminMessagesES } from "./messages/es.js";
export { adminMessagesFR } from "./messages/fr.js";
export { adminMessagesPL } from "./messages/pl.js";
export { adminMessagesPT } from "./messages/pt.js";
export { adminMessagesSK } from "./messages/sk.js";

// Import for internal use
import { adminMessagesCS } from "./messages/cs.js";
import { adminMessagesDE } from "./messages/de.js";
import { adminMessagesEN } from "./messages/en.js";
import { adminMessagesES } from "./messages/es.js";
import { adminMessagesFR } from "./messages/fr.js";
import { adminMessagesPL } from "./messages/pl.js";
import { adminMessagesPT } from "./messages/pt.js";
import { adminMessagesSK } from "./messages/sk.js";

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
export const allAdminMessages: Record<string, AdminMessages> = {
  en: adminMessagesEN,
  sk: adminMessagesSK,
  cs: adminMessagesCS,
  de: adminMessagesDE,
  fr: adminMessagesFR,
  es: adminMessagesES,
  pt: adminMessagesPT,
  pl: adminMessagesPL,
};

/**
 * Get admin messages for a specific locale.
 * Falls back to English if locale not found.
 *
 * @param locale - Locale code (e.g., "en", "sk")
 * @returns Messages for the locale
 */
export function getAdminMessagesForLocale(locale: string): AdminMessages {
  return allAdminMessages[locale] ?? allAdminMessages.en ?? {};
}

/**
 * Get list of supported admin UI locales.
 * These are locales that have message files.
 */
export function getSupportedAdminLocales(): string[] {
  return Object.keys(allAdminMessages);
}
