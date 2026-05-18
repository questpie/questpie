import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const workflowConfigs = collection("workflow_configs")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		steps: f
			.json()
			.label({ en: "Steps" })
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
		label: { en: "Workflows" },
		icon: c.icon("ph:flow-arrow"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [
				f.name,
				f.description,
				f.project,
				f.defaultCapability,
				f.enabled,
				"updatedAt",
			],
			searchable: [f.name, f.description],
			filterable: [f.enabled, f.project, f.defaultCapability],
			defaultSort: { field: "updatedAt", direction: "desc" },
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
					type: "tabs",
					tabs: [
						{
							id: "overview",
							label: { en: "Overview" },
							fields: [
								{
									type: "section",
									fields: [f.name, f.description],
								},
							],
						},
						{
							id: "steps",
							label: { en: "Steps" },
							fields: [
								{
									type: "section",
									fields: [f.steps],
								},
							],
						},
						{
							id: "defaults",
							label: { en: "Defaults" },
							fields: [
								{
									type: "section",
									fields: [f.project, f.defaultCapability],
								},
							],
						},
						{
							id: "advanced",
							label: { en: "Advanced" },
							fields: [
								{
									type: "section",
									fields: [f.config],
								},
							],
						},
					],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		index("workflow_configs_project_idx").on(table.project as any),
		index("workflow_configs_enabled_idx").on(table.enabled as any),
	]);
