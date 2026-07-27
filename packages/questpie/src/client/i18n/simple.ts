import { IntlFormatterCache } from "./intl-cache.js";
import type {
	I18nAdapter,
	MessageCatalog,
	MessageKeys,
	NonEmptyLocaleTuple,
	PluralMessages,
	SimpleI18nOptions,
} from "./types.js";

const RTL_BASE_LANGUAGES = new Set(["ar", "fa", "he", "ps", "sd", "ur", "yi"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateLocale(
	locale: unknown,
	label: string,
): asserts locale is string {
	if (
		typeof locale !== "string" ||
		locale.length === 0 ||
		locale.trim() !== locale
	) {
		throw new TypeError(`${label} must be a non-empty locale string`);
	}
	try {
		Intl.getCanonicalLocales(locale);
	} catch {
		throw new TypeError(`${label} "${locale}" is not a valid locale`);
	}
}

function validateMessage(
	message: unknown,
	locale: string,
	key: string,
): asserts message is string | PluralMessages {
	if (typeof message === "string") return;
	if (!isRecord(message)) {
		throw new TypeError(
			`Message "${key}" for locale "${locale}" must be a string or plural message`,
		);
	}
	for (const category of ["zero", "one", "two", "few", "many", "other"]) {
		const value = message[category];
		if (
			(category === "one" || category === "other") &&
			typeof value !== "string"
		) {
			throw new TypeError(
				`Plural message "${key}" for locale "${locale}" requires string "${category}"`,
			);
		}
		if (value !== undefined && typeof value !== "string") {
			throw new TypeError(
				`Plural category "${category}" in message "${key}" for locale "${locale}" must be a string`,
			);
		}
	}
	for (const category of Object.keys(message)) {
		if (!["zero", "one", "two", "few", "many", "other"].includes(category)) {
			throw new TypeError(
				`Unexpected plural category "${category}" in message "${key}" for locale "${locale}"`,
			);
		}
	}
}

function validateAndCloneCatalogs(
	locales: readonly string[],
	messages: unknown,
): Readonly<Record<string, MessageCatalog>> {
	if (!isRecord(messages)) {
		throw new TypeError("Messages must be a record of locale catalogs");
	}

	for (const locale of locales) {
		if (!Object.hasOwn(messages, locale)) {
			throw new TypeError(`Missing catalog for locale "${locale}"`);
		}
	}
	for (const locale of Object.keys(messages)) {
		if (!locales.includes(locale)) {
			throw new TypeError(`Unexpected catalog for locale "${locale}"`);
		}
	}

	const referenceCatalog = messages[locales[0]!];
	if (!isRecord(referenceCatalog)) {
		throw new TypeError(`Catalog for locale "${locales[0]}" must be a record`);
	}
	const expectedKeys = Object.keys(referenceCatalog).sort();
	const catalogs: Record<string, MessageCatalog> = {};
	for (const locale of locales) {
		const catalog = messages[locale];
		if (!isRecord(catalog)) {
			throw new TypeError(`Catalog for locale "${locale}" must be a record`);
		}
		const keys = Object.keys(catalog).sort();
		if (
			keys.length !== expectedKeys.length ||
			keys.some((key, index) => key !== expectedKeys[index])
		) {
			throw new TypeError(
				`Catalog keys for locale "${locale}" must match the other locales`,
			);
		}
		const clone: Record<string, string | PluralMessages> = {};
		for (const [key, message] of Object.entries(catalog)) {
			validateMessage(message, locale, key);
			clone[key] =
				typeof message === "string" ? message : Object.freeze({ ...message });
		}
		catalogs[locale] = Object.freeze(clone);
	}
	return Object.freeze(catalogs);
}

export function createSimpleI18n<
	const TLocales extends NonEmptyLocaleTuple,
	const TMessages extends Record<TLocales[number], MessageCatalog>,
>(
	options: SimpleI18nOptions<TLocales, TMessages>,
): I18nAdapter<TLocales[number], MessageKeys<TMessages>> {
	type Locale = TLocales[number];

	if (!Array.isArray(options.locales) || options.locales.length === 0) {
		throw new TypeError("I18n requires at least one locale");
	}
	for (const locale of options.locales) validateLocale(locale, "Locale");
	if (new Set(options.locales).size !== options.locales.length) {
		throw new TypeError("I18n locales must be unique");
	}
	validateLocale(options.locale, "Initial locale");
	if (!options.locales.includes(options.locale)) {
		throw new TypeError(
			`Initial locale "${options.locale}" is not included in locales`,
		);
	}
	if (options.fallbackLocale !== undefined) {
		validateLocale(options.fallbackLocale, "Fallback locale");
		if (!options.locales.includes(options.fallbackLocale)) {
			throw new TypeError(
				`Fallback locale "${options.fallbackLocale}" is not included in locales`,
			);
		}
	}

	let currentLocale = options.locale;
	const locales = Object.freeze([...options.locales]) as readonly Locale[];
	const fallbackLocale = options.fallbackLocale ?? locales[0]!;
	const messages = validateAndCloneCatalogs(locales, options.messages);
	const listeners = new Set<(locale: Locale) => void>();
	const dateFormats = new IntlFormatterCache<Intl.DateTimeFormat>();
	const displayNames = new IntlFormatterCache<Intl.DisplayNames>();
	const numberFormats = new IntlFormatterCache<Intl.NumberFormat>();
	const pluralRules = new IntlFormatterCache<Intl.PluralRules>();
	const relativeTimeFormats = new IntlFormatterCache<Intl.RelativeTimeFormat>();

	const interpolate = (
		message: string,
		params?: Readonly<Record<string, unknown>>,
	): string =>
		message.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
			const value = params?.[key];
			return value === undefined ? `{{${key}}}` : String(value);
		});

	const plural = (
		message: PluralMessages,
		params?: Readonly<Record<string, unknown>>,
	): string => {
		const count = typeof params?.count === "number" ? params.count : 1;
		const category = pluralRules
			.get(currentLocale, undefined, () => new Intl.PluralRules(currentLocale))
			.select(count);
		return interpolate(message[category] ?? message.other, params);
	};

	return {
		get locale() {
			return currentLocale;
		},
		get locales() {
			return locales;
		},
		t(key, params) {
			const message =
				messages[currentLocale]?.[key] ?? messages[fallbackLocale]?.[key];
			if (message === undefined) return key;
			return typeof message === "string"
				? interpolate(message, params)
				: plural(message, params);
		},
		setLocale(locale) {
			if (!locales.includes(locale)) {
				throw new RangeError(`Locale "${locale}" is not included in locales`);
			}
			if (locale === currentLocale) return;
			currentLocale = locale;
			options.onLocaleChange?.(locale);
			for (const listener of listeners) listener(locale);
		},
		onLocaleChange(callback) {
			listeners.add(callback);
			return () => listeners.delete(callback);
		},
		formatDate(date, formatOptions) {
			return dateFormats
				.get(
					currentLocale,
					formatOptions,
					() => new Intl.DateTimeFormat(currentLocale, formatOptions),
				)
				.format(typeof date === "number" ? new Date(date) : date);
		},
		formatNumber(value, formatOptions) {
			return numberFormats
				.get(
					currentLocale,
					formatOptions,
					() => new Intl.NumberFormat(currentLocale, formatOptions),
				)
				.format(value);
		},
		formatRelative(date) {
			const value = typeof date === "number" ? new Date(date) : date;
			const difference = value.getTime() - Date.now();
			const seconds = Math.round(difference / 1_000);
			const minutes = Math.round(difference / 60_000);
			const hours = Math.round(difference / 3_600_000);
			const days = Math.round(difference / 86_400_000);
			const relativeOptions = { numeric: "auto" } as const;
			const formatter = relativeTimeFormats.get(
				currentLocale,
				relativeOptions,
				() => new Intl.RelativeTimeFormat(currentLocale, relativeOptions),
			);
			if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
			if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
			if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
			return formatter.format(days, "day");
		},
		getLocaleName(locale) {
			try {
				return (
					displayNames
						.get(
							currentLocale,
							{ type: "language" },
							() =>
								new Intl.DisplayNames([currentLocale], { type: "language" }),
						)
						.of(locale) ?? locale
				);
			} catch {
				return locale;
			}
		},
		isRTL() {
			const baseLanguage = currentLocale.split("-")[0]?.toLowerCase() ?? "";
			return RTL_BASE_LANGUAGES.has(baseLanguage);
		},
	};
}
