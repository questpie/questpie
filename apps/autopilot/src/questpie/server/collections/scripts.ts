import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const scripts = collection("scripts")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		runner: f
			.select([
				{ value: "shell", label: { en: "Shell" } },
				{ value: "node", label: { en: "Node" } },
				{ value: "bun", label: { en: "Bun" } },
			])
			.label({ en: "Runner" }),
		content: f.textarea().label({ en: "Content" }),
		project: f.relation("projects").label({ en: "Project" }),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Automation Scripts" },
		icon: c.icon("ph:terminal"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.runner],
			},
			fields: [f.name, f.description, f.content, f.project],
		}),
	)
	.indexes(({ table }) => [
		index("scripts_project_idx").on(table.project as any),
	]);
