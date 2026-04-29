import {
	getAdminMessagesForLocale,
	type MessageValue,
} from "../../../i18n/index.js";

function getPluralCount(params?: Record<string, unknown>): number {
	if (!params) return 1;
	for (const key of ["count", "total", "length"]) {
		if (typeof params[key] === "number") return params[key];
	}
	return 1;
}

function selectMessage(
	value: MessageValue,
	locale: string,
	params?: Record<string, unknown>,
): string {
	if (typeof value === "string") return value;

	const count = getPluralCount(params);
	try {
		const category = new Intl.PluralRules(locale).select(count);
		return value[category as keyof typeof value] ?? value.other;
	} catch {
		return count === 1 ? value.one : value.other;
	}
}

function interpolate(
	template: string,
	params?: Record<string, unknown>,
): string {
	if (!params) return template;
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
		params[key] === undefined ? `{{${key}}}` : String(params[key]),
	);
}

export function translateAdminMessage(
	locale: string | undefined,
	key: string,
	params?: Record<string, unknown>,
): string {
	const resolvedLocale = locale ?? "en";
	const messages = getAdminMessagesForLocale(resolvedLocale);
	const message = messages[key];
	if (message === undefined) return key;
	return interpolate(selectMessage(message, resolvedLocale, params), params);
}
