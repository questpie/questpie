import { block } from "#questpie/factories";

import { content } from "./_categories";

export const statsBlock = block("stats")
	.admin(({ c }) => ({
		label: { en: "Stats", sk: "Štatistiky" },
		icon: c.icon("ph:chart-bar"),
		category: content(c),
		order: 7,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized(),
		stats: f
			.object({
				value: f.text().label({ en: "Value", sk: "Hodnota" }).required(),
				label: f.text().label({ en: "Label", sk: "Popisok" }).required(),
				description: f.text().label({ en: "Description", sk: "Popis" }),
			})
			.array()
			.label({ en: "Stats", sk: "Štatistiky" }),
		columns: f
			.select([
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			])
			.label({ en: "Columns", sk: "Stĺpce" })
			.default("3"),
	}));
