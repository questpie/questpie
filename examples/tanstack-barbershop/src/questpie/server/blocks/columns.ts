import { block } from "@questpie/admin/server";
import { layout } from "./_categories";

export const columnsBlock = block("columns")
	.admin(({ c }) => ({
		label: { en: "Columns", sk: "Stĺpce" },
		icon: c.icon("ph:columns"),
		category: layout(c),
		order: 1,
	}))
	.allowChildren()
	.fields(({ f }) => ({
		columns: f.select({
			label: { en: "Columns", sk: "Počet stĺpcov" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "2",
		}),
		gap: f.select({
			label: { en: "Gap", sk: "Medzera" },
			options: [
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
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
