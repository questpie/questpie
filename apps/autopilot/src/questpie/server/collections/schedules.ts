import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const schedules = collection("schedules")
	.fields(({ f }) => ({
		name: f.text().label({ en: "Name" }).required(),
		description: f.textarea().label({ en: "Description" }),
		cron: f
			.text()
			.label({ en: "Run Schedule" })
			.description({
				en: "Cron expression, for example 0 9 * * 1 for Monday 9:00.",
			})
			.required(),
		timezone: f.text().label({ en: "Timezone" }).default("UTC"),
		mode: f
			.select([
				{ value: "task", label: { en: "Task" } },
				{ value: "chat", label: { en: "Chat" } },
			])
			.label({ en: "Mode" }),
		workflowConfig: f
			.relation("workflow_configs")
			.label({ en: "Automation Plan" }),
		taskTemplate: f.json().label({ en: "Task Template" }),
		chatPrompt: f.textarea().label({ en: "Chat Prompt" }),
		concurrencyPolicy: f
			.select([
				{ value: "allow", label: { en: "Allow Overlap" } },
				{ value: "skip", label: { en: "Skip If Running" } },
				{ value: "replace", label: { en: "Replace Current Run" } },
			])
			.label({ en: "When Already Running" })
			.default("allow"),
		enabled: f.boolean().label({ en: "Enabled" }).default(true),
		lastRunAt: f.datetime().label({ en: "Last Run At" }),
		nextRunAt: f.datetime().label({ en: "Next Run At" }),
		createdBy: f.text().label({ en: "Created By" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Scheduled Work" },
		icon: c.icon("ph:calendar-check"),
	}))
	.list(({ v, f }) =>
		v.listView({
			columns: [f.name, f.enabled, f.mode, f.workflowConfig, f.nextRunAt],
			searchable: [f.name, f.description, f.chatPrompt],
			filterable: [f.enabled, f.mode, f.workflowConfig],
			layout: {
				density: "comfortable",
				titleField: f.name,
				subtitleField: f.description,
				badgeFields: [f.enabled, f.mode],
				metaFields: [f.workflowConfig, f.nextRunAt],
			},
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.enabled, f.mode, f.concurrencyPolicy],
			},
			fields: [
				{
					type: "section",
					label: { en: "When It Runs" },
					fields: [f.name, f.description, f.cron, f.timezone],
				},
				{
					type: "section",
					label: { en: "Create Work" },
					fields: [f.workflowConfig, f.taskTemplate],
				},
				{
					type: "section",
					label: { en: "Send A Chat Prompt" },
					fields: [f.chatPrompt],
				},
				{
					type: "section",
					label: { en: "Run History" },
					fields: [f.lastRunAt, f.nextRunAt, f.createdBy],
				},
			],
		}),
	)
	.indexes(({ table }) => [
		index("schedules_enabled_next_run_idx").on(
			table.enabled as any,
			table.nextRunAt as any,
		),
		index("schedules_mode_idx").on(table.mode as any),
	]);
