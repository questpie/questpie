/**
 * Backend Translator
 *
 * Creates a translator function for server-side message translation.
 */

import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import type { PluralMessages } from "./messages.js";
import { allBackendMessagesEN } from "./messages.js";
import type { BackendTranslateFn, TranslationsConfig } from "./types.js";

// ============================================================================
// Plural Rules Cache
// ============================================================================

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale: string): Intl.PluralRules {
	let rules = pluralRulesCache.get(locale);
	if (!rules) {
		rules = new Intl.PluralRules(locale);
		pluralRulesCache.set(locale, rules);
	}
	return rules;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if value is plural messages
 */
function isPluralMessages(value: unknown): value is PluralMessages {
	return (
		typeof value === "object" &&
		value !== null &&
		"one" in value &&
		"other" in value
	);
}

/**
 * Get plural form from plural messages
 */
function getPluralForm(
	forms: PluralMessages,
	count: number,
	locale: string,
): string {
	const rules = getPluralRules(locale);
	const category = rules.select(count);

	switch (category) {
		case "zero":
			return forms.zero ?? forms.other;
		case "one":
			return forms.one;
		case "two":
			return forms.two ?? forms.other;
		case "few":
			return forms.few ?? forms.other;
		case "many":
			return forms.many ?? forms.other;
		default:
			return forms.other;
	}
}

/**
 * Interpolate values into string
 */
function interpolate(str: string, params?: Record<string, unknown>): string {
	if (!params) return str;
	return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		const value = params[key];
		return value !== undefined ? String(value) : `{{${key}}}`;
	});
}

// ============================================================================
// Translator Factory
// ============================================================================

/**
 * Create a backend translator function
 *
 * @example
 * ```ts
 * const t = createTranslator({
 *   messages: {
 *     en: { "error.notFound": "Not found" },
 *     sk: { "error.notFound": "Nenájdené" },
 *   },
 *   fallbackLocale: "en",
 * });
 *
 * t("error.notFound", {}, "sk"); // "Nenájdené"
 * t("error.notFound"); // "Not found"
 * ```
 */
export function createTranslator(
	config?: TranslationsConfig,
): BackendTranslateFn {
	const customMessages = config?.messages ?? {};
	const fallbackLocale = config?.fallbackLocale ?? DEFAULT_LOCALE;

	return (key, params, locale): string => {
		const currentLocale = locale ?? fallbackLocale;

		// Try custom messages first for current locale
		let message: string | PluralMessages | undefined =
			customMessages[currentLocale]?.[key];

		// Fallback to default backend messages for current locale
		if (message === undefined) {
			message = allBackendMessagesEN[key];
		}

		// Try fallback locale in custom messages
		if (message === undefined && currentLocale !== fallbackLocale) {
			message = customMessages[fallbackLocale]?.[key];
		}

		// Final fallback - return key
		if (message === undefined) {
			return key;
		}

		// Handle plural forms
		if (isPluralMessages(message)) {
			const count = typeof params?.count === "number" ? params.count : 1;
			const form = getPluralForm(message, count, currentLocale);
			return interpolate(form, params);
		}

		return interpolate(message, params);
	};
}

/**
 * Merge translation configs
 */
export function mergeTranslationsConfig(
	base: TranslationsConfig | undefined,
	override: TranslationsConfig | undefined,
): TranslationsConfig | undefined {
	if (!base && !override) return undefined;
	if (!base) return override;
	if (!override) return base;

	// Deep merge messages
	const mergedMessages: Record<
		string,
		Record<string, string | PluralMessages>
	> = {
		...base.messages,
	};

	for (const [locale, messages] of Object.entries(override.messages)) {
		mergedMessages[locale] = {
			...(mergedMessages[locale] ?? {}),
			...messages,
		};
	}

	return {
		messages: mergedMessages,
		fallbackLocale: override.fallbackLocale ?? base.fallbackLocale,
	};
}

/**
 * Merge messages shape into existing translations config
 *
 * This is a convenience function for the .messages() builder method.
 * It converts a simple MessagesShape into TranslationsConfig format.
 *
 * @example
 * ```ts
 * const messages = {
 *   en: { "booking.created": "Created" },
 *   sk: { "booking.created": "Vytvorené" },
 * };
 *
 * const config = mergeMessagesIntoConfig(existingConfig, messages);
 * ```
 */
export function mergeMessagesIntoConfig(
	base: TranslationsConfig | undefined,
	messages: Record<string, Record<string, string | PluralMessages>>,
	fallbackLocale?: string,
): TranslationsConfig {
	const override: TranslationsConfig = {
		messages,
		fallbackLocale,
	};

	const merged = mergeTranslationsConfig(base, override);

	// Ensure we always return a config
	return merged ?? { messages: {}, fallbackLocale: DEFAULT_LOCALE };
}
