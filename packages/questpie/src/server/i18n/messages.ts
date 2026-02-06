/**
 * Backend Messages
 *
 * Server-side messages for API error responses.
 * Imports shared validation messages and adds backend-specific messages.
 */

import {
  type ValidationMessage,
  validationMessagesEN,
} from "#questpie/shared/i18n/index.js";
import { backendMessagesEN } from "./messages/en.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Plural messages using Intl.PluralRules categories
 */
export type PluralMessages = {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

/**
 * Message value - either simple string or plural forms
 */
export type MessageValue = string | PluralMessages;

// ============================================================================
// Re-export new structure
// ============================================================================

export { backendMessagesEN, backendMessagesSK } from "./messages/index.js";

// ============================================================================
// Combined Messages (backwards compatibility)
// ============================================================================

/**
 * Convert shared validation messages to backend MessageValue format
 */
function convertValidationMessages(
  messages: Record<string, ValidationMessage>,
): Record<string, MessageValue> {
  const result: Record<string, MessageValue> = {};

  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === "string") {
      result[key] = value;
    } else {
      // Convert plural format
      result[key] = {
        one: value.one,
        other: value.other,
        zero: value.zero,
        few: value.few,
        many: value.many,
      };
    }
  }

  return result;
}

/**
 * All English messages for backend (backend + validation combined)
 *
 * Use this when you need all messages including validation.
 * Use `backendMessagesEN` if you only need backend-specific messages.
 */
export const allBackendMessagesEN: Record<string, MessageValue> = {
  // Shared validation messages (from questpie/shared)
  ...convertValidationMessages(validationMessagesEN),
  // Backend-specific messages
  ...backendMessagesEN,
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get backend messages for a locale
 *
 * Returns English as fallback if locale not found.
 */
export function getBackendMessages(
  locale: string,
  customMessages?: Record<string, Record<string, MessageValue>>,
): Record<string, MessageValue> {
  // Check for custom messages first
  if (customMessages?.[locale]) {
    return { ...allBackendMessagesEN, ...customMessages[locale] };
  }

  // For now, only English is bundled
  if (locale === "en") {
    return allBackendMessagesEN;
  }

  // Fallback to English
  return allBackendMessagesEN;
}

// ============================================================================
// Re-export shared validation messages
// ============================================================================

export { validationMessagesEN } from "#questpie/shared/i18n/index.js";
