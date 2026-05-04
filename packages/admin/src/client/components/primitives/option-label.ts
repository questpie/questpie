import type { I18nText } from "../../i18n/types";
import { formatLabel } from "../../lib/utils";
import { flattenOptions, type SelectOptions } from "./types";

export type ResolveTextFn = (
	text: I18nText | undefined,
	fallback?: string,
) => string;
export type TranslateFn = (
	key: string,
	params?: Record<string, unknown>,
) => string;

function normalizeLabel(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, "");
}

function labelLooksDerivedFromValue(label: string, value: unknown): boolean {
	const rawValue = String(value);
	const normalizedLabel = normalizeLabel(label);
	return (
		normalizedLabel === normalizeLabel(rawValue) ||
		normalizedLabel === normalizeLabel(formatLabel(rawValue))
	);
}

function hasLocaleLabel(label: I18nText, locale: string): boolean {
	if (!label || typeof label !== "object" || "key" in label) return false;
	if (typeof label[locale] === "string") return true;
	const language = locale.split("-")[0];
	return !!language && typeof label[language] === "string";
}

export function getStatusTranslation(
	value: unknown,
	t: TranslateFn,
): string | undefined {
	const key = `status.${String(value)}`;
	const translated = t(key);
	return translated === key ? undefined : translated;
}

export function resolveOptionLabel({
	value,
	label,
	resolveText,
	t,
	locale,
	fallback = String(value),
}: {
	value: unknown;
	label: I18nText | undefined;
	resolveText: ResolveTextFn;
	t: TranslateFn;
	locale: string;
	fallback?: string;
}): string {
	const statusTranslation = getStatusTranslation(value, t);

	if (!label) return statusTranslation ?? fallback;

	if (
		statusTranslation &&
		typeof label === "object" &&
		!("key" in label) &&
		!hasLocaleLabel(label, locale)
	) {
		return statusTranslation;
	}

	if (
		statusTranslation &&
		typeof label === "string" &&
		labelLooksDerivedFromValue(label, value)
	) {
		return statusTranslation;
	}

	return resolveText(label, statusTranslation ?? fallback);
}

export function resolveOptionLabelForValue({
	value,
	options,
	resolveText,
	t,
	locale,
	fallback = String(value),
}: {
	value: unknown;
	options: SelectOptions<unknown> | undefined;
	resolveText: ResolveTextFn;
	t: TranslateFn;
	locale: string;
	fallback?: string;
}): string {
	if (!Array.isArray(options)) {
		return getStatusTranslation(value, t) ?? fallback;
	}

	const option = flattenOptions(options).find(
		(item) => String(item.value) === String(value),
	);

	return resolveOptionLabel({
		value,
		label: option?.label,
		resolveText,
		t,
		locale,
		fallback,
	});
}
