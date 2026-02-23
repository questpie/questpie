import { block } from "@questpie/admin/server";
import { content } from "./_categories";

export const statsBlock = block("stats")
	.admin(({ c }) => ({
		label: { en: "Stats", sk: "Štatistiky" },
		icon: c.icon("ph:chart-bar"),
		category: content(c),
		order: 7,
	}))
	.fields(({ f }) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		stats: f.array({
			of: f.object({
				fields: {
					value: f.text({
						label: { en: "Value", sk: "Hodnota" },
						required: true,
					}),
					label: f.text({
						label: { en: "Label", sk: "Popisok" },
						required: true,
					}),
					description: f.text({
						label: { en: "Description", sk: "Popis" },
					}),
				},
			}),
			label: { en: "Stats", sk: "Štatistiky" },
		}),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
	}));
