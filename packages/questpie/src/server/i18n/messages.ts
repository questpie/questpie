/**
 * Backend Messages
 *
 * Server-side messages for API error responses.
 * Imports shared validation messages and adds backend-specific messages.
 */

import {
	type ValidationMessage,
	validationMessagesCS,
	validationMessagesDE,
	validationMessagesEN,
	validationMessagesES,
	validationMessagesFR,
	validationMessagesPL,
	validationMessagesPT,
	validationMessagesSK,
} from "#questpie/shared/i18n/index.js";

import { messages } from "./messages/index.js";

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

export { messages } from "./messages/index.js";

// ============================================================================
// Combined Messages (backwards compatibility)
// ============================================================================

/**
 * Convert shared validation messages to backend MessageValue format
 */
function convertValidationMessages(
	msgs: Record<string, ValidationMessage>,
): Record<string, MessageValue> {
	const result: Record<string, MessageValue> = {};

	for (const [key, value] of Object.entries(msgs)) {
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
 * Use `messages.en` if you only need backend-specific messages.
 */
export const allBackendMessagesEN: Record<string, MessageValue> = {
	// Shared validation messages (from questpie/shared)
	...convertValidationMessages(validationMessagesEN),
	// Backend-specific messages
	...messages.en,
};

const validationMessagesByLocale: Record<
	string,
	Record<string, ValidationMessage>
> = {
	cs: validationMessagesCS,
	de: validationMessagesDE,
	en: validationMessagesEN,
	es: validationMessagesES,
	fr: validationMessagesFR,
	pl: validationMessagesPL,
	pt: validationMessagesPT,
	sk: validationMessagesSK,
};

function getValidationMessagesForLocale(
	locale: string,
): Record<string, ValidationMessage> {
	const normalizedLocale = locale.toLowerCase();
	const baseLocale = normalizedLocale.split("-")[0];

	return (
		validationMessagesByLocale[locale] ??
		validationMessagesByLocale[normalizedLocale] ??
		(baseLocale ? validationMessagesByLocale[baseLocale] : undefined) ??
		validationMessagesEN
	);
}

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
	const normalizedLocale = locale.toLowerCase();
	const baseLocale = normalizedLocale.split("-")[0];
	const bundledMessages =
		messages[locale as keyof typeof messages] ??
		messages[normalizedLocale as keyof typeof messages] ??
		(baseLocale ? messages[baseLocale as keyof typeof messages] : undefined) ??
		{};
	const customLocaleMessages =
		customMessages?.[locale] ??
		customMessages?.[normalizedLocale] ??
		(baseLocale ? customMessages?.[baseLocale] : undefined) ??
		{};

	return {
		...allBackendMessagesEN,
		...convertValidationMessages(getValidationMessagesForLocale(locale)),
		...bundledMessages,
		...customLocaleMessages,
	};
}

// ============================================================================
// Re-export shared validation messages
// ============================================================================

export {
	validationMessagesCS,
	validationMessagesDE,
	validationMessagesEN,
	validationMessagesES,
	validationMessagesFR,
	validationMessagesPL,
	validationMessagesPT,
	validationMessagesSK,
} from "#questpie/shared/i18n/index.js";
