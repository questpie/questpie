/**
 * Locale — content locale configuration.
 */
import { locale } from "#questpie";

export default locale({
	locales: [
		{
			code: "en",
			label: "English",
			fallback: true,
			flagCountryCode: "us",
		},
		{ code: "sk", label: "Slovenčina" },
	],
	defaultLocale: "en",
});
