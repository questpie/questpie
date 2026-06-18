import { global } from "#questpie/factories";

export const siteSettings = global("siteSettings")
	.fields(({ f }) => ({
		siteName: f.text().label("Site Name").required().default("Toy Factory Ops"),
		description: f
			.textarea()
			.label("Site Description")
			.default("Backend-first production planning for a small toy workshop"),
		planningHorizonDays: f
			.number()
			.label("Planning horizon days")
			.required()
			.default(14),
		defaultShiftHours: f
			.number()
			.label("Default shift hours")
			.required()
			.default(8),
	}))
	.admin(({ c }) => ({
		label: "Factory Settings",
		icon: c.icon("ph:gear"),
	}))
	.form(({ v, f }) =>
		v.globalForm({
			fields: [
				f.siteName,
				f.description,
				f.planningHorizonDays,
				f.defaultShiftHours,
			],
		}),
	);
