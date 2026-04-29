/**
 * date-fns locale resolver for DayPicker and date formatting.
 *
 * Only `enUS` is included by default to keep bundle size small.
 * Register additional locales at admin setup time:
 *
 * @example
 * ```ts
 * import { sk } from "date-fns/locale/sk";
 * import { registerDateFnsLocale } from "@questpie/admin/client-module";
 *
 * registerDateFnsLocale("sk", sk);
 * ```
 */

import { enUS } from "date-fns/locale/en-US";
import type { Locale } from "date-fns";

// Registry: locale-code → date-fns Locale. Seeded with English.
const localeRegistry = new Map<string, Locale>([
	["en", enUS],
	["en-US", enUS],
]);

/**
 * Register a date-fns Locale for a given locale code.
 * Call this at admin startup before any date pickers render.
 */
export function registerDateFnsLocale(code: string, locale: Locale): void {
	localeRegistry.set(code, locale);
}

/**
 * Resolve a date-fns Locale from a BCP-47 locale code (e.g. "sk", "en-US").
 * Falls back to `enUS` if the locale is not registered.
 */
export function resolveDateFnsLocale(localeCode: string): Locale {
	// Exact match
	const exact = localeRegistry.get(localeCode);
	if (exact) return exact;

	// Language-only match (e.g. "sk" from "sk-SK")
	const lang = localeCode.split("-")[0];
	const byLang = localeRegistry.get(lang);
	if (byLang) return byLang;

	// English fallback
	return enUS;
}
