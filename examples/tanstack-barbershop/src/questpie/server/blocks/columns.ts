import { block } from "#questpie/factories";

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
		columns: f
			.select([
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			])
			.label({ en: "Columns", sk: "Počet stĺpcov" })
			.default("2"),
		gap: f
			.select([
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			])
			.label({ en: "Gap", sk: "Medzera" })
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
