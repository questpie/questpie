import {
	createSimpleI18n as createGenericSimpleI18n,
	type I18nAdapter,
	type I18nMessage,
	type MessageCatalog,
	type PluralMessages,
} from "questpie/client";

export type { PluralMessages };

export type SimpleMessages = Record<string, I18nMessage>;

interface SimpleI18nOptions {
	locale: string;
	locales: string[];
	messages: Record<string, SimpleMessages>;
	fallbackLocale?: string;
	onLocaleChange?: (locale: string) => void;
}

/**
 * Compatibility adapter for Admin's server-fetched catalogs.
 *
 * Admin loads one locale at a time, so catalogs for the other advertised
 * locales are temporarily filled from the loaded/fallback catalog. The public
 * generic factory remains strict and requires complete, key-aligned catalogs.
 */
export function createSimpleI18n(options: SimpleI18nOptions): I18nAdapter {
	const locales = [...new Set(options.locales)];
	if (locales.length === 0) {
		throw new TypeError("Admin i18n requires at least one locale");
	}
	const fallbackLocale = options.fallbackLocale ?? locales[0]!;
	const seedCatalog =
		options.messages[fallbackLocale] ??
		options.messages[options.locale] ??
		Object.values(options.messages)[0] ??
		{};
	const messageKeys = new Set(Object.keys(seedCatalog));
	for (const catalog of Object.values(options.messages)) {
		for (const key of Object.keys(catalog)) messageKeys.add(key);
	}

	const messages: Record<string, MessageCatalog> = {};
	for (const locale of locales) {
		const catalog = options.messages[locale] ?? {};
		const normalized: Record<string, I18nMessage> = {};
		for (const key of messageKeys) {
			normalized[key] = catalog[key] ?? seedCatalog[key] ?? key;
		}
		messages[locale] = normalized;
	}

	return createGenericSimpleI18n({
		locale: options.locale,
		locales: locales as [string, ...string[]],
		messages,
		fallbackLocale,
		onLocaleChange: options.onLocaleChange,
	});
}
