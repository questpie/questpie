import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const environments = collection("environments")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		project: f.relation("projects").label({ en: "Project" }),
		variables: f.json().label({ en: "Variables" }),
		secretRefs: f.json().label({ en: "Secret Names" }),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Environment Settings" },
		icon: c.icon("ph:tree-structure"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled],
			},
			fields: [f.name, f.project, f.variables, f.secretRefs],
		}),
	)
	.indexes(({ table }) => [
		index("environments_project_idx").on(table.project as any),
	]);
