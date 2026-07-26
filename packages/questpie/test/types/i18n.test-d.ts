import { createSimpleI18n } from "#questpie/exports/client.js";

import type { Equal, Expect } from "./type-test-utils.js";

const i18n = createSimpleI18n({
	locale: "en",
	locales: ["en", "sk"] as const,
	messages: {
		en: { greeting: "Hello", save: "Save" },
		sk: { greeting: "Ahoj", save: "Uložiť" },
	},
	fallbackLocale: "en",
});

type _localeIsDeclaredUnion = Expect<Equal<typeof i18n.locale, "en" | "sk">>;
i18n.t("greeting");
// @ts-expect-error message keys are inferred from the complete catalogs
i18n.t("missing");
// @ts-expect-error only declared locales may be selected
i18n.setLocale("de");

// @ts-expect-error at least one locale is required
createSimpleI18n({ locale: "en", locales: [] as const, messages: {} });
createSimpleI18n({
	// @ts-expect-error initial locale must be in the declared locale tuple
	locale: "de",
	locales: ["en"] as const,
	messages: { en: { greeting: "Hello" } },
});
createSimpleI18n({
	locale: "en",
	locales: ["en"] as const,
	// @ts-expect-error fallback locale must be in the declared locale tuple
	fallbackLocale: "de",
	messages: { en: { greeting: "Hello" } },
});
createSimpleI18n({
	locale: "en",
	locales: ["en", "sk"] as const,
	// @ts-expect-error every declared locale needs a catalog
	messages: { en: { greeting: "Hello" } },
});
createSimpleI18n({
	locale: "en",
	locales: ["en"] as const,
	// @ts-expect-error undeclared locale catalogs are rejected
	messages: {
		en: { greeting: "Hello" },
		sk: { greeting: "Ahoj" },
	},
});
createSimpleI18n({
	locale: "en",
	locales: ["en", "sk"] as const,
	// @ts-expect-error every locale catalog must expose the same keys
	messages: {
		en: { greeting: "Hello", save: "Save" },
		sk: { greeting: "Ahoj" },
	},
});
