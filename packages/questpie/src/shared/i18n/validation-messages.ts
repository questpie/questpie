/**
 * Shared Validation Messages
 *
 * These messages are shared between frontend (admin) and backend (server).
 * Used by Zod error maps for localized validation errors.
 */

import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";

import { validationMessagesCS } from "./messages/cs.js";
import { validationMessagesDE } from "./messages/de.js";
import { validationMessagesEN } from "./messages/en.js";
import { validationMessagesES } from "./messages/es.js";
import { validationMessagesFR } from "./messages/fr.js";
import { validationMessagesPL } from "./messages/pl.js";
import { validationMessagesPT } from "./messages/pt.js";
import { validationMessagesSK } from "./messages/sk.js";

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

const bundledValidationMessages: Record<string, ValidationMessagesMap> = {
	cs: validationMessagesCS,
	de: validationMessagesDE,
	en: validationMessagesEN,
	es: validationMessagesES,
	fr: validationMessagesFR,
	pl: validationMessagesPL,
	pt: validationMessagesPT,
	sk: validationMessagesSK,
};

// ============================================================================
// Re-export new structure
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

function getLocaleMessages(
	messages: Record<string, ValidationMessagesMap> | undefined,
	locale: string,
): ValidationMessagesMap | undefined {
	const normalizedLocale = locale.toLowerCase();
	const baseLocale = normalizedLocale.split("-")[0];

	return (
		messages?.[locale] ??
		messages?.[normalizedLocale] ??
		(baseLocale ? messages?.[baseLocale] : undefined)
	);
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
		let message: ValidationMessage | undefined = getLocaleMessages(
			customMessages,
			locale,
		)?.[key];

		// Try bundled messages for current locale
		if (message === undefined) {
			message = getLocaleMessages(bundledValidationMessages, locale)?.[
				key as ValidationMessageKey
			];
		}

		// Try custom messages for fallback locale
		if (message === undefined && locale !== fallbackLocale) {
			message = getLocaleMessages(customMessages, fallbackLocale)?.[key];
		}

		// Try bundled messages for fallback locale
		if (message === undefined && locale !== fallbackLocale) {
			message = getLocaleMessages(bundledValidationMessages, fallbackLocale)?.[
				key as ValidationMessageKey
			];
		}

		// Final bundled English fallback
		if (message === undefined) {
			message = validationMessagesEN[key as ValidationMessageKey];
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
