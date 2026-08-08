/**
 * I18n React Hooks
 *
 * React context and hooks for i18n in the admin UI.
 */

import { useSafeI18n, useTranslation } from "questpie/client-react";
import { DEFAULT_LOCALE } from "questpie/shared";
import * as React from "react";
import { useCallback } from "react";

import { resolveDateFnsLocale } from "./date-locale";
import type { I18nContext as I18nContextType, I18nText } from "./types";

export {
	I18nProvider,
	useI18n,
	useSafeI18n,
	useTranslation,
} from "questpie/client-react";

/**
 * Returns the date-fns `Locale` object matching the current admin UI locale.
 * Only `enUS` is bundled by default — register others via `registerDateFnsLocale`.
 */
export function useDateFnsLocale() {
	const { locale } = useTranslation();
	return resolveDateFnsLocale(locale);
}

// ============================================================================
// I18nText Resolver
// ============================================================================

/**
 * Check if an object is a locale map (has locale codes as keys)
 */
function isLocaleMap(obj: object): obj is Record<string, string> {
	// If it has a "key" property, it's a translation key lookup
	if ("key" in obj) return false;
	// Check if all values are strings (locale map)
	return Object.values(obj).every((v) => typeof v === "string");
}

/**
 * Resolve locale map to string for given locale
 */
function resolveLocaleMap(
	map: Record<string, string>,
	locale: string,
	fallback: string,
): string {
	// Try exact locale match
	if (map[locale]) return map[locale];
	// Try language code only (e.g., "en" from "en-US")
	const lang = locale.split("-")[0];
	if (lang && map[lang]) return map[lang];
	// Try default locale as fallback
	if (map[DEFAULT_LOCALE]) return map[DEFAULT_LOCALE];
	// Return first available value
	const firstValue = Object.values(map)[0];
	return firstValue ?? fallback;
}

/**
 * Resolve I18nText to string
 *
 * @example
 * ```tsx
 * function Label({ text }: { text: I18nText }) {
 *   const resolve = useResolveText();
 *   return <span>{resolve(text)}</span>;
 * }
 * ```
 */
export function useResolveText(): (
	text: I18nText | ((values: Record<string, any>) => I18nText) | undefined,
	fallback?: string,
	contextValues?: Record<string, any>,
) => string {
	const adapter = useSafeI18n();

	return useCallback(
		(
			text: I18nText | ((values: Record<string, any>) => I18nText) | undefined,
			fallback = "",
			contextValues?: Record<string, any>,
		): string => {
			const resolveValue = (value: I18nText | undefined): string => {
				if (value === undefined || value === null) return fallback;

				// Plain string
				if (typeof value === "string") return value;

				// Function
				if (typeof value === "function") {
					if (!adapter && !contextValues) return fallback;
					const i18nCtx = adapter
						? {
								locale: adapter.locale,
								t: adapter.t,
								formatDate: adapter.formatDate,
								formatNumber: adapter.formatNumber,
							}
						: undefined;
					const ctx = {
						...(contextValues ?? {}),
						...(i18nCtx ?? {}),
					} as I18nContextType & Record<string, any>;
					try {
						const result = value(ctx);
						return resolveValue(result as I18nText);
					} catch (error) {
						console.error("Failed to resolve dynamic text:", error);
						return fallback;
					}
				}

				// Object with key (translation key lookup)
				if (
					typeof value === "object" &&
					"key" in value &&
					typeof value.key === "string"
				) {
					const keyObj = value as {
						key: string;
						fallback?: string;
						params?: Record<string, unknown>;
					};
					if (!adapter) return keyObj.fallback ?? fallback;
					const result = adapter.t(keyObj.key, keyObj.params);
					// If t() returns the key (not found), use fallback
					return result === keyObj.key ? (keyObj.fallback ?? result) : result;
				}

				// Locale map (inline translations)
				if (typeof value === "object" && isLocaleMap(value)) {
					const locale = adapter?.locale ?? DEFAULT_LOCALE;
					return resolveLocaleMap(value, locale, fallback);
				}

				return fallback;
			};

			return resolveValue(text as I18nText | undefined);
		},
		[adapter],
	);
}
