import { block } from "@questpie/admin/server";
import { content } from "./_categories";

export const textBlock = block("text")
	.admin(({ c }) => ({
		label: { en: "Text Block", sk: "Textový blok" },
		icon: c.icon("ph:text-t"),
		category: content(c),
		order: 1,
	}))
	.fields(({ f }) => ({
		content: f.richText({
			label: { en: "Content", sk: "Obsah" },
			localized: true,
			required: true,
		}),
		align: f.select({
			label: { en: "Alignment", sk: "Zarovnanie" },
			options: [
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "center", label: { en: "Center", sk: "Stred" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			],
			defaultValue: "left",
		}),
		maxWidth: f.select({
			label: { en: "Max Width", sk: "Max šírka" },
			options: [
				{ value: "narrow", label: { en: "Narrow", sk: "Úzky" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredný" } },
				{ value: "wide", label: { en: "Wide", sk: "Široký" } },
				{ value: "full", label: { en: "Full", sk: "Plný" } },
			],
			defaultValue: "medium",
		}),
		padding: f.select({
			label: { en: "Padding", sk: "Odsadenie" },
			options: [
				{ value: "none", label: { en: "None", sk: "Žiadne" } },
				{ value: "small", label: { en: "Small", sk: "Malé" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredné" } },
				{ value: "large", label: { en: "Large", sk: "Veľké" } },
			],
			defaultValue: "medium",
		}),
	}));
