import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const ctaBlock = block("cta")
	.admin(({ c }) => ({
		label: { en: "CTA", sk: "Výzva k akcii" },
		icon: c.icon("ph:megaphone"),
		category: sections(c),
		order: 5,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized().required(),
		description: f
			.textarea()
			.label({ en: "Description", sk: "Popis" })
			.localized(),
		buttonText: f
			.text()
			.label({ en: "Button Text", sk: "Text tlačidla" })
			.localized(),
		buttonLink: f.text().label({ en: "Button Link", sk: "Odkaz tlačidla" }),
		variant: f
			.select([
				{ value: "highlight", label: "Highlight" },
				{ value: "dark", label: "Dark" },
				{ value: "light", label: "Light" },
			])
			.label({ en: "Variant", sk: "Variant" })
			.default("highlight"),
		size: f
			.select([
				{ value: "small", label: { en: "Small", sk: "Malá" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "large", label: { en: "Large", sk: "Veľká" } },
			])
			.label({ en: "Size", sk: "Veľkosť" })
			.default("medium"),
	}));
