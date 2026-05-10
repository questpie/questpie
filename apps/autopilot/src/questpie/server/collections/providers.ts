import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const providers = collection("providers")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		type: f
			.select([
				{ value: "anthropic", label: { en: "Anthropic" } },
				{ value: "openai", label: { en: "OpenAI" } },
				{ value: "local", label: { en: "Local" } },
				{ value: "custom", label: { en: "Custom" } },
				{ value: "github", label: { en: "GitHub" } },
				{ value: "gitlab", label: { en: "GitLab" } },
				{ value: "generic_git", label: { en: "Generic Git" } },
			])
			.label({ en: "Type" }),
		apiEndpoint: f.text().label({ en: "API Endpoint" }),
		secretRef: f.text().label({ en: "Secret Ref" }),
		config: f.json().label({ en: "Config" }),
		project: f.relation("projects").label({ en: "Project" }),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Providers" },
		icon: c.icon("ph:plugs-connected"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.type],
			},
			fields: [f.name, f.apiEndpoint, f.secretRef, f.project, f.config],
		}),
	)
	.indexes(({ table }) => [
		index("providers_type_enabled_idx").on(table.type as any, table.enabled as any),
		index("providers_project_idx").on(table.project as any),
	]);
