import { describe, expect, it } from "bun:test";

import { createSimpleI18n } from "../../src/client/i18n/simple";

describe("Admin i18n compatibility adapter", () => {
	it("normalizes the currently fetched catalog into the generic primitive", () => {
		const localeChanges: string[] = [];
		const i18n = createSimpleI18n({
			locale: "ar-EG",
			locales: ["en", "ar-EG"],
			messages: { "ar-EG": { greeting: "مرحبًا" } },
			fallbackLocale: "en",
			onLocaleChange: (locale) => localeChanges.push(locale),
		});

		expect(i18n.t("greeting")).toBe("مرحبًا");
		expect(i18n.isRTL()).toBe(true);
		i18n.setLocale("en");
		expect(localeChanges).toEqual(["en"]);
		expect(i18n.t("greeting")).toBe("مرحبًا");
	});
});
