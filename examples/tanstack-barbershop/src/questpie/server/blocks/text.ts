import { block } from "#questpie/factories";

import { content } from "./_categories";

export const textBlock = block("text")
	.admin(({ c }) => ({
		label: { en: "Text Block", sk: "Textový blok" },
		icon: c.icon("ph:text-t"),
		category: content(c),
		order: 1,
	}))
	.fields(({ f }) => ({
		content: f
			.richText()
			.label({ en: "Content", sk: "Obsah" })
			.localized()
			.required(),
		align: f
			.select([
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "center", label: { en: "Center", sk: "Stred" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			])
			.label({ en: "Alignment", sk: "Zarovnanie" })
			.default("left"),
		maxWidth: f
			.select([
				{ value: "narrow", label: { en: "Narrow", sk: "Úzky" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredný" } },
				{ value: "wide", label: { en: "Wide", sk: "Široký" } },
				{ value: "full", label: { en: "Full", sk: "Plný" } },
			])
			.label({ en: "Max Width", sk: "Max šírka" })
			.default("medium"),
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
