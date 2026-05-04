import { describe, expect, it } from "bun:test";

import type { FieldInstance } from "#questpie/admin/client/builder/field/field";
import type { I18nText } from "#questpie/admin/client/i18n/types";
import { resolveSelectCellLabel } from "#questpie/admin/client/views/collection/cells/primitive-cells";

function createField(options: unknown[]): FieldInstance {
	return {
		name: "select",
		component: () => null,
		cell: () => null,
		"~options": { options },
	} as unknown as FieldInstance;
}

const messages: Record<string, string> = {
	"status.published": "Publikované",
};

function t(key: string) {
	return messages[key] ?? key;
}

function resolveText(text: I18nText | undefined, fallback = ""): string {
	if (!text) return fallback;
	if (typeof text === "string") return text;
	if (typeof text === "function") return fallback;
	if ("key" in text) return t(text.key);
	return text.sk ?? text.en ?? fallback;
}

describe("resolveSelectCellLabel", () => {
	it("resolves translation key option labels", () => {
		const fieldDef = createField([
			{ value: "published", label: { key: "status.published" } },
		]);

		expect(
			resolveSelectCellLabel({
				value: "published",
				fieldDef,
				resolveText,
				t,
				locale: "sk",
			}),
		).toBe("Publikované");
	});

	it("uses generic status translations when an option label has no current locale", () => {
		const fieldDef = createField([
			{ value: "published", label: { en: "Published" } },
		]);

		expect(
			resolveSelectCellLabel({
				value: "published",
				fieldDef,
				resolveText,
				t,
				locale: "sk",
			}),
		).toBe("Publikované");
	});

	it("keeps explicit current-locale option labels", () => {
		const fieldDef = createField([
			{
				value: "published",
				label: { en: "Published", sk: "Zverejnené" },
			},
		]);

		expect(
			resolveSelectCellLabel({
				value: "published",
				fieldDef,
				resolveText,
				t,
				locale: "sk",
			}),
		).toBe("Zverejnené");
	});

	it("falls back to the raw value for unknown values", () => {
		expect(
			resolveSelectCellLabel({
				value: "internal",
				fieldDef: createField([]),
				resolveText,
				t,
				locale: "sk",
			}),
		).toBe("internal");
	});

	it("uses generic status translations when no static options are available", () => {
		expect(
			resolveSelectCellLabel({
				value: "published",
				fieldDef: createField([]),
				resolveText,
				t,
				locale: "sk",
			}),
		).toBe("Publikované");
	});
});
