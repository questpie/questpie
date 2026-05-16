import { uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const models = collection("models")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		provider: f.relation("providers").label({ en: "Provider" }).required(),
		modelId: f.text().label({ en: "Provider Model ID" }).required(),
		runtime: f
			.select([
				{ value: "claude-code", label: { en: "Claude Code" } },
				{ value: "codex", label: { en: "Codex" } },
				{ value: "opencode", label: { en: "OpenCode" } },
			])
			.label({ en: "Runtime" }),
		maxTokens: f.number().label({ en: "Token Limit" }),
		capabilities: f.json().label({ en: "Supported Skills" }),
		config: f.json().label({ en: "Advanced Settings" }),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "AI Models" },
		icon: c.icon("ph:cpu"),
		hidden: true,
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.runtime],
			},
			fields: [
				f.name,
				f.provider,
				f.modelId,
				f.maxTokens,
				f.capabilities,
				f.config,
			],
		}),
	)
	.indexes(({ table }) => [
		uniqueIndex("models_provider_model_unique").on(
			table.provider as any,
			table.modelId as any,
		),
	]);
