import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const ctaBlock = block("cta")
	.admin(({ c }) => ({
		label: "Call to Action",
		icon: c.icon("ph:megaphone"),
		category: sections(c),
		order: 2,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title").required(),
		description: f.textarea().label("Description"),
		buttonText: f.text().label("Button Text"),
		buttonLink: f.text().label("Button Link"),
		variant: f
			.select([
				{ value: "highlight", label: "Highlight" },
				{ value: "dark", label: "Dark" },
				{ value: "light", label: "Light" },
			])
			.label("Variant")
			.default("highlight"),
	}));
