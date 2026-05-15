import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const capabilities = collection("capabilities")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		defaultModel: f.relation("models").label({ en: "Default AI Model" }),
		allowedProviders: f.json().label({ en: "Allowed Providers" }),
		allowedTools: f.json().label({ en: "Allowed Tools" }),
		contextRefs: f.json().label({ en: "Knowledge Sources" }),
		promptRefs: f.json().label({ en: "Prompt References" }),
		runtimeHints: f.json().label({ en: "Runtime Hints" }),
		project: f.relation("projects").label({ en: "Project" }),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
		config: f.json().label({ en: "Advanced Settings" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Skills" },
		icon: c.icon("ph:puzzle-piece"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled],
			},
			fields: [
				{
					type: "section",
					label: "General",
					fields: [f.name, f.description, f.defaultModel, f.project],
				},
				{
					type: "section",
					label: "Tools & Context",
					fields: [
						f.allowedTools,
						f.allowedProviders,
						f.contextRefs,
						f.promptRefs,
						f.runtimeHints,
					],
				},
				{
					type: "section",
					label: "Advanced",
					fields: [f.config],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		index("capabilities_project_idx").on(table.project as any),
		index("capabilities_enabled_idx").on(table.enabled as any),
	]);
