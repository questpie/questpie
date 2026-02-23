import { block } from "@questpie/admin/server";
import { content } from "./_categories";

export const headingBlock = block("heading")
	.admin(({ c }) => ({
		label: { en: "Heading", sk: "Nadpis" },
		icon: c.icon("ph:text-h-one"),
		category: content(c),
		order: 2,
	}))
	.fields(({ f }) => ({
		text: f.text({
			label: { en: "Text", sk: "Text" },
			localized: true,
			required: true,
		}),
		level: f.select({
			label: { en: "Level", sk: "Úroveň" },
			options: [
				{ value: "h1", label: "H1" },
				{ value: "h2", label: "H2" },
				{ value: "h3", label: "H3" },
				{ value: "h4", label: "H4" },
			],
			defaultValue: "h2",
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
