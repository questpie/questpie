import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const workflowConfigs = collection("workflow_configs")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		steps: f.json().label({ en: "Steps" }).required(),
		defaultCapability: f.relation("capabilities").label({ en: "Default Capability" }),
		project: f.relation("projects").label({ en: "Project" }),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
		version: f.number().label({ en: "Version" }).default(1),
		config: f.json().label({ en: "Config" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Workflow Configs" },
		icon: c.icon("ph:git-branch"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.version],
			},
			fields: [f.name, f.description, f.steps, f.defaultCapability, f.project, f.config],
		}),
	)
	.indexes(({ table }) => [
		index("workflow_configs_project_idx").on(table.project as any),
		index("workflow_configs_enabled_idx").on(table.enabled as any),
	]);
