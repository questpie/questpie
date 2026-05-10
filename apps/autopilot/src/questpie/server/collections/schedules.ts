import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const schedules = collection("schedules")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		cron: f.text().label({ en: "Cron" }).required(),
		timezone: f.text().label({ en: "Timezone" }).default("UTC"),
		mode: f
			.select([
				{ value: "task", label: { en: "Task" } },
				{ value: "chat", label: { en: "Chat" } },
			])
			.label({ en: "Mode" }),
		workflowConfig: f.relation("workflow_configs").label({ en: "Workflow Config" }),
		taskTemplate: f.json().label({ en: "Task Template" }),
		chatPrompt: f.textarea().label({ en: "Chat Prompt" }),
		concurrencyPolicy: f
			.select([
				{ value: "allow", label: { en: "Allow" } },
				{ value: "skip", label: { en: "Skip" } },
				{ value: "replace", label: { en: "Replace" } },
			])
			.label({ en: "Concurrency Policy" })
			.default("allow"),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
		lastRunAt: f.datetime().label({ en: "Last Run At" }),
		nextRunAt: f.datetime().label({ en: "Next Run At" }),
		createdBy: f.text().label({ en: "Created By" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Schedules" },
		icon: c.icon("ph:timer"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.mode, f.concurrencyPolicy],
			},
			fields: [
				{
					type: "section",
					label: "Schedule",
					fields: [f.name, f.description, f.cron, f.timezone],
				},
				{
					type: "section",
					label: "Task Mode",
					fields: [f.workflowConfig, f.taskTemplate],
				},
				{
					type: "section",
					label: "Chat Mode",
					fields: [f.chatPrompt],
				},
				{
					type: "section",
					label: "Status",
					fields: [f.lastRunAt, f.nextRunAt, f.createdBy],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		index("schedules_enabled_next_run_idx").on(table.enabled as any, table.nextRunAt as any),
		index("schedules_mode_idx").on(table.mode as any),
	]);
