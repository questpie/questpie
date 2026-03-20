import { block } from "#questpie/factories";

import { content } from "./_categories";

export const headingBlock = block("heading")
	.admin(({ c }) => ({
		label: { en: "Heading", sk: "Nadpis" },
		icon: c.icon("ph:text-h-one"),
		category: content(c),
		order: 2,
	}))
	.fields(({ f }) => ({
		text: f.text().label({ en: "Text", sk: "Text" }).localized().required(),
		level: f
			.select([
				{ value: "h1", label: "H1" },
				{ value: "h2", label: "H2" },
				{ value: "h3", label: "H3" },
				{ value: "h4", label: "H4" },
			])
			.label({ en: "Level", sk: "Úroveň" })
			.default("h2"),
		align: f
			.select([
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "center", label: { en: "Center", sk: "Stred" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			])
			.label({ en: "Alignment", sk: "Zarovnanie" })
			.default("left"),
		padding: f
			.select([
				{ value: "none", label: { en: "None", sk: "Žiadne" } },
				{ value: "small", label: { en: "Small", sk: "Malé" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredné" } },
				{ value: "large", label: { en: "Large", sk: "Veľké" } },
			])
			.label({ en: "Padding", sk: "Odsadenie" })
			.default("medium"),
	}));
