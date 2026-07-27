import {
	type I18nText,
	isI18nTranslationKey,
	resolveI18nText,
} from "questpie/shared";

import { getAdminMessagesForLocale } from "../../../i18n/index.js";

type Messages = Record<string, unknown>;

function lookupMessage(messages: Messages, key: string): string | null {
	const value = messages[key];
	if (typeof value === "string") return value;
	if (value && typeof value === "object") {
		const plural = (value as { other?: unknown }).other;
		if (typeof plural === "string") return plural;
	}
	return null;
}

function makeTranslator(messages: Messages) {
	return (key: string): string => lookupMessage(messages, key) ?? key;
}

function getResourceLabel(
	app: any,
	resourceType: string,
	resource: string,
): I18nText | null {
	if (!app) return null;
	if (resourceType === "collection") {
		const config = app.getCollectionConfig?.(resource);
		return config?.state?.admin?.label ?? config?.state?.label ?? null;
	}
	if (resourceType === "global") {
		const config = app.getGlobals?.()?.[resource];
		return config?.state?.admin?.label ?? config?.state?.label ?? null;
	}
	return null;
}

function resolveLabel(
	label: I18nText | null,
	locale: string,
	t: (key: string) => string,
): string | null {
	if (label == null) return null;
	if (isI18nTranslationKey(label)) {
		const resolved = t(label.key);
		return resolved === label.key ? (label.fallback ?? null) : resolved;
	}
	return resolveI18nText(label, locale, t);
}

function interpolate(template: string, values: Record<string, string>): string {
	return template.replace(
		/\{\{\s*(\w+)\s*\}\}/g,
		(_m, k) => values[k] ?? `{{${k}}}`,
	);
}

/**
 * Recompute the audit log title in the viewer's locale.
 * Returns null when no locale is provided so the caller can keep the stored value.
 */
export function localizeAuditTitle(
	data: Record<string, any>,
	locale: string | undefined,
	app: unknown,
): string | null {
	if (!locale) return null;

	const messages = getAdminMessagesForLocale(locale) as Messages;
	const t = makeTranslator(messages);

	const action = String(data.action ?? "");
	const resourceType = String(data.resourceType ?? "");
	const resource = String(data.resource ?? "");
	const userName = String(data.userName ?? "");

	const actionText =
		lookupMessage(messages, `audit.action.${action}`) ?? action;
	const resourceTypeText =
		lookupMessage(messages, `audit.resourceType.${resourceType}`) ??
		resourceType;
	const resourceName =
		resolveLabel(getResourceLabel(app, resourceType, resource), locale, t) ??
		resource;

	const rawLabel =
		typeof data.resourceLabel === "string" && data.resourceLabel.length > 0
			? data.resourceLabel
			: null;
	const unnamed = lookupMessage(messages, "audit.unnamed") ?? "(unnamed)";
	const resourceLabel = rawLabel ? `'${rawLabel}'` : unnamed;

	const template =
		lookupMessage(messages, "audit.title.template") ??
		"{{userName}} {{action}} {{resourceType}} {{resourceLabel}}";

	return interpolate(template, {
		userName,
		action: actionText,
		resourceType: `${resourceTypeText} ${resourceName}`,
		resourceLabel,
	});
}
