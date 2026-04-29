import { block } from "#questpie/factories";

import { layout } from "./_categories";

export const columnsBlock = block("columns")
	.admin(({ c }) => ({
		label: "Columns",
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
			.label("Columns")
			.default("2"),
		gap: f
			.select([
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			])
			.label("Gap")
			.default("medium"),
		padding: f
			.select([
				{ value: "none", label: "None" },
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			])
			.label("Padding")
			.default("medium"),
	}));
