/**
 * Intl Formatters Cache
 *
 * Caches Intl formatter instances to avoid creating new ones on every call.
 * Intl formatters are expensive to create but cheap to reuse.
 */

// Cache key generator - serializes locale + options
function getCacheKey(locale: string, options?: object): string {
	if (!options || Object.keys(options).length === 0) {
		return locale;
	}
	return `${locale}:${JSON.stringify(options)}`;
}

// DateTimeFormat cache
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

export function getDateTimeFormat(
	locale: string,
	options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const key = getCacheKey(locale, options);
	let formatter = dateTimeFormatCache.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, options);
		dateTimeFormatCache.set(key, formatter);
	}
	return formatter;
}

// NumberFormat cache
const numberFormatCache = new Map<string, Intl.NumberFormat>();

export function getNumberFormat(
	locale: string,
	options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
	const key = getCacheKey(locale, options);
	let formatter = numberFormatCache.get(key);
	if (!formatter) {
		formatter = new Intl.NumberFormat(locale, options);
		numberFormatCache.set(key, formatter);
	}
	return formatter;
}

// PluralRules cache
const pluralRulesCache = new Map<string, Intl.PluralRules>();

export function getPluralRules(
	locale: string,
	options?: Intl.PluralRulesOptions,
): Intl.PluralRules {
	const key = getCacheKey(locale, options);
	let rules = pluralRulesCache.get(key);
	if (!rules) {
		rules = new Intl.PluralRules(locale, options);
		pluralRulesCache.set(key, rules);
	}
	return rules;
}

// RelativeTimeFormat cache
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

export function getRelativeTimeFormat(
	locale: string,
	options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
	const key = getCacheKey(locale, options);
	let formatter = relativeTimeFormatCache.get(key);
	if (!formatter) {
		formatter = new Intl.RelativeTimeFormat(locale, options);
		relativeTimeFormatCache.set(key, formatter);
	}
	return formatter;
}

// DisplayNames cache
const displayNamesCache = new Map<string, Intl.DisplayNames>();

export function getDisplayNames(
	locale: string,
	options: Intl.DisplayNamesOptions,
): Intl.DisplayNames {
	const key = getCacheKey(locale, options);
	let displayNames = displayNamesCache.get(key);
	if (!displayNames) {
		displayNames = new Intl.DisplayNames([locale], options);
		displayNamesCache.set(key, displayNames);
	}
	return displayNames;
}

/**
 * Clear all caches - useful for testing or when locale changes significantly
 */
function clearIntlCache(): void {
	dateTimeFormatCache.clear();
	numberFormatCache.clear();
	pluralRulesCache.clear();
	relativeTimeFormatCache.clear();
	displayNamesCache.clear();
}
