import { global } from "#questpie/factories";

export const siteSettings = global("siteSettings")
	.fields(({ f }) => ({
		siteName: f.text().label("Site Name").required().default("{{projectName}}"),
		description: f
			.textarea()
			.label("Site Description")
			.default("A QUESTPIE powered site"),
	}));
