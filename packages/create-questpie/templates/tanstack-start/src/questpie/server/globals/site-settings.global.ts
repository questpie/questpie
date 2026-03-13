import { global } from "#questpie/factories";

export const siteSettings = global("site_settings")
	.fields(({ f }) => ({
		siteName: f.text().label("Site Name").required().default("{{projectName}}"),
		description: f
			.textarea()
			.label("Site Description")
			.default("A QUESTPIE powered site"),
	}))
	.admin(({ c }) => ({
		label: "Site Settings",
		icon: c.icon("ph:gear"),
	}))
	.form(({ v, f }) =>
		v.globalForm({
			fields: [f.siteName, f.description],
		}),
	);
