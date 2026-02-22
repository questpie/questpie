/**
 * Shared Validation Messages
 *
 * These messages are shared between frontend (admin) and backend (server).
 * Used by Zod error maps for localized validation errors.
 */

import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import { validationMessagesEN } from "./messages/en.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Validation message with optional plural forms
 */
export type ValidationMessage =
	| string
	| {
			one: string;
			other: string;
			zero?: string;
			few?: string;
			many?: string;
	  };

/**
 * Validation messages map type
 */
export type ValidationMessagesMap = Record<string, ValidationMessage>;

/**
 * All validation message keys
 */
export type ValidationMessageKey = keyof typeof validationMessagesEN;

/**
 * Translate function type for validation messages
 */
export type ValidationTranslateFn = (
	key: ValidationMessageKey | (string & {}),
	params?: Record<string, unknown>,
) => string;

// ============================================================================
// Re-export new structure
// ============================================================================

export {
	validationMessagesEN,
	validationMessagesSK,
} from "./messages/index.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the count for plural selection from params
 */
function getPluralCount(params?: Record<string, unknown>): number {
	if (!params) return 1;

	// Check common count-related params
	for (const key of ["count", "min", "max", "length"]) {
		if (typeof params[key] === "number") {
			return params[key] as number;
		}
	}

	return 1;
}

/**
 * Select plural form based on count
 */
function selectPluralForm(
	message: ValidationMessage,
	count: number,
	locale: string,
): string {
	if (typeof message === "string") {
		return message;
	}

	try {
		const rules = new Intl.PluralRules(locale);
		const category = rules.select(count);

		switch (category) {
			case "zero":
				return message.zero ?? message.other;
			case "one":
				return message.one;
			case "few":
				return message.few ?? message.other;
			case "many":
				return message.many ?? message.other;
			default:
				return message.other;
		}
	} catch {
		// Fallback if Intl.PluralRules fails
		return count === 1 ? message.one : message.other;
	}
}

/**
 * Interpolate params into message string
 */
function interpolate(
	template: string,
	params?: Record<string, unknown>,
): string {
	if (!params) return template;

	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		const value = params[key];
		return value !== undefined ? String(value) : `{{${key}}}`;
	});
}

/**
 * Create a translate function for validation messages
 *
 * @param customMessages - Custom messages to override defaults (per locale)
 * @param locale - Current locale
 * @param fallbackLocale - Fallback locale (default: "en")
 *
 * @example
 * ```ts
 * const t = createValidationTranslator({
 *   sk: {
 *     "validation.required": "Toto pole je povinne",
 *     "validation.string.email": "Neplatna emailova adresa",
 *   }
 * }, "sk");
 *
 * t("validation.required"); // "Toto pole je povinne"
 * t("validation.string.max", { max: 100 }); // "Must be at most 100 characters"
 * ```
 */
export function createValidationTranslator(
	customMessages?: Record<string, ValidationMessagesMap>,
	locale: string = DEFAULT_LOCALE,
	fallbackLocale: string = DEFAULT_LOCALE,
): ValidationTranslateFn {
	return (key, params) => {
		// Try custom messages for current locale
		let message: ValidationMessage | undefined =
			customMessages?.[locale]?.[key];

		// Try default messages
		if (message === undefined) {
			message = validationMessagesEN[key as ValidationMessageKey];
		}

		// Try custom messages for fallback locale
		if (message === undefined && locale !== fallbackLocale) {
			message = customMessages?.[fallbackLocale]?.[key];
		}

		// Return key if no message found
		if (message === undefined) {
			return params ? interpolate(key, params) : key;
		}

		// Handle plural forms
		const count = getPluralCount(params);
		const selectedMessage = selectPluralForm(message, count, locale);

		// Interpolate params
		return interpolate(selectedMessage, params);
	};
}

/**
 * Merge validation messages from multiple sources
 */
export function mergeValidationMessages(
	...sources: (ValidationMessagesMap | undefined)[]
): ValidationMessagesMap {
	const result: ValidationMessagesMap = {};

	for (const source of sources) {
		if (source) {
			Object.assign(result, source);
		}
	}

	return result;
}
