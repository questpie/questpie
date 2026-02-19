import { qb } from "@/questpie/server/builder.js";

export const siteSettings = qb
	.global("site_settings")
	.fields((f) => ({
		siteName: f.text({
			label: "Site Name",
			required: true,
			default: "{{projectName}}",
		}),
		description: f.textarea({
			label: "Site Description",
			default: "A QUESTPIE powered site",
		}),
	}))
	.admin(({ c }) => ({
		label: "Site Settings",
		icon: c.icon("ph:gear"),
	}))
	.form(({ v, f }) =>
		v.form({
			fields: [f.siteName, f.description],
		}),
	);
