/**
 * App Configuration
 *
 * Content locale and other app-level settings.
 */
import { appConfig } from "questpie";

export default appConfig({
	locale: {
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
	},
});
