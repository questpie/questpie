import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const workflowConfigs = collection("workflow_configs")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		steps: f
			.json()
			.label({ en: "Plan Steps" })
			.description({ en: "Ordered steps Autopilot should follow." })
			.required(),
		defaultCapability: f
			.relation("capabilities")
			.label({ en: "Default Skill" }),
		project: f.relation("projects").label({ en: "Project" }),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
		version: f.number().label({ en: "Version" }).default(1),
		config: f.json().label({ en: "Advanced Settings" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Automation Plans" },
		icon: c.icon("ph:flow-arrow"),
	}))
	.list(({ v, f }) =>
		v.listView({
			columns: [f.name, f.enabled, f.project, f.defaultCapability, f.version],
			searchable: [f.name, f.description],
			filterable: [f.enabled, f.project, f.defaultCapability],
			layout: {
				density: "comfortable",
				titleField: f.name,
				subtitleField: f.description,
				badgeFields: [f.enabled],
				metaFields: [f.project, f.defaultCapability, f.version],
			},
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.version],
			},
			fields: [
				{
					type: "section",
					label: { en: "Plan" },
					fields: [f.name, f.description, f.project],
				},
				{
					type: "section",
					label: { en: "Default Run Settings" },
					fields: [f.defaultCapability],
				},
				{
					type: "section",
					label: { en: "Steps" },
					fields: [f.steps],
				},
				{
					type: "section",
					label: { en: "Advanced" },
					fields: [f.config],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		index("workflow_configs_project_idx").on(table.project as any),
		index("workflow_configs_enabled_idx").on(table.enabled as any),
	]);
