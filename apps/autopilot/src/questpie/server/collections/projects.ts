import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const projects = collection("projects")
	.fields(({ f }) => ({
		name: f.text().required().label({ en: "Name" }),
		slug: f.text().required().label({ en: "Slug" }),
		path: f.text().label({ en: "Workspace Path" }),
		gitProvider: f
			.select([
				{ value: "github", label: { en: "GitHub" } },
				{ value: "gitlab", label: { en: "GitLab" } },
				{ value: "generic", label: { en: "Generic" } },
				{ value: "none", label: { en: "None" } },
			])
			.label({ en: "Git Provider" }),
		gitRemote: f.text().label({ en: "Git Remote URL" }),
		defaultBranch: f.text().default("main").label({ en: "Default Branch" }),
		providerConfig: f.json().label({ en: "Connection Settings" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Projects" },
		icon: c.icon("ph:folder-notch"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				{
					type: "section",
					label: { en: "General" },
					fields: [f.name, f.slug, f.path],
				},
				{
					type: "section",
					label: { en: "Git Configuration" },
					fields: [
						f.gitProvider,
						f.gitRemote,
						f.defaultBranch,
						f.providerConfig,
					],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		uniqueIndex("projects_slug_unique").on(table.slug as any),
		index("projects_git_provider_idx").on(table.gitProvider as any),
	]);
